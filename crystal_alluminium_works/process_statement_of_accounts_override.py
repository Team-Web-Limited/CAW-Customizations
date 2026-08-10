"""Builds Process Statement Of Accounts from Job Cards instead of the General Ledger.

ERPNext's PSOA reads GL Entry / Payment Ledger Entry, but this business tracks what a
customer owes on the CAW Job Card: the job card carries the agreed (VAT-inclusive)
quotation_amount, and every receipt is a dated Payments row. Sales Invoices here only
ever track *released items* and never carry payments, so a ledger-based statement shows
every job-card invoice as unpaid and overstates what the customer owes.

Both sides of a job card are VAT-inclusive - quotation_amount is grossed up by
_get_quotation_display_total, and Payments record actual cash received - so the
statement is internally consistent. It is a customer statement, not a tax document:
it shows no VAT breakdown, and the ledger's own VAT/Debtors position is a separate
(unresolved) accounting matter.

Wired up via override_whitelisted_methods in hooks.py, so this only runs when a
statement is actually downloaded or emailed.
"""

import frappe
from frappe.utils import flt, getdate

# Charges age from the day the job card was opened; job cards carry no due date.
AGEING_BUCKETS = ((1, 30, "range1"), (31, 60, "range2"), (61, 90, "range3"))


def _gross(amount, total_taxes_and_charges):
	"""Invoices raised by this app book revenue ex-VAT and add the 16% only in the print
	format, so an invoice with no tax line has to be grossed up to compare against a
	job card's VAT-inclusive quotation_amount. Mirrors api._invoice_uses_visual_vat."""
	from crystal_alluminium_works.api import VAT_RATE

	amount = flt(amount)
	return amount * (1 + VAT_RATE) if flt(total_taxes_and_charges) == 0 else amount


def _get_job_cards(customer):
	return frappe.get_all(
		"CAW Job Card",
		filters={"customer": customer, "status": ["!=", "Cancelled"]},
		fields=["name", "quotation", "quotation_amount", "payment_amount", "payment_mode", "creation"],
	)


def _gather_events(customer, job_cards):
	"""Every dated charge and receipt for a customer, oldest first."""
	events = []
	accounted_quotations = set()

	for jc in job_cards:
		if jc.quotation:
			accounted_quotations.add(jc.quotation)
		events.append(
			frappe._dict(
				posting_date=getdate(jc.creation),
				voucher_type="Job Card",
				voucher_no=jc.name,
				debit=flt(jc.quotation_amount),
				credit=0.0,
			)
		)

	for p in frappe.get_all(
		"Payments",
		filters={"customer": customer},
		fields=["name", "amount", "date", "payment_type", "payment_method", "reference"],
	):
		is_refund = (p.payment_type or "") == "Refund"
		events.append(
			frappe._dict(
				posting_date=getdate(p.date),
				voucher_type="Refund" if is_refund else "Payment",
				# The receipt reference is what the customer recognises (cheque no, RTGS
				# ref, pesalink); fall back to the Payments id when none was captured.
				voucher_no=(p.reference or "").strip() or str(p.name),
				debit=flt(p.amount) if is_refund else 0.0,
				credit=0.0 if is_refund else flt(p.amount),
				remarks=p.payment_method,
				# Payments is autoincrement-named, so the id orders same-day receipts
				# in the sequence they were actually taken.
				_seq=int(p.name) if str(p.name).isdigit() else 0,
			)
		)

	# Sales Invoices raised outside the job card flow still belong on the statement;
	# ones owned by a job card above are already covered by its quotation_amount.
	for inv in frappe.get_all(
		"Sales Invoice",
		filters={"customer": customer, "docstatus": ["!=", 2]},
		fields=[
			"name",
			"posting_date",
			"grand_total",
			"outstanding_amount",
			"total_taxes_and_charges",
			"custom_source_quotation",
		],
	):
		if inv.custom_source_quotation and inv.custom_source_quotation in accounted_quotations:
			continue
		charge = _gross(inv.grand_total, inv.total_taxes_and_charges)
		settled = charge - _gross(inv.outstanding_amount, inv.total_taxes_and_charges)
		events.append(
			frappe._dict(
				posting_date=getdate(inv.posting_date),
				voucher_type="Sales Invoice",
				voucher_no=inv.name,
				debit=charge,
				credit=0.0,
			)
		)
		if settled > 0:
			events.append(
				frappe._dict(
					posting_date=getdate(inv.posting_date),
					voucher_type="Payment",
					voucher_no=inv.name,
					debit=0.0,
					credit=settled,
				)
			)

	# Charges before receipts on a given day, then receipts in the order they were taken.
	events.sort(key=lambda e: (e.posting_date, e.voucher_type != "Job Card", e.get("_seq") or 0))
	return events


def _build_rows(events, from_date, to_date, currency):
	"""Opening / transactions / Total / Closing, in the shape the print format expects."""
	opening = sum(flt(e.debit) - flt(e.credit) for e in events if e.posting_date < from_date)

	rows = [frappe._dict(account="Opening", debit=0.0, credit=0.0, balance=opening, currency=currency)]

	balance = opening
	total_debit = total_credit = 0.0
	for e in events:
		if e.posting_date < from_date or e.posting_date > to_date:
			continue
		balance += flt(e.debit) - flt(e.credit)
		total_debit += flt(e.debit)
		total_credit += flt(e.credit)
		row = e.copy()
		row.balance = balance
		row.currency = currency
		rows.append(row)

	rows.append(
		frappe._dict(account="Total", debit=total_debit, credit=total_credit, balance=balance, currency=currency)
	)
	rows.append(
		frappe._dict(
			account="Closing (Opening + Total)",
			debit=total_debit,
			credit=total_credit,
			balance=balance,
			currency=currency,
		)
	)
	return rows


def _build_ageing(job_cards, events, to_date, ageing_based_on):
	"""Bucket each job card's unpaid balance by how long ago the job card was opened.

	Job cards carry no due date, so a card opened today is 'current' and everything
	else is counted as past due from its creation date.
	"""
	totals = frappe._dict(current=0.0, range1=0.0, range2=0.0, range3=0.0, range4=0.0)

	for jc in job_cards:
		outstanding = flt(jc.quotation_amount) - flt(jc.payment_amount)
		if outstanding <= 0:
			continue
		age = (to_date - getdate(jc.creation)).days
		if age <= 0:
			totals.current += outstanding
			continue
		for lower, upper, key in AGEING_BUCKETS:
			if lower <= age <= upper:
				totals[key] += outstanding
				break
		else:
			totals.range4 += outstanding

	# Standalone invoices (no owning job card) age from their own posting date.
	for e in events:
		if e.voucher_type != "Sales Invoice":
			continue
		outstanding = flt(e.debit) - sum(
			flt(x.credit) for x in events if x.voucher_no == e.voucher_no and x.voucher_type == "Payment"
		)
		if outstanding <= 0:
			continue
		age = (to_date - e.posting_date).days
		if age <= 0:
			totals.current += outstanding
			continue
		for lower, upper, key in AGEING_BUCKETS:
			if lower <= age <= upper:
				totals[key] += outstanding
				break
		else:
			totals.range4 += outstanding

	totals.total_due = totals.current + totals.range1 + totals.range2 + totals.range3 + totals.range4
	totals.ageing_based_on = ageing_based_on
	return [totals]


def get_statement_dict(doc, psoa):
	"""Job-card replacement for erpnext's get_statement_dict: {customer: rendered html}."""
	from erpnext import get_company_currency
	from erpnext.accounts.party import get_party_account_currency

	statement_dict = {}
	from_date = getdate(doc.from_date) if doc.from_date else getdate("1900-01-01")
	to_date = getdate(doc.to_date or doc.posting_date) if (doc.to_date or doc.posting_date) else getdate()

	for entry in doc.customers:
		customer = entry.customer
		currency = (
			doc.currency
			or get_party_account_currency("Customer", customer, doc.company)
			or get_company_currency(doc.company)
		)

		job_cards = _get_job_cards(customer)
		events = _gather_events(customer, job_cards)
		rows = _build_rows(events, from_date, to_date, currency)

		# Nothing but the Opening/Total/Closing scaffolding means no activity to show.
		if len(rows) <= 3 and not flt(rows[0].balance):
			continue

		ageing = _build_ageing(job_cards, events, to_date, doc.ageing_based_on) if doc.include_ageing else ""

		filters = frappe._dict(
			{
				"company": doc.company,
				"from_date": from_date,
				"to_date": to_date,
				"party": [customer],
				"party_name": [entry.customer_name or customer],
				"presentation_currency": currency,
				"show_remarks": doc.show_remarks,
				"tax_id": frappe.db.get_value("Customer", customer, "tax_id"),
			}
		)

		statement_dict[customer] = psoa.get_html(doc, filters, entry, [], rows, ageing)

	return statement_dict


def _patch(psoa):
	"""Swap erpnext's GL-driven data source for the job-card one, for this call only."""
	psoa.get_statement_dict = lambda doc, get_statement_dict=False: get_statement_dict_shim(
		doc, psoa, get_statement_dict
	)
	return psoa


def get_statement_dict_shim(doc, psoa, raw=False):
	if raw:
		# erpnext only passes raw=True from its own preview helper; no caller here needs it.
		return {}
	return get_statement_dict(doc, psoa)


def _load_psoa():
	from erpnext.accounts.doctype.process_statement_of_accounts import (
		process_statement_of_accounts as psoa,
	)

	return _patch(psoa)


@frappe.whitelist()
def download_statements(document_name):
	psoa = _load_psoa()
	return psoa.download_statements(document_name)


@frappe.whitelist()
def send_emails(document_name, from_scheduler=False, posting_date=None):
	psoa = _load_psoa()
	return psoa.send_emails(document_name, from_scheduler=from_scheduler, posting_date=posting_date)
