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


def _get_job_card_invoices(quotations):
	"""The Job Card is purely internal bookkeeping — the customer's own reference for
	what they used to pick up goods is the Sales Invoice(s) raised against it. Batched
	by quotation (a job card's invoices are found via Sales Invoice.custom_source_quotation,
	same lookup api.get_sales_invoices_page uses) rather than one query per job card."""
	if not quotations:
		return {}
	rows = frappe.get_all(
		"Sales Invoice",
		filters={"custom_source_quotation": ["in", list(quotations)], "docstatus": 1},
		fields=["name", "custom_source_quotation", "posting_date", "grand_total", "total_taxes_and_charges"],
		order_by="posting_date asc, creation asc",
	)
	invoices_by_quotation = {}
	for row in rows:
		invoices_by_quotation.setdefault(row.custom_source_quotation, []).append(row)
	return invoices_by_quotation


def _gather_events(customer, job_cards):
	"""Every dated charge and receipt for a customer, oldest first."""
	events = []
	accounted_quotations = set()

	invoices_by_quotation = _get_job_card_invoices([jc.quotation for jc in job_cards if jc.quotation])

	for jc in job_cards:
		if jc.quotation:
			accounted_quotations.add(jc.quotation)
		invoices = invoices_by_quotation.get(jc.quotation) if jc.quotation else None

		if not invoices:
			# Nothing's been invoiced yet (e.g. still awaiting full payment) — fall
			# back to the Job Card reference since there's nothing else to point at.
			events.append(
				frappe._dict(
					posting_date=getdate(jc.creation),
					voucher_type="Job Card",
					voucher_no=jc.name,
					debit=flt(jc.quotation_amount),
					credit=0.0,
					_is_job_card_charge=True,
				)
			)
			continue

		# Split into one row per invoice — each is its own dated charge, not one lump
		# sum under the job card. Sum by each invoice's own grossed amount rather than
		# assuming they add up to jc.quotation_amount, since a job card can be only
		# partially invoiced so far.
		invoiced_total = 0.0
		for inv in invoices:
			charge = _gross(inv.grand_total, inv.total_taxes_and_charges)
			invoiced_total += charge
			events.append(
				frappe._dict(
					posting_date=getdate(inv.posting_date),
					voucher_type="Sales Invoice",
					voucher_no=inv.name,
					debit=charge,
					credit=0.0,
					_is_job_card_charge=True,
				)
			)

		# The rest of the quotation hasn't been invoiced yet — still owed, so it still
		# needs a charge row, just against the Job Card since no invoice covers it.
		remaining = flt(jc.quotation_amount) - invoiced_total
		if remaining > 0.5:
			events.append(
				frappe._dict(
					posting_date=getdate(jc.creation),
					voucher_type="Job Card",
					voucher_no=jc.name,
					debit=remaining,
					credit=0.0,
					_is_job_card_charge=True,
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
	events.sort(key=lambda e: (e.posting_date, not e.get("_is_job_card_charge"), e.get("_seq") or 0))
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

	# Standalone invoices (no owning job card) age from their own posting date. Job
	# cards are aged above from their own creation date instead — a job-card-derived
	# event may now also display voucher_type "Sales Invoice" (see _gather_events), so
	# exclude those explicitly rather than relying on voucher_type alone.
	for e in events:
		if e.voucher_type != "Sales Invoice" or e.get("_is_job_card_charge"):
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


# This app only ever wants the job-card statement rendered through its own layout,
# never erpnext's plain default HTML. Older PSOA rows (and any created without
# manually picking a print format) are saved with this field empty, and erpnext's
# get_html() silently falls back to its default template when it is - so force it
# here rather than depend on someone remembering to pick it in the UI.
CRYSTAL_STATEMENT_PRINT_FORMAT = "Crystal Statement of Accounts"

# The statement layout is sized for a portrait page. erpnext's Orientation field has no
# default and frappe fills an empty Select with its first option ("Landscape"), so any
# document saved before the client script landed - and anything created over the API or
# by the statement scheduler - still carries Landscape. Force it alongside the format.
CRYSTAL_STATEMENT_ORIENTATION = "Portrait"


def _ensure_print_settings(document_name):
	updates = {
		"print_format": CRYSTAL_STATEMENT_PRINT_FORMAT,
		"orientation": CRYSTAL_STATEMENT_ORIENTATION,
	}
	current = frappe.db.get_value(
		"Process Statement Of Accounts", document_name, list(updates), as_dict=True
	)
	stale = {field: value for field, value in updates.items() if current.get(field) != value}
	if stale:
		frappe.db.set_value("Process Statement Of Accounts", document_name, stale)


@frappe.whitelist()
def download_statements(document_name):
	_ensure_print_settings(document_name)
	psoa = _load_psoa()
	return psoa.download_statements(document_name)


@frappe.whitelist(methods=["GET"])
def download_customer_statement_of_account(customer):
	"""One-click statement for a single customer (Customer Manager's "Statement of
	Account" filter) — builds an in-memory Process Statement Of Accounts doc rather
	than inserting a real one, so clicking this never leaves a throwaway record in
	that doctype's list (same reasoning as the app's other download-only exports:
	stream, don't save_file)."""
	from crystal_alluminium_works.api import _get_default_company

	customer_doc = frappe.get_doc("Customer", customer)
	psoa = _load_psoa()

	doc = frappe.new_doc("Process Statement Of Accounts")
	doc.company = _get_default_company()
	doc.from_date = "1900-01-01"
	doc.to_date = frappe.utils.today()
	doc.include_ageing = 1
	doc.ageing_based_on = "Due Date"
	doc.include_break = 0
	doc.orientation = CRYSTAL_STATEMENT_ORIENTATION
	doc.print_format = CRYSTAL_STATEMENT_PRINT_FORMAT
	doc.show_remarks = 0
	doc.append("customers", {"customer": customer_doc.name, "customer_name": customer_doc.customer_name})

	report = psoa.get_report_pdf(doc)
	if not report:
		frappe.throw(f"No statement activity found for {customer_doc.customer_name or customer_doc.name}.")

	frappe.response["filename"] = f"Statement of Account - {customer_doc.customer_name or customer_doc.name}.pdf"
	frappe.response["filecontent"] = report
	frappe.response["type"] = "download"


@frappe.whitelist()
def send_emails(document_name, from_scheduler=False, posting_date=None):
	_ensure_print_settings(document_name)
	psoa = _load_psoa()
	return psoa.send_emails(document_name, from_scheduler=from_scheduler, posting_date=posting_date)
