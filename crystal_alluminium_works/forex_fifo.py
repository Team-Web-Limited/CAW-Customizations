"""FIFO cost-basis tracking for foreign-currency bank accounts.

The books are kept in KES, so each foreign-currency bank account is treated as
an inventory of foreign currency: every unit that enters carries the KES cost it
was acquired at, and every unit that leaves consumes the oldest lot first,
realising the difference against the rate of the outgoing transaction.

Two rules drive everything here:

* Direction, not ``payment_type``, decides the effect. A Payment Entry moves
  lots because it debits or credits a tracked account -- "Internal Transfer" is
  only the usual way a purchase of currency is entered, not the definition of
  one. Keying off ``payment_type`` alone would read a USD->USD transfer between
  the two bank accounts as a sale on one side and a purchase on the other, and
  invent a gain that never happened.
* Gain is realised only when the currency is genuinely converted back to KES.
  Currency arriving lands at the rate the GL recorded it at, so it has no gain
  of its own; the invoice-rate-vs-receipt-rate difference is receivable FX and
  ERPNext has already booked it against Debtors. Paying a supplier in dollars
  out of a dollar account converts nothing, so it realises nothing either --
  see the note on cost basis below. Selling dollars for shillings does convert,
  and the shillings received are a fact, so that is where gain appears.

The ledger is *derived*: it replays submitted Payment Entries from the
beginning on every read rather than storing lot state. Backdated, amended and
cancelled entries therefore need no repost machinery -- the next read just sees
a different history. At this business's volume a full replay is a few
milliseconds, which buys immunity from the drift that incremental lot tables
suffer.

This ledger *determines* the exchange rate on outgoing Payment Entries rather
than merely describing them: ``payment_entry_forex_rate.py`` stamps the FIFO
cost of the currency being spent onto the document before it saves, so the GL
credits the bank with what those dollars actually cost.

Left to itself ERPNext credits the bank at the rate of each outgoing payment and
books no exchange gain against the bank at all. After buying 500 USD at 130 and
paying 200 away at 131.50 the account would hold 300 USD carried at 38,700 KES
-- an implied 129.00, which is neither what the dollars cost (130.00) nor any
spot rate that ever existed. That residue is what costing the outflow removes:
the account stays at 130.00, because the 200 dollars that left cost 130.00.

Two consequences follow, and both matter more than they look.

The first is that this module is now GL-determining, which makes history edits
consequential. A backdated or cancelled entry changes which lots later payments
consumed, and those later payments have already posted. Nothing reposts them --
the handler warns when it spots the situation, but the real defence is closing
periods.

The second is that a payment out of a dollar account to a dollar payable now
realises nothing here, by construction: the rate stamped on it *is* the cost
rate, so proceeds equal cost. That is the intended reading -- spending dollars
on a dollar invoice converts no currency. The whole economic result of settling
still reaches the P&L, as the difference between the payable's invoice rate and
this cost rate, which ERPNext books natively against Creditors. Gain appears in
this ledger only on a genuine sale of currency, where ``proceeds`` carries the
shillings actually received.

What the dollars are worth *today* remains Exchange Rate Revaluation's job. It
composes with this ledger because the two measure different things: cost basis
here, closing rate there. Between month-ends the books carry currency at cost;
at each reporting date revaluation restates it.
"""

import frappe
from frappe.utils import flt, getdate

import erpnext

QTY_PRECISION = 4
RATE_PRECISION = 6
VALUE_PRECISION = 2

# Below this many currency units a lot counts as exhausted. Repeated partial
# consumption leaves float dust behind; without a floor those crumbs stay at the
# head of the queue forever and every later allocation drags them along.
EPSILON = 1e-6

# Only real holdings of currency get a cost basis. A USD receivable is not
# currency you hold -- it is a claim ERPNext already revalues per invoice -- so
# letting Debtors/Creditors into the lot ledger would both double-count the
# receivable FX and pollute the bank's cost basis.
TRACKED_ACCOUNT_TYPES = ("Bank", "Cash")

# Movement types, in the vocabulary of the business rather than the doctype.
BUY = "Buy"  # company currency -> tracked account
RECEIPT = "Receipt"  # customer settles in foreign currency
PAYMENT = "Payment"  # supplier paid out of a tracked account
SELL = "Sell"  # tracked account -> company currency
TRANSFER_IN = "Transfer In"  # between two tracked accounts of the same currency
TRANSFER_OUT = "Transfer Out"

INBOUND = (BUY, RECEIPT, TRANSFER_IN)
OUTBOUND = (PAYMENT, SELL, TRANSFER_OUT)


# ---------------------------------------------------------------------------
# Pure FIFO core -- no frappe, no database, so it can be reasoned about and
# tested on its own.
# ---------------------------------------------------------------------------


def consume(lots, qty):
	"""Take ``qty`` off the front of ``lots``, oldest first.

	``lots`` is mutated: exhausted lots are dropped. Returns the allocations
	made and any shortfall. A shortfall means the account went below zero,
	which the caller surfaces rather than swallows -- it almost always means
	currency moved through a document this ledger does not read (a Journal
	Entry) or an opening balance was never captured.
	"""
	allocations = []
	remaining = flt(qty, QTY_PRECISION)

	while remaining > EPSILON and lots:
		lot = lots[0]
		take = min(lot["qty"], remaining)
		allocations.append(
			{
				"voucher": lot["voucher"],
				"date": lot["date"],
				"qty": flt(take, QTY_PRECISION),
				"rate": lot["rate"],
				"value": flt(take * lot["rate"], VALUE_PRECISION),
			}
		)
		lot["qty"] = flt(lot["qty"] - take, QTY_PRECISION)
		remaining = flt(remaining - take, QTY_PRECISION)
		if lot["qty"] <= EPSILON:
			lots.pop(0)

	return allocations, max(remaining, 0.0)


def replay(movements):
	"""Replay ordered movements into a lot ledger.

	Each movement is a dict with ``account``, ``currency``, ``posting_date``,
	``voucher``, ``movement_type`` and ``qty``; inbound ones carry ``value``
	(the KES the GL moved), outbound ones carry ``txn_rate``. Transfer pairs
	are emitted out-then-in and share a voucher, which is what lets the
	inbound half pick up the very lots the outbound half released.

	Returns ``(rows, lots_by_account)``: ``rows`` mirrors ``movements``
	enriched with allocations, realised gain/loss and running balances;
	``lots_by_account`` holds the closing lots.
	"""
	lots_by_account = {}
	rows = []
	# Lots released by a Transfer Out, waiting for their Transfer In partner.
	in_transit = {}

	for mv in movements:
		account = mv["account"]
		lots = lots_by_account.setdefault(account, [])
		row = dict(mv)
		row["allocations"] = []
		row["realized_gain_loss"] = 0.0
		row["proceeds"] = 0.0
		row["shortfall"] = 0.0
		row["qty_in"] = 0.0
		row["qty_out"] = 0.0
		row["value_in"] = 0.0
		row["cost_out"] = 0.0

		if mv["movement_type"] in INBOUND:
			if mv["movement_type"] == TRANSFER_IN:
				# Carry the paying account's lots over intact, so a same-currency
				# move preserves cost basis instead of re-costing at today's rate.
				incoming = in_transit.pop((mv["voucher"], mv["counter_account"]), [])
			else:
				incoming = [
					{
						"voucher": mv["voucher"],
						"date": mv["posting_date"],
						"qty": flt(mv["qty"], QTY_PRECISION),
						"rate": _rate(mv["value"], mv["qty"]),
					}
				]

			for lot in incoming:
				lots.append(dict(lot))

			row["qty_in"] = flt(sum(lot["qty"] for lot in incoming), QTY_PRECISION)
			row["value_in"] = flt(
				sum(lot["qty"] * lot["rate"] for lot in incoming), VALUE_PRECISION
			)
			row["allocations"] = incoming

		else:
			allocations, shortfall = consume(lots, mv["qty"])
			cost_out = flt(sum(a["value"] for a in allocations), VALUE_PRECISION)
			consumed_qty = flt(sum(a["qty"] for a in allocations), QTY_PRECISION)

			row["allocations"] = allocations
			row["shortfall"] = shortfall
			row["qty_out"] = flt(mv["qty"], QTY_PRECISION)
			row["cost_out"] = cost_out
			row["avg_cost_rate"] = _rate(cost_out, consumed_qty)

			# What was actually got for the currency. A sale carries ``proceeds``
			# -- the shillings the GL really received -- because that is a fact
			# rather than a rate. Everything else is valued at the document's own
			# rate, which since costing is applied to outflows *is* the cost rate,
			# so proceeds equal cost and nothing is realised. That is the point:
			# spending dollars on a dollar invoice converts no currency.
			proceeds = mv.get("proceeds")
			if proceeds is None:
				proceeds = flt(consumed_qty * mv["txn_rate"], VALUE_PRECISION)
			elif shortfall and flt(mv["qty"]):
				# Only the part that had a cost basis can be measured against.
				proceeds = flt(flt(proceeds) * consumed_qty / flt(mv["qty"]), VALUE_PRECISION)
			
			row["proceeds"] = flt(proceeds, VALUE_PRECISION)
			
			# Gain is measured only on what actually had a cost basis. Valuing a
			# shortfall at the proceeds rate would book a 100% "gain" on currency
			# whose acquisition this ledger never saw.
			row["realized_gain_loss"] = flt(row["proceeds"] - cost_out, VALUE_PRECISION)

			if mv["movement_type"] == TRANSFER_OUT:
				# Nothing is realised in transit -- the currency is still held,
				# just somewhere else. Any quantity that fails to arrive (a bank
				# fee taken in currency) is a real loss of the oldest lots, which
				# is exactly what FIFO says leaves first.
				row["realized_gain_loss"] = 0.0
				arriving = flt(mv.get("qty_arriving", mv["qty"]), QTY_PRECISION)
				carried, _short = consume([dict(a) for a in allocations], arriving)
				in_transit[(mv["voucher"], account)] = carried
				row["transfer_fee_cost"] = flt(
					cost_out - sum(c["value"] for c in carried), VALUE_PRECISION
				)

		row["balance_qty"] = flt(sum(lot["qty"] for lot in lots), QTY_PRECISION)
		row["balance_value"] = flt(
			sum(lot["qty"] * lot["rate"] for lot in lots), VALUE_PRECISION
		)
		row["balance_rate"] = _rate(row["balance_value"], row["balance_qty"])
		rows.append(row)

	return rows, lots_by_account


def _rate(value, qty):
	return flt(flt(value) / flt(qty), RATE_PRECISION) if flt(qty) else 0.0


# ---------------------------------------------------------------------------
# Reading Payment Entries into movements
# ---------------------------------------------------------------------------


def get_tracked_accounts(company):
	"""Bank/cash accounts held in a currency other than the company's."""
	company_currency = erpnext.get_company_currency(company)
	accounts = frappe.get_all(
		"Account",
		filters={
			"company": company,
			"is_group": 0,
			"account_type": ["in", TRACKED_ACCOUNT_TYPES],
		},
		fields=["name", "account_currency"],
	)
	return {a.name: a.account_currency for a in accounts if a.account_currency != company_currency}


def get_movements(company, tracked=None):
	"""Every lot movement implied by submitted Payment Entries, in order.

	Always read from the very first entry: FIFO allocation depends on the whole
	history, so a date filter belongs on the *display* of the result, never on
	the input to it.
	"""
	tracked = tracked if tracked is not None else get_tracked_accounts(company)
	if not tracked:
		return []

	names = list(tracked)
	entries = frappe.get_all(
		"Payment Entry",
		filters={"docstatus": 1, "company": company},
		or_filters=[["paid_from", "in", names], ["paid_to", "in", names]],
		fields=[
			"name",
			"posting_date",
			"payment_type",
			"party",
			"paid_from",
			"paid_to",
			"paid_from_account_currency",
			"paid_to_account_currency",
			"paid_amount",
			"received_amount",
			"base_paid_amount",
			"base_received_amount",
			"remarks",
		],
		order_by="posting_date asc, creation asc, name asc",
	)

	movements = []
	for pe in entries:
		source = pe.paid_from if pe.paid_from in tracked else None
		target = pe.paid_to if pe.paid_to in tracked else None

		common = {
			"voucher": pe.name,
			"posting_date": pe.posting_date,
			"payment_type": pe.payment_type,
			"party": pe.party,
			"remarks": pe.remarks,
		}

		if source and target and pe.paid_from_account_currency == pe.paid_to_account_currency:
			# Emitted as a pair, out first, so `replay` can hand the lots across.
			movements.append(
				dict(
					common,
					account=source,
					currency=tracked[source],
					counter_account=target,
					movement_type=TRANSFER_OUT,
					qty=flt(pe.paid_amount, QTY_PRECISION),
					qty_arriving=flt(pe.received_amount, QTY_PRECISION),
					txn_rate=_rate(pe.base_paid_amount, pe.paid_amount),
				)
			)
			movements.append(
				dict(
					common,
					account=target,
					currency=tracked[target],
					counter_account=source,
					movement_type=TRANSFER_IN,
					qty=flt(pe.received_amount, QTY_PRECISION),
					value=flt(pe.base_received_amount, VALUE_PRECISION),
				)
			)
			continue

		if source:
			# Moving currency back into the company's own currency is a sale of
			# it; paying a supplier just spends it. Only the sale realises
			# anything, and the distinction is the whole reason for the split.
			movement_type = SELL if pe.payment_type == "Internal Transfer" else PAYMENT
			outgoing = dict(
				common,
				account=source,
				currency=tracked[source],
				counter_account=pe.paid_to,
				movement_type=movement_type,
				qty=flt(pe.paid_amount, QTY_PRECISION),
				txn_rate=_rate(pe.base_paid_amount, pe.paid_amount),
			)

			if movement_type == SELL:
				# The shillings that actually landed in the receiving account.
				# Gain on a sale is measured against this rather than against a
				# rate, because the outgoing rate is now the cost rate and would
				# report every sale as breaking even.
				outgoing["proceeds"] = flt(pe.base_received_amount, VALUE_PRECISION)

			movements.append(outgoing)

		if target:
			movements.append(
				dict(
					common,
					account=target,
					currency=tracked[target],
					counter_account=pe.paid_from,
					movement_type=BUY if pe.payment_type == "Internal Transfer" else RECEIPT,
					qty=flt(pe.received_amount, QTY_PRECISION),
					# base_received_amount is what the GL actually debited the
					# bank, so lots are costed at exactly the rate the books
					# used and the ledger can never drift from the GL.
					value=flt(pe.base_received_amount, VALUE_PRECISION),
				)
			)

	return movements


def build(company, account=None):
	"""Replay the full history; optionally narrow the result to one account.

	Filtering happens after the replay because a transfer's two halves must
	both be seen for cost basis to cross between accounts.
	"""
	tracked = get_tracked_accounts(company)
	rows, lots_by_account = replay(get_movements(company, tracked))

	if account:
		rows = [r for r in rows if r["account"] == account]
		lots_by_account = {k: v for k, v in lots_by_account.items() if k == account}

	return rows, lots_by_account


# ---------------------------------------------------------------------------
# Cost basis for a document being written
# ---------------------------------------------------------------------------


def get_lots_as_of(company, account, posting_date, tracked=None):
	"""Lots held in ``account`` at the close of ``posting_date``.

	Movements after that date are excluded so a backdated document consumes the
	lots that existed when it says it happened, not the ones that exist now.
	Entries dated the same day are included: they were submitted first, and
	ordering within a day is by creation anyway.
	"""
	tracked = tracked if tracked is not None else get_tracked_accounts(company)
	if account not in tracked:
		return []

	cutoff = getdate(posting_date)
	movements = [
		mv for mv in get_movements(company, tracked) if getdate(mv["posting_date"]) <= cutoff
	]
	_rows, lots_by_account = replay(movements)
	return lots_by_account.get(account, [])


def get_cost_rate(company, account, qty, posting_date, tracked=None):
	"""What ``qty`` leaving ``account`` on ``posting_date`` cost, oldest lots first.

	Returns the blended rate to put on the document along with the workings, so
	a caller can explain the number rather than just assert it. ``shortfall`` is
	how much of ``qty`` no lot could cover; callers decide what that means, and
	the Payment Entry handler refuses to post it.

	The rate is blended because a payment routinely spans lots -- 20 at 130 plus
	15 at 129 is 4,535 KES for 35 USD, so the document carries 129.571429. That
	rate matches no market quote and is not meant to: it is the cost of that
	particular mix of dollars.
	"""
	lots = get_lots_as_of(company, account, posting_date, tracked=tracked)
	available = flt(sum(lot["qty"] for lot in lots), QTY_PRECISION)

	allocations, shortfall = consume([dict(lot) for lot in lots], qty)
	cost = flt(sum(a["value"] for a in allocations), VALUE_PRECISION)
	consumed = flt(sum(a["qty"] for a in allocations), QTY_PRECISION)

	return {
		"rate": _rate(cost, consumed),
		"cost": cost,
		"consumed_qty": consumed,
		"available_qty": available,
		"shortfall": flt(shortfall, QTY_PRECISION),
		"allocations": allocations,
		"currency": (tracked or get_tracked_accounts(company)).get(account),
	}


# ---------------------------------------------------------------------------
# Desk entry points
# ---------------------------------------------------------------------------


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def tracked_account_query(doctype, txt, searchfield, start, page_len, filters):
	"""Link-field source listing only accounts that have a FIFO cost basis."""
	company = (filters or {}).get("company")
	if not company:
		return []

	tracked = get_tracked_accounts(company)
	matches = [(name, currency) for name, currency in tracked.items() if not txt or txt.lower() in name.lower()]
	return sorted(matches)[start : start + page_len]


@frappe.whitelist()
def get_payment_cost_rate(company, account, qty, posting_date):
	"""Cost rate for a Payment Entry still being typed.

	The form uses this so the shilling figures settle while the entry is being
	written instead of jumping when it saves. It is a convenience, not the
	control: ``payment_entry_forex_rate.py`` recomputes the same number on the
	server, because a rate read before another entry was submitted is stale.
	"""
	frappe.has_permission("Payment Entry", throw=True)

	tracked = get_tracked_accounts(company)
	if account not in tracked:
		return {"tracked": False}

	detail = get_cost_rate(company, account, flt(qty), posting_date, tracked=tracked)
	detail["tracked"] = True
	detail.pop("allocations", None)
	return detail


@frappe.whitelist()
def get_payment_entry_detail(payment_entry):
	"""FIFO effect of one Payment Entry, for the panel on its form.

	The whole history is replayed and this voucher's rows picked out -- the
	answer for a single entry depends on every entry before it, so there is no
	cheaper honest way to compute it.
	"""
	pe = frappe.get_doc("Payment Entry", payment_entry)
	pe.check_permission("read")

	if pe.docstatus != 1:
		return {"rows": [], "draft": pe.docstatus == 0}

	rows, _lots = build(pe.company)
	mine = [r for r in rows if r["voucher"] == pe.name]

	return {
		"rows": [
			{
				"account": r["account"],
				"currency": r["currency"],
				"movement_type": r["movement_type"],
				"qty_in": r["qty_in"],
				"qty_out": r["qty_out"],
				"cost_out": r["cost_out"],
				"avg_cost_rate": r.get("avg_cost_rate"),
				"txn_rate": r.get("txn_rate"),
				"proceeds": r["proceeds"],
				"realized_gain_loss": r["realized_gain_loss"],
				"shortfall": r["shortfall"],
				"allocations": r["allocations"] if r["movement_type"] in OUTBOUND else [],
				"balance_qty": r["balance_qty"],
				"balance_rate": r["balance_rate"],
				"balance_value": r["balance_value"],
			}
			for r in mine
		],
		"draft": False,
	}
