"""Cost the currency leaving a foreign-currency bank account.

The exchange rate on a payment out of a tracked account is not typed -- it is
derived from what the dollars being spent actually cost, oldest lots first. See
``forex_fifo.py`` for the ledger this reads and the reasoning behind it.

Why the rate is taken away from the person entering the document: paying at the
day's market rate credits the bank with more (or less) than the dollars cost,
and the difference stays behind as a residue in the account's shilling balance
rather than being recognised anywhere. Costing the outflow removes it -- the
account carries what it holds at what it cost, and the whole result of settling
reaches the P&L at once through the difference against the payable.

This runs on ``before_validate`` deliberately. Setting the rate before ERPNext's
own ``validate`` means every downstream figure -- base amounts, the exchange
gain/loss deduction, allocation checks -- is computed from it by ERPNext itself.
Setting it afterwards would leave those figures derived from a rate no longer on
the document.

Three things are deliberately *not* done here:

* Inbound movements are untouched. Dollars arriving carry the rate the document
  recorded, which becomes their cost basis; there is nothing to derive.
* The rate is not fetched or defaulted when the ledger is short. A payment
  larger than the recorded holding has no cost, and inventing one would post a
  fabricated figure to the GL, so it is refused instead.
* Later entries are not reposted when history changes. They cannot be -- they
  are already submitted. The warning below is the only defence short of closing
  the period, and it is worth heeding.
"""

import frappe
from frappe import _
from frappe.utils import flt, getdate

from crystal_alluminium_works.forex_fifo import (
	EPSILON,
	get_cost_rate,
	get_tracked_accounts,
)


def set_fifo_exchange_rate(doc, method=None):
	"""Stamp the FIFO cost of the outgoing currency onto the Payment Entry."""
	if doc.docstatus > 0:
		return

	if not doc.company or not doc.paid_from or not flt(doc.paid_amount):
		return

	tracked = get_tracked_accounts(doc.company)
	if doc.paid_from not in tracked:
		# Money is not leaving a foreign-currency holding, so there is no cost
		# basis to apply. Receipts land here too, and are handled by the ledger
		# on the way in rather than by a rate on the way out.
		return

	detail = get_cost_rate(
		doc.company,
		doc.paid_from,
		flt(doc.paid_amount),
		doc.posting_date,
		tracked=tracked,
	)

	if detail["shortfall"] > EPSILON:
		_throw_shortfall(doc, detail, tracked[doc.paid_from])

	doc.source_exchange_rate = detail["rate"]

	# A same-currency move between two tracked accounts carries its cost across
	# intact, so both halves are valued identically and no difference arises.
	# ERPNext would do this itself in validate(), but only for a rate that was
	# already on the document when validate() started.
	if doc.paid_from_account_currency and doc.paid_from_account_currency == doc.paid_to_account_currency:
		doc.target_exchange_rate = detail["rate"]

	_warn_if_history_moves(doc)


def _throw_shortfall(doc, detail, currency):
	"""Refuse to post currency whose cost this ledger never saw.

	Almost always this means dollars reached the account through something the
	ledger does not read -- a Journal Entry, or an opening balance carried in
	before go-live. Both are fixable; guessing a rate is not.
	"""
	frappe.throw(
		_(
			"{0} holds only {1} with a recorded cost, but this entry pays out {2}. "
			"The missing {3} reached the account through something this ledger does "
			"not read -- usually a Journal Entry or an opening balance. Record it as "
			"a Payment Entry so its cost is known, then submit this one."
		).format(
			frappe.bold(doc.paid_from),
			frappe.bold(f"{flt(detail['available_qty']):,.2f} {currency}"),
			frappe.bold(f"{flt(doc.paid_amount):,.2f} {currency}"),
			frappe.bold(f"{flt(detail['shortfall']):,.2f} {currency}"),
		),
		title=_("No Cost Basis for This Payment"),
	)


def _warn_if_history_moves(doc):
	"""Flag a backdated entry that changes what later payments already posted.

	FIFO allocation depends on order, so slotting an entry into the past changes
	which lots every later payment consumed -- and those payments carry rates
	derived from the old order straight into the GL. The ledger reports itself
	correctly on the next read either way; the postings are what go stale.
	"""
	if not doc.posting_date:
		return

	later = frappe.get_all(
		"Payment Entry",
		filters={
			"docstatus": 1,
			"company": doc.company,
			"posting_date": [">", getdate(doc.posting_date)],
		},
		or_filters=[["paid_from", "=", doc.paid_from], ["paid_to", "=", doc.paid_from]],
		fields=["name"],
		limit=1,
	)
	if not later:
		return

	frappe.msgprint(
		_(
			"This entry is dated before submitted payments on {0}, so it changes which "
			"lots those later payments drew on. Their exchange rates were worked out "
			"from the previous order and are not recalculated. Check {1} and anything "
			"after it, or date this entry today instead."
		).format(frappe.bold(doc.paid_from), frappe.bold(later[0].name)),
		title=_("Backdated Entry Affects Later Payments"),
		indicator="orange",
	)
