"""Open FIFO lots per foreign-currency bank account, with a GL reconciliation.

Answers "which dollars do we still hold, and what did they cost us" -- one row
per surviving lot, oldest first, so the next payment out consumes them top-down.

The reconciliation matters as much as the lots. This ledger is built from
Payment Entries alone, while the GL accepts currency from Journal Entries and
opening balances too. If the two quantities disagree, the cost basis is
incomplete and the report says so rather than presenting a confident wrong
number.
"""

import frappe
from frappe import _
from frappe.query_builder.functions import Sum
from frappe.utils import flt

from crystal_alluminium_works import forex_fifo


def execute(filters=None):
	filters = frappe._dict(filters or {})
	if not filters.company:
		frappe.throw(_("Company is required"))

	_rows, lots_by_account = forex_fifo.build(filters.company, filters.get("account"))
	tracked = forex_fifo.get_tracked_accounts(filters.company)
	gl_balances = _gl_balances(filters.company, list(tracked))

	data = []
	discrepancies = []

	for account in sorted(lots_by_account):
		lots = lots_by_account[account]
		currency = tracked.get(account)

		for lot in lots:
			data.append(
				{
					"account": account,
					"currency": currency,
					"lot_voucher": lot["voucher"],
					"lot_date": lot["date"],
					"qty": lot["qty"],
					"rate": lot["rate"],
					"value": flt(lot["qty"] * lot["rate"], forex_fifo.VALUE_PRECISION),
				}
			)

		fifo_qty = flt(sum(lot["qty"] for lot in lots), forex_fifo.QTY_PRECISION)
		fifo_value = flt(
			sum(lot["qty"] * lot["rate"] for lot in lots), forex_fifo.VALUE_PRECISION
		)
		data.append(
			{
				"account": account,
				"currency": currency,
				# No voucher: this is the account's rolled-up position, not a lot.
				# The client formatter bolds it off `is_total`.
				"lot_voucher": None,
				"qty": fifo_qty,
				"rate": flt(fifo_value / fifo_qty, forex_fifo.RATE_PRECISION) if fifo_qty else 0,
				"value": fifo_value,
				"is_total": 1,
			}
		)

		gl_qty = flt(gl_balances.get(account, 0), forex_fifo.QTY_PRECISION)
		if abs(gl_qty - fifo_qty) > 0.01:
			discrepancies.append((account, currency, fifo_qty, gl_qty))

	return get_columns(), data, _message(discrepancies)


def _gl_balances(company, accounts):
	"""Closing balance per account in its own currency, straight from the GL."""
	if not accounts:
		return {}

	gl = frappe.qb.DocType("GL Entry")
	rows = (
		frappe.qb.from_(gl)
		.select(
			gl.account,
			Sum(gl.debit_in_account_currency).as_("debit"),
			Sum(gl.credit_in_account_currency).as_("credit"),
		)
		.where((gl.company == company) & (gl.account.isin(accounts)) & (gl.is_cancelled == 0))
		.groupby(gl.account)
	).run(as_dict=True)

	return {r.account: flt(r.debit) - flt(r.credit) for r in rows}


def _message(discrepancies):
	if not discrepancies:
		return None

	lines = [
		_("<b>{0}</b>: FIFO ledger {1:,.2f} {2} vs general ledger {3:,.2f} {2}").format(
			account, fifo_qty, currency, gl_qty
		)
		for account, currency, fifo_qty, gl_qty in discrepancies
	]
	return (
		_(
			"<b>The lot ledger and the general ledger disagree.</b> This ledger is "
			"built from submitted Payment Entries only, so currency moved by a "
			"Journal Entry, or an opening balance never entered as a Payment Entry, "
			"is invisible to it and has no cost basis. Reconcile before relying on "
			"these valuations."
		)
		+ "<br>"
		+ "<br>".join(lines)
	)


def get_columns():
	return [
		{
			"fieldname": "account",
			"label": _("Account"),
			"fieldtype": "Link",
			"options": "Account",
			"width": 200,
		},
		{
			"fieldname": "currency",
			"label": _("Currency"),
			"fieldtype": "Link",
			"options": "Currency",
			"width": 90,
		},
		{
			"fieldname": "lot_date",
			"label": _("Acquired"),
			"fieldtype": "Date",
			"width": 100,
		},
		{
			"fieldname": "lot_voucher",
			"label": _("Acquired Via"),
			"fieldtype": "Link",
			"options": "Payment Entry",
			"width": 160,
		},
		{
			"fieldname": "qty",
			"label": _("Quantity"),
			"fieldtype": "Float",
			"precision": 2,
			"width": 120,
		},
		{
			"fieldname": "rate",
			"label": _("Cost Rate"),
			"fieldtype": "Float",
			"precision": 4,
			"width": 120,
		},
		{
			"fieldname": "value",
			"label": _("Book Value"),
			"fieldtype": "Currency",
			"width": 150,
		},
	]
