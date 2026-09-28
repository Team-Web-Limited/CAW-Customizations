"""Tie Paybill Payments rows to the M-Pesa transactions Safaricom actually confirmed.

Safaricom's C2B confirmations land as draft `Mpesa C2B Payment Register` rows (Navari's
frappe_mpsa_payments, with its own auto-reconcile switched off so it never posts accounting).
Staff keep recording Paybill money exactly as before — through the Create Job Card modal,
Record Deposit, or the Payments page — typing the M-Pesa code into the existing Reference
field. This module is the only bridge between the two:

  * Payments.validate claims the confirmed transaction the code names, refusing a code that is
    already claimed by another live payment or an amount larger than M-Pesa received.
  * A code with no confirmation on file yet is still accepted (callbacks can arrive late, or
    the code may be mistyped) — the payment simply stays unlinked.
  * When a confirmation arrives after the payment was already recorded, the C2B row's
    after_insert hook links it retrospectively.

The Job Card / Payments flow stays the source of truth for balances; this never posts or
alters any accounting."""

import re

import frappe
from frappe.utils import flt, fmt_money

C2B_DOCTYPE = "Mpesa C2B Payment Register"


def normalize_mpesa_code(reference):
	return re.sub(r"\s+", "", reference or "").upper()


def _is_phone_payment_method(payment_method):
	# Paybill-style methods are the Phone-type Modes of Payment; bank/cash references are
	# cheque or transfer numbers that never appear in the M-Pesa log.
	return bool(payment_method) and frappe.db.get_value("Mode of Payment", payment_method, "type") == "Phone"


def _c2b_installed():
	return bool(frappe.db.exists("DocType", C2B_DOCTYPE))


def _resolve_mpesa_claim(reference, amount, payment_method, payment_type=None, exclude=None, lock=False):
	"""Name of the confirmed M-Pesa transaction this payment should claim, or None when there is
	nothing to link. Throws if the code is already claimed or the amount exceeds what was received.

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
	)


@frappe.whitelist()
def check_mpesa_reference(reference, amount, payment_method):
	"""Pre-flight for the Create Job Card modal, which creates the Job Card before it records the
	payment — a code rejected only at that second step would leave a Job Card with no payment."""
	_resolve_mpesa_claim(reference, amount, payment_method)
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
