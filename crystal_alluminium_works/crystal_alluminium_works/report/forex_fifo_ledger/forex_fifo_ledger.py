"""Movement-by-movement FIFO ledger for foreign-currency bank accounts.

Each row is one movement of currency in or out of a tracked account, showing
which lots an outbound movement consumed and what that realised. See
``crystal_alluminium_works.forex_fifo`` for the rules.
"""

import frappe
from frappe import _
from frappe.utils import getdate

from crystal_alluminium_works import forex_fifo


def execute(filters=None):
	filters = frappe._dict(filters or {})
	if not filters.company:
		frappe.throw(_("Company is required"))

	rows, _lots = forex_fifo.build(filters.company, filters.get("account"))

	# The replay always runs over the whole history -- FIFO allocation depends
	# on it -- so the date filter narrows what is shown, never what is read.
	from_date = getdate(filters.from_date) if filters.get("from_date") else None
	to_date = getdate(filters.to_date) if filters.get("to_date") else None

	data = []
	for row in rows:
		posting_date = getdate(row["posting_date"])
		if from_date and posting_date < from_date:
			continue
		if to_date and posting_date > to_date:
			continue
		data.append(_format(row))

	return get_columns(), data, _message(rows)


def _format(row):
	return {
		"posting_date": row["posting_date"],
		"voucher": row["voucher"],
		"account": row["account"],
		"movement_type": row["movement_type"],
		"party": row.get("party"),
		"counter_account": row.get("counter_account"),
		"qty_in": row["qty_in"] or None,
		"qty_out": row["qty_out"] or None,
		# The rate on the document. Inbound that is the rate the currency was
		# booked in at; outbound it is the FIFO cost stamped on the entry, so it
		# tracks the cost column rather than the market. Kept as a separate
		# column because a divergence between the two means an entry was posted
		# before costing applied, or history moved under one that already had.
		"txn_rate": row.get("txn_rate")
		if row["qty_out"]
		else _acquisition_rate(row["value_in"], row["qty_in"]),
		"value_in": row["value_in"] or None,
		"cost_out": row["cost_out"] or None,
		"avg_cost_rate": row.get("avg_cost_rate") or None,
		"realized_gain_loss": row["realized_gain_loss"] or None,
		"lots_consumed": _describe_lots(row),
		"balance_qty": row["balance_qty"],
		"balance_rate": row["balance_rate"],
		"balance_value": row["balance_value"],
		"shortfall": row["shortfall"] or None,
	}


def _acquisition_rate(value, qty):
	return round(value / qty, 4) if qty else None


def _describe_lots(row):
	"""Human-readable allocation trail, e.g. ``100 @ 128.50 (PE-0005)``."""
	if row["movement_type"] in forex_fifo.INBOUND:
		return ""
	parts = [
		"{qty:,.2f} @ {rate:,.4f} ({voucher})".format(**alloc) for alloc in row["allocations"]
	]
	if row["shortfall"]:
		parts.append(_("{0:,.2f} UNCOSTED").format(row["shortfall"]))
	return "<br>".join(parts)


def _message(rows):
	"""Warn when the ledger cannot see all the currency that moved."""
	short = [r for r in rows if r["shortfall"]]
	if not short:
		return None

	vouchers = ", ".join(sorted({r["voucher"] for r in short})[:5])
	return _(
		"<b>{0} movement(s) drew on currency this ledger never saw arrive</b> ({1}). "
		"FIFO here is built from submitted Payment Entries only, so currency moved by "
		"a Journal Entry, or an opening balance that was never entered as a Payment "
		"Entry, has no cost basis. Those quantities are shown as UNCOSTED and carry "
		"no gain or loss."
	).format(len(short), vouchers)


def get_columns():
	return [
		{
			"fieldname": "posting_date",
			"label": _("Date"),
			"fieldtype": "Date",
			"width": 95,
		},
		{
			"fieldname": "voucher",
			"label": _("Payment Entry"),
			"fieldtype": "Link",
			"options": "Payment Entry",
			"width": 150,
		},
		{
			"fieldname": "account",
			"label": _("Account"),
			"fieldtype": "Link",
			"options": "Account",
			"width": 170,
		},
		{
			"fieldname": "movement_type",
			"label": _("Movement"),
			"fieldtype": "Data",
			"width": 100,
		},
		{
			"fieldname": "party",
			"label": _("Party"),
			"fieldtype": "Data",
			"width": 140,
		},
		{
			"fieldname": "qty_in",
			"label": _("In (FCY)"),
			"fieldtype": "Float",
			"precision": 2,
			"width": 100,
		},
		{
			"fieldname": "qty_out",
			"label": _("Out (FCY)"),
			"fieldtype": "Float",
			"precision": 2,
			"width": 100,
		},
		{
			"fieldname": "txn_rate",
			"label": _("Posted Rate"),
			"fieldtype": "Float",
			"precision": 4,
			"width": 95,
		},
		{
			"fieldname": "avg_cost_rate",
			"label": _("FIFO Cost Rate"),
			"fieldtype": "Float",
			"precision": 4,
			"width": 120,
		},
		{
			"fieldname": "value_in",
			"label": _("Value In"),
			"fieldtype": "Currency",
			"width": 120,
		},
		{
			"fieldname": "cost_out",
			"label": _("Cost Released"),
			"fieldtype": "Currency",
			"width": 130,
		},
		{
			"fieldname": "realized_gain_loss",
			"label": _("Realised Gain / (Loss)"),
			"fieldtype": "Currency",
			"width": 165,
		},
		{
			"fieldname": "lots_consumed",
			"label": _("Lots Consumed"),
			"fieldtype": "Data",
			"width": 260,
		},
		{
			"fieldname": "balance_qty",
			"label": _("Balance (FCY)"),
			"fieldtype": "Float",
			"precision": 2,
			"width": 120,
		},
		{
			"fieldname": "balance_rate",
			"label": _("Balance Cost Rate"),
			"fieldtype": "Float",
			"precision": 4,
			"width": 140,
		},
		{
			"fieldname": "balance_value",
			"label": _("Balance Value"),
			"fieldtype": "Currency",
			"width": 130,
		},
	]
