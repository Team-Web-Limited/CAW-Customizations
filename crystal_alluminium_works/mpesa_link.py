"""Tie Paybill Payments rows to the M-Pesa transactions Safaricom actually confirmed.

Safaricom's C2B confirmations land as draft `Mpesa C2B Payment Register` rows (Navari's
frappe_mpsa_payments, with its own auto-reconcile switched off so it never posts accounting).
Staff keep recording Paybill money exactly as before — through the Create Job Card modal,
Record Deposit, or the Payments page — typing the M-Pesa code into the existing Reference
field. This module is the only bridge between the two:

  * Payments.validate claims the confirmed transaction the code names, refusing a code that is
    already claimed by another live payment or an amount larger than M-Pesa received.
  * The M-Pesa code is optional, but a code that is entered must be one Safaricom has actually
    confirmed: an unknown (guessed / mistyped) code is refused, and the Create/Edit Job Card
    modals run the same check before the Job Card is saved.
  * Payments recorded before this rule (blank or unconfirmed codes) keep saving as before, and
    a confirmation arriving after such a payment still links it via the C2B after_insert hook.

The Job Card / Payments flow stays the source of truth for balances; this never posts or
alters any accounting. For the same reason the register is read-only for staff roles (see
apply_mpesa_register_permissions), and the M-Pesa Transactions page gives them a plain view
of what has arrived and whether it has been recorded yet."""

import re

import frappe
from frappe.utils import add_days, cint, flt, fmt_money, getdate

C2B_DOCTYPE = "Mpesa C2B Payment Register"

# Staff see the register but never change it: submitting a row makes Navari post its own
# Payment Entry (double-counting money crystal's Payments flow already posts), and the
# read-only amount/code fields are not enforced server-side on a plain write.
READ_ONLY_REGISTER_ROLES = ("Sales User", "Accounts User", "Accounts Manager")
_REGISTER_WRITE_PTYPES = ("write", "create", "delete", "submit", "cancel", "amend", "import")


def normalize_mpesa_code(reference):
	return re.sub(r"\s+", "", reference or "").upper()


def _is_phone_payment_method(payment_method):
	# Paybill-style methods are the Phone-type Modes of Payment; bank/cash references are
	# cheque or transfer numbers that never appear in the M-Pesa log.
	return bool(payment_method) and frappe.db.get_value("Mode of Payment", payment_method, "type") == "Phone"


def _c2b_installed():
	return bool(frappe.db.exists("DocType", C2B_DOCTYPE))


def _resolve_mpesa_claim(reference, amount, payment_method, payment_type=None, exclude=None, lock=False, require_confirmed=False):
	"""Name of the confirmed M-Pesa transaction this payment should claim, or None when there is
	nothing to link. Throws if the code is already claimed or the amount exceeds what was received,
	and — with require_confirmed — if a code was entered that Safaricom never sent. A blank code
	is allowed (the code is optional).

	`exclude` lists Payments that may legitimately share the claim: the row itself when re-saved,
	and the original a correction replaces (it is only flagged is_corrected after the replacement
	is inserted)."""
	if payment_type == "Refund" or not _c2b_installed() or not _is_phone_payment_method(payment_method):
		return None

	code = normalize_mpesa_code(reference)
	if not code:
		return None

	transaction = frappe.db.get_value(
		C2B_DOCTYPE,
		{"transid": code, "docstatus": ["<", 2]},
		["name", "transamount"],
		as_dict=True,
		for_update=lock,
	)
	if not transaction:
		if require_confirmed:
			# Safaricom posts every Paybill payment here within seconds, so a code that isn't on
			# file is mistyped or was never paid — recording it would mark money as received
			# that the Paybill never got.
			frappe.throw(
				f"M-Pesa code {code} has not been received from Safaricom. Check the code on the "
				"customer's M-Pesa SMS (it must match exactly) or open M-Pesa Transactions to find "
				"the payment. If the customer has just paid, wait a moment and try again.",
				title="M-Pesa code not found",
			)
		return None

	exclude = [str(name) for name in (exclude or []) if name]
	filters = {
		"mpesa_transaction": transaction.name,
		"is_corrected": 0,
		"payment_type": ["!=", "Refund"],
	}
	if exclude:
		filters["name"] = ["not in", exclude]
	claimed_by = frappe.db.get_value("Payments", filters, "name")
	if claimed_by:
		frappe.throw(
			f"M-Pesa code {code} has already been recorded on Payment #{claimed_by}.",
			title="M-Pesa code already used",
		)

	if flt(amount) - flt(transaction.transamount) > 0.0001:
		frappe.throw(
			f"M-Pesa code {code} only received {fmt_money(transaction.transamount, currency='KES')}, "
			f"but this payment records {fmt_money(amount, currency='KES')}.",
			title="Amount exceeds M-Pesa payment",
		)

	return transaction.name


def link_payment_to_mpesa(doc):
	"""Payments.validate: normalise the M-Pesa code and claim its confirmed transaction."""
	if doc.is_corrected:
		# A superseded row keeps whatever it claimed, as the record of what was first captured;
		# the claim itself stops counting once is_corrected is set.
		return

	if _is_phone_payment_method(doc.payment_method) and doc.reference:
		doc.reference = normalize_mpesa_code(doc.reference)

	doc.mpesa_transaction = _resolve_mpesa_claim(
		doc.reference,
		doc.amount,
		doc.payment_method,
		payment_type=doc.payment_type,
		exclude=[None if doc.is_new() else doc.name, doc.corrects_payment],
		lock=True,
		require_confirmed=_must_confirm_code(doc),
	)


def _must_confirm_code(doc):
	"""Only a code being entered now has to be Safaricom-confirmed: a new payment, or an
	existing one whose code changed. Payments recorded before the rule (blank or unconfirmed
	codes) can still be re-saved, re-allocated or corrected without re-typing a code."""
	if doc.is_new():
		if doc.corrects_payment:
			# A correction only skips the check when it keeps an M-Pesa payment's own code. A code
			# carried over from a Cash / bank payment was never checked as an M-Pesa code, so
			# switching that payment to Paybill must confirm it like a newly typed one.
			original = frappe.db.get_value(
				"Payments", doc.corrects_payment, ["reference", "payment_method"], as_dict=True
			)
			return (
				not _is_phone_payment_method(original.payment_method)
				or normalize_mpesa_code(original.reference) != normalize_mpesa_code(doc.reference)
			)
		return True
	before = doc.get_doc_before_save()
	return bool(before) and normalize_mpesa_code(before.reference) != normalize_mpesa_code(doc.reference)


@frappe.whitelist()
def check_mpesa_reference(reference, amount, payment_method):
	"""Pre-flight for the Create/Edit Job Card modals, which save the Job Card before recording the
	payment — a code rejected only at that second step would leave a Job Card with no payment."""
	_resolve_mpesa_claim(reference, amount, payment_method, require_confirmed=True)
	return True


def link_late_confirmation(doc, method=None):
	"""Mpesa C2B Payment Register after_insert: a payment recorded before Safaricom's
	confirmation arrived gets linked now. Never raises — this runs inside Navari's callback
	worker, and a failure here must not lose the confirmation itself."""
	try:
		code = normalize_mpesa_code(doc.transid)
		if not code:
			return

		candidates = [
			row
			for row in frappe.get_all(
				"Payments",
				filters={
					"reference": code,
					"mpesa_transaction": ["is", "not set"],
					"is_corrected": 0,
					"payment_type": ["!=", "Refund"],
				},
				fields=["name", "amount", "payment_method"],
			)
			if _is_phone_payment_method(row.payment_method)
		]
		if len(candidates) != 1:
			# None: nothing recorded yet. Several: ambiguous — leave for a person to resolve.
			return

		payment = candidates[0]
		frappe.db.set_value("Payments", payment.name, "mpesa_transaction", doc.name, update_modified=False)

		if flt(payment.amount) - flt(doc.transamount) > 0.0001:
			frappe.get_doc("Payments", payment.name).add_comment(
				"Comment",
				f"M-Pesa confirmation {code} arrived for {fmt_money(doc.transamount, currency='KES')}, "
				f"less than the {fmt_money(payment.amount, currency='KES')} recorded on this payment.",
			)
	except Exception:
		frappe.log_error(title=f"M-Pesa late link failed for {doc.name}")


def apply_mpesa_register_permissions():
	"""after_migrate: make the M-Pesa register read-only for staff roles.

	Copies Navari's standard permissions into Custom DocPerm the first time (Frappe's own way of
	overriding another app's doctype), then strips every write-type right from the staff roles.
	Idempotent, and re-applied on every migrate so a Navari update can't hand Submit back."""
	if not _c2b_installed():
		return

	from frappe.permissions import setup_custom_perms

	setup_custom_perms(C2B_DOCTYPE)

	for name in frappe.get_all(
		"Custom DocPerm",
		filters={"parent": C2B_DOCTYPE, "role": ["in", READ_ONLY_REGISTER_ROLES]},
		pluck="name",
	):
		perm = frappe.get_doc("Custom DocPerm", name)
		changed = False
		for ptype in _REGISTER_WRITE_PTYPES:
			if perm.get(ptype):
				perm.set(ptype, 0)
				changed = True
		if not perm.read:
			perm.read = 1
			changed = True
		if changed:
			perm.save(ignore_permissions=True)

	frappe.clear_cache(doctype=C2B_DOCTYPE)


_QTN_ACCOUNT = re.compile(r"^(?:QTN)?0*(\d+)$")


def _quotation_for_account(bill_ref, cache):
	"""The quotation a Paybill account number points at. The quotation print format gives the
	bare number (60057) as the account; QTN<number> (QTN127, qtn-127, QTN 0127 ...) and a full
	quotation name are accepted too. The series resets each year, so the most recent quotation
	with that number wins."""
	cleaned = re.sub(r"[^A-Za-z0-9-]", "", bill_ref or "").upper()
	if not cleaned:
		return None
	if cleaned in cache:
		return cache[cleaned]

	quotation = None
	if frappe.db.exists("Quotation", cleaned):
		quotation = cleaned
	else:
		match = _QTN_ACCOUNT.match(cleaned.replace("-", ""))
		if match:
			number = f"{int(match.group(1)):05d}"
			rows = frappe.get_all(
				"Quotation",
				or_filters=[["name", "like", f"%-{number}"], ["name", "like", f"%-{number}-%"]],
				fields=["name"],
				order_by="creation desc",
				limit_page_length=1,
			)
			quotation = rows[0].name if rows else None

	cache[cleaned] = quotation
	return quotation


def _live_claims(transaction_names=None):
	"""transaction name -> the live Payments row that recorded it."""
	filters = {"mpesa_transaction": ["is", "set"], "is_corrected": 0, "payment_type": ["!=", "Refund"]}
	if transaction_names is not None:
		if not transaction_names:
			return {}
		filters["mpesa_transaction"] = ["in", transaction_names]
	return {
		row.mpesa_transaction: row
		for row in frappe.get_all(
			"Payments",
			filters=filters,
			fields=["name", "mpesa_transaction", "job_card", "quotation", "customer", "date"],
			order_by="creation asc",
		)
	}


@frappe.whitelist()
def get_mpesa_transactions_page(search=None, status=None, from_date=None, to_date=None, page=1, page_length=30):
	"""Rows for the M-Pesa Transactions page: what Safaricom confirmed on the Paybill, and
	whether staff have recorded each one as a Payment yet. frappe.get_list enforces read access."""
	if not _c2b_installed():
		return {"rows": [], "total_count": 0, "page": 1, "page_length": 30, "has_next": False, "totals": {}}

	page = max(cint(page) or 1, 1)
	page_length = min(max(cint(page_length) or 30, 1), 100)

	filters = [["docstatus", "<", 2]]
	if from_date:
		filters.append(["creation", ">=", str(getdate(from_date))])
	if to_date:
		filters.append(["creation", "<", str(add_days(getdate(to_date), 1))])

	or_filters = None
	search = (search or "").strip()
	if search:
		like = f"%{search}%"
		or_filters = [
			["transid", "like", like],
			["billrefnumber", "like", like],
			["full_name", "like", like],
			["firstname", "like", like],
		]

	matching = frappe.get_list(
		C2B_DOCTYPE,
		filters=filters,
		or_filters=or_filters,
		fields=["name", "transamount"],
		order_by="creation desc",
		limit_page_length=0,
	)
	claims = _live_claims([row.name for row in matching])

	if status == "unrecorded":
		matching = [row for row in matching if row.name not in claims]
	elif status == "recorded":
		matching = [row for row in matching if row.name in claims]

	totals = {
		"count": len(matching),
		"amount": sum(flt(row.transamount) for row in matching),
		"unrecorded_count": sum(1 for row in matching if row.name not in claims),
		"unrecorded_amount": sum(flt(row.transamount) for row in matching if row.name not in claims),
	}

	start = (page - 1) * page_length
	page_names = [row.name for row in matching[start : start + page_length]]
	details = {
		row.name: row
		for row in frappe.get_all(
			C2B_DOCTYPE,
			filters={"name": ["in", page_names or [""]]},
			fields=["name", "transid", "transamount", "billrefnumber", "full_name", "firstname", "transtime", "creation"],
		)
	}

	quotation_cache = {}
	rows = []
	for name in page_names:
		row = details[name]
		claim = claims.get(name)
		rows.append({
			"name": name,
			"received_at": row.creation,
			"mpesa_code": row.transid,
			"amount": flt(row.transamount),
			"account_number": row.billrefnumber,
			"quotation": _quotation_for_account(row.billrefnumber, quotation_cache),
			"paid_by": (row.full_name or row.firstname or "").strip(),
			"payment": str(claim.name) if claim else None,
			"job_card": claim.job_card if claim else None,
			"customer": claim.customer if claim else None,
		})

	return {
		"rows": rows,
		"total_count": totals["count"],
		"page": page,
		"page_length": page_length,
		"has_next": start + page_length < totals["count"],
		"totals": totals,
	}
