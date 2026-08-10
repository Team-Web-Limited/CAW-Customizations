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
* Gain or loss only ever arises on the way *out*. Currency arriving from a
  customer receipt lands at the rate the GL debited the bank at, so it has no
  gain of its own; the invoice-rate-vs-receipt-rate difference is receivable FX
  and ERPNext has already booked it against Debtors. Recognising anything on an
  inbound movement double-counts that.

The ledger is *derived*: it replays submitted Payment Entries from the
beginning on every read rather than storing lot state. Backdated, amended and
cancelled entries therefore need no repost machinery -- the next read just sees
a different history. At this business's volume a full replay is a few
milliseconds, which buys immunity from the drift that incremental lot tables
suffer.

Realised gain/loss is *reported*, not posted -- the GL keeps ERPNext's native
treatment, which is worth understanding before trusting either number.

ERPNext credits the bank at the rate of each outgoing payment, and books no
exchange gain against the bank at all. So after buying 500 USD at 130 and
paying 200 away at 131.50, the account holds 300 USD carried at 38,700 KES --
an implied 129.00, which is neither what the dollars cost (130.00) nor any spot
rate that ever existed. It is a residue. The gap between that balance and this
ledger's valuation is exactly the cumulative gain the GL has never recognised.

Restating the balance is Exchange Rate Revaluation's job, and it composes
fine with this ledger precisely because nothing here posts: revaluation fixes
the balance sheet, FIFO answers the separate question of what the currency cost
and what trading it actually earned. Were these figures ever posted to the GL,
running both would book the same movement twice.
"""

import frappe
from frappe.utils import flt

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

			# Gain is measured only on what actually had a cost basis. Valuing a
			# shortfall at the transaction rate would book a 100% "gain" on
			# currency whose acquisition this ledger never saw.
			row["realized_gain_loss"] = flt(
				flt(consumed_qty * mv["txn_rate"], VALUE_PRECISION) - cost_out, VALUE_PRECISION
			)

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
			movements.append(
				dict(
					common,
					account=source,
					currency=tracked[source],
					counter_account=pe.paid_to,
					# Moving currency back into the company's own currency is a
					# sale of it; paying a supplier just spends it. Both realise
					# gain identically, but the distinction is worth reading.
					movement_type=SELL if pe.payment_type == "Internal Transfer" else PAYMENT,
					qty=flt(pe.paid_amount, QTY_PRECISION),
					txn_rate=_rate(pe.base_paid_amount, pe.paid_amount),
				)
			)

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
