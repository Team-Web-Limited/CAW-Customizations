"""Patches ERPNext's Process Statement Of Accounts ageing calculation.

Core's set_ageing() (erpnext.accounts.report.accounts_receivable_summary) folds
not-yet-due amounts into the same bucket as invoices 0-30 days overdue, so a
statement has no genuine "current" total. This recomputes the buckets from the
Accounts Receivable detail report, which tracks not-yet-due amounts separately
per row (row.range0), and merges the 90-120 and 120+ buckets into a single
"over 90" bucket to match the Crystal Statement of Accounts print format.

Wired up via override_whitelisted_methods in hooks.py rather than patched at
import time, so the patch only applies (and erpnext's report modules only get
imported) when a statement is actually downloaded or emailed.
"""

import frappe
from frappe.utils import flt


def get_accurate_ageing(doc, entry):
	from erpnext.accounts.report.accounts_receivable.accounts_receivable import execute as get_ar_soa

	filters = frappe._dict(
		{
			"company": doc.company,
			"report_date": doc.posting_date,
			"ageing_based_on": doc.ageing_based_on,
			"party_type": "Customer",
			"party": [entry.customer],
		}
	)
	_, rows = get_ar_soa(filters)[:2]

	totals = frappe._dict(current=0.0, range1=0.0, range2=0.0, range3=0.0, range4=0.0)
	for row in rows:
		if not row.get("party"):
			continue
		totals.current += flt(row.get("range0"))
		totals.range1 += flt(row.get("range1"))
		totals.range2 += flt(row.get("range2"))
		totals.range3 += flt(row.get("range3"))
		totals.range4 += flt(row.get("range4")) + flt(row.get("range5"))

	totals.total_due = totals.current + totals.range1 + totals.range2 + totals.range3 + totals.range4
	totals.ageing_based_on = doc.ageing_based_on
	return [totals]


def _apply_ageing_patch():
	from erpnext.accounts.doctype.process_statement_of_accounts import (
		process_statement_of_accounts as psoa,
	)

	def set_ageing(doc, entry):
		return get_accurate_ageing(doc, entry)

	psoa.set_ageing = set_ageing
	return psoa


@frappe.whitelist()
def download_statements(document_name):
	psoa = _apply_ageing_patch()
	return psoa.download_statements(document_name)


@frappe.whitelist()
def send_emails(document_name, from_scheduler=False, posting_date=None):
	psoa = _apply_ageing_patch()
	return psoa.send_emails(document_name, from_scheduler=from_scheduler, posting_date=posting_date)
