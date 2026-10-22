"""Cheque register (Crystal CRM & Customer Account Controls, phase 2).

A cheque is not money in the bank until it clears, so a received cheque posts to the
"Cheques in Hand" account rather than the bank (decided 2026-10-14):

  Received  Payment Entry: Debtors → Cheques in Hand. The job card reads paid, as before.
  Banked    status only — handed to the bank, waiting to clear.
  Cleared   Journal Entry: Cheques in Hand → the bank account it was paid into.
  Bounced   the clearing entry (if any) and the Payment Entry are cancelled, the money comes back
            off every job card it funded, and the customer's account goes on hold.

Until a cheque clears it still counts against the customer's account limit
(credit_control.get_exposure), and a "Payment must clear" job card can't release goods on it
(api._assert_release_allowed). Cheque refunds (money going out) are untouched: they still come
straight off the bank.
"""
import frappe
from frappe.utils import cint, flt, getdate, nowdate

CHEQUE_METHOD = "Cheque"
CHEQUES_IN_HAND_ACCOUNT_NAME = "Cheques in Hand"

STATUS_RECEIVED = "Received"
STATUS_BANKED = "Banked"
STATUS_CLEARED = "Cleared"
STATUS_BOUNCED = "Bounced"
STATUS_CANCELLED = "Cancelled"
UNCLEARED_STATUSES = (STATUS_RECEIVED, STATUS_BANKED)


def get_cheques_in_hand_account(company=None):
    from crystal_alluminium_works.api import _get_default_company

    company = company or _get_default_company()
    account = frappe.db.get_value(
        "Account", {"account_name": CHEQUES_IN_HAND_ACCOUNT_NAME, "company": company, "is_group": 0}
    )
    if not account:
        frappe.throw(
            f"The {frappe.bold(CHEQUES_IN_HAND_ACCOUNT_NAME)} account is missing for {company}. "
            "Run bench migrate (patch setup_cheques_in_hand) or create it under Cash In Hand."
        )
    return account


def is_cheque_receipt(payment_method, is_refund=False):
    return payment_method == CHEQUE_METHOD and not is_refund


def ensure_cheques_in_hand_account(company):
    """Create the Cheques in Hand ledger under the company's Cash In Hand group (Cash type, since
    ERPNext only lets a receipt land in a Bank or Cash account)."""
    if frappe.db.exists("Account", {"account_name": CHEQUES_IN_HAND_ACCOUNT_NAME, "company": company}):
        return
    parent = frappe.db.get_value("Account", {"account_name": "Cash In Hand", "company": company, "is_group": 1}) \
        or frappe.db.get_value("Account", {"account_name": "Current Assets", "company": company, "is_group": 1})
    if not parent:
        return
    frappe.get_doc({
        "doctype": "Account",
        "account_name": CHEQUES_IN_HAND_ACCOUNT_NAME,
        "company": company,
        "parent_account": parent,
        "account_type": "Cash",
        "account_currency": frappe.db.get_value("Company", company, "default_currency"),
        "is_group": 0,
    }).insert(ignore_permissions=True)


# ---------------------------------------------------------------------------------------------
# Lifecycle hooks called from api.py


def create_cheque(payment_doc, cheque_date=None, cheque_bank=None):
    """Register the cheque a Payments row was received by."""
    from crystal_alluminium_works.api import _mode_of_payment_account

    received_on = getdate(payment_doc.date)
    cheque_date = getdate(cheque_date) if cheque_date else received_on
    if cheque_date < received_on:
        frappe.throw("The cheque date can't be before the day it was received.")
    doc = frappe.get_doc({
        "doctype": "CAW Cheque",
        "customer": payment_doc.customer,
        "payments": str(payment_doc.name),
        "cheque_no": (payment_doc.reference or "").strip(),
        "drawer_bank": (cheque_bank or "").strip(),
        "cheque_date": cheque_date,
        "received_on": received_on,
        "is_post_dated": 1 if cheque_date > received_on else 0,
        "amount": flt(payment_doc.amount),
        "bank_account": _mode_of_payment_account(CHEQUE_METHOD),
        "status": STATUS_RECEIVED,
    })
    doc.insert(ignore_permissions=True)
    return doc.name


def cheque_for_payment(payment_name):
    return frappe.db.get_value(
        "CAW Cheque", {"payments": str(payment_name), "status": ["!=", STATUS_CANCELLED]}, "name"
    )


def move_cheque_to_payment(original, replacement):
    """correct_payment re-posts a payment as a new Payments row; the cheque follows it, or is
    cancelled if the corrected payment is no longer a cheque."""
    name = cheque_for_payment(original.name)
    if is_cheque_receipt(replacement.payment_method, replacement.payment_type == "Refund"):
        if name:
            frappe.db.set_value("CAW Cheque", name, {
                "payments": str(replacement.name),
                "amount": flt(replacement.amount),
                "cheque_no": (replacement.reference or "").strip(),
            })
        else:
            create_cheque(replacement)
    elif name:
        frappe.db.set_value("CAW Cheque", name, "status", STATUS_CANCELLED)


def cancel_cheque_for_payment(payment_name):
    """A voided or deleted payment takes its (uncleared) cheque with it."""
    name = cheque_for_payment(payment_name)
    if name:
        frappe.db.set_value("CAW Cheque", name, "status", STATUS_CANCELLED)


def payment_block_reasons(payment_name):
    """Why a cheque payment can't be corrected or voided: once it has cleared, money has moved
    from Cheques in Hand to the bank, and a bounce goes through the Cheque Register."""
    status = frappe.db.get_value("CAW Cheque", {"payments": str(payment_name)}, "status")
    if status == STATUS_CLEARED:
        return ["This cheque has cleared. If it was returned unpaid, mark it Bounced in the Cheque Register."]
    if status == STATUS_BOUNCED:
        return ["This cheque bounced and its payment has already been reversed."]
    return []


# ---------------------------------------------------------------------------------------------
# Reads used by credit control and invoicing


def uncleared_total(customer):
    return flt(frappe.db.sql(
        "SELECT COALESCE(SUM(amount), 0) FROM `tabCAW Cheque` WHERE customer = %s AND status IN %s",
        (customer, UNCLEARED_STATUSES),
    )[0][0])


def _uncleared_cheques_on_job_card(job_card):
    """[(cheque, cheque_date, amount put on this job card)] for uncleared cheques that paid it:
    the cheque's allocation rows for this job card, or the whole payment when it only carries the
    legacy single job_card link."""
    rows = frappe.db.sql(
        """
        SELECT c.name, c.cheque_date,
            CASE WHEN EXISTS (SELECT 1 FROM `tabPayment Job Card Allocation` a
                              WHERE a.parenttype = 'Payments' AND a.parent = c.payments)
                 THEN (SELECT COALESCE(SUM(a.amount), 0) FROM `tabPayment Job Card Allocation` a
                       WHERE a.parenttype = 'Payments' AND a.parent = c.payments AND a.job_card = %(job_card)s)
                 ELSE p.amount
            END AS amount
        FROM `tabCAW Cheque` c
        JOIN `tabPayments` p ON p.name = c.payments
        WHERE c.status IN %(statuses)s
          AND p.is_corrected = 0
          AND (p.job_card = %(job_card)s OR EXISTS (
                SELECT 1 FROM `tabPayment Job Card Allocation` a
                WHERE a.parenttype = 'Payments' AND a.parent = c.payments AND a.job_card = %(job_card)s))
        """,
        {"statuses": UNCLEARED_STATUSES, "job_card": job_card},
        as_dict=True,
    )
    return [(row.name, row.cheque_date, flt(row.amount)) for row in rows if flt(row.amount) > 0]


def uncleared_on_job_card(job_card):
    return sum(amount for _name, _date, amount in _uncleared_cheques_on_job_card(job_card))


def latest_cheque_date(job_card):
    """Banking date of the newest uncleared cheque paying this job card — a PD-cheque invoice
    falls due on it."""
    dates = [cheque_date for _name, cheque_date, _amount in _uncleared_cheques_on_job_card(job_card)]
    return max(dates) if dates else None


# ---------------------------------------------------------------------------------------------
# Whitelisted: the Cheque Register page


def _assert_accounts():
    from crystal_alluminium_works.credit_control import _assert_accounts

    _assert_accounts()


@frappe.whitelist()
def get_cheques(status="Uncleared", search=None, limit=200):
    _assert_accounts()
    filters = {}
    if status == "Uncleared":
        filters["status"] = ["in", UNCLEARED_STATUSES]
    elif status and status != "All":
        filters["status"] = status
    or_filters = None
    if search:
        like = f"%{search.strip()}%"
        or_filters = {"cheque_no": ["like", like], "customer_name": ["like", like], "customer": ["like", like]}
    rows = frappe.get_all(
        "CAW Cheque",
        filters=filters,
        or_filters=or_filters,
        fields=["name", "customer", "customer_name", "payments", "cheque_no", "drawer_bank", "cheque_date",
                "received_on", "is_post_dated", "amount", "status", "bank_account", "banked_on", "cleared_on",
                "clearing_entry", "bounced_on", "bounce_reason"],
        order_by="cheque_date asc, creation asc",
        limit_page_length=cint(limit) or 200,
    )
    today = getdate(nowdate())
    for row in rows:
        row.due = row.status in UNCLEARED_STATUSES and getdate(row.cheque_date) <= today
    return rows


@frappe.whitelist(methods=["POST"])
def mark_banked(name, banked_on=None, bank_account=None):
    _assert_accounts()
    doc = frappe.get_doc("CAW Cheque", name)
    if doc.status != STATUS_RECEIVED:
        frappe.throw(f"Only a received cheque can be banked; this one is {doc.status}.")
    banked_on = getdate(banked_on or nowdate())
    if banked_on < getdate(doc.cheque_date):
        frappe.throw(
            f"This cheque is dated {frappe.utils.formatdate(doc.cheque_date)} and can't be banked before then."
        )
    doc.status = STATUS_BANKED
    doc.banked_on = banked_on
    if bank_account:
        doc.bank_account = bank_account
    doc.status_changed_by = frappe.session.user
    doc.save(ignore_permissions=True)
    return doc.status


@frappe.whitelist(methods=["POST"])
def mark_cleared(name, cleared_on=None, bank_account=None):
    """The bank has credited the cheque: move it from Cheques in Hand to the bank."""
    from crystal_alluminium_works.api import _get_default_company

    _assert_accounts()
    doc = frappe.get_doc("CAW Cheque", name)
    if doc.status not in UNCLEARED_STATUSES:
        frappe.throw(f"This cheque is already {doc.status}.")
    cleared_on = getdate(cleared_on or nowdate())
    if cleared_on < getdate(doc.cheque_date):
        frappe.throw(
            f"This cheque is dated {frappe.utils.formatdate(doc.cheque_date)} and can't have cleared before then."
        )
    bank_account = bank_account or doc.bank_account
    if not bank_account:
        frappe.throw("Choose the bank account the cheque was paid into.")
    company = _get_default_company()
    reference = doc.cheque_no or doc.name
    je = frappe.get_doc({
        "doctype": "Journal Entry",
        "voucher_type": "Bank Entry",
        "company": company,
        "posting_date": cleared_on,
        "cheque_no": reference,
        "cheque_date": doc.cheque_date,
        "user_remark": f"Cheque {reference} from {doc.customer_name or doc.customer} cleared ({doc.name})",
        "accounts": [
            {"account": bank_account, "debit_in_account_currency": flt(doc.amount)},
            {"account": get_cheques_in_hand_account(company), "credit_in_account_currency": flt(doc.amount)},
        ],
    })
    je.flags.ignore_permissions = True
    je.insert(ignore_permissions=True)
    je.submit()

    doc.status = STATUS_CLEARED
    doc.cleared_on = cleared_on
    doc.banked_on = doc.banked_on or cleared_on
    doc.bank_account = bank_account
    doc.clearing_entry = je.name
    doc.status_changed_by = frappe.session.user
    doc.save(ignore_permissions=True)
    return je.name


@frappe.whitelist(methods=["POST"])
def mark_bounced(name, reason, bounced_on=None):
    """The cheque came back unpaid. Undo it completely and put the account on hold, so no new
    work goes out until Accounts has sorted it with the customer."""
    from crystal_alluminium_works.api import _give_back_payment_to_job_cards
    from crystal_alluminium_works.credit_control import STATUS_ON_HOLD

    _assert_accounts()
    reason = (reason or "").strip()
    if not reason:
        frappe.throw("Say why the cheque bounced (e.g. insufficient funds).")
    doc = frappe.get_doc("CAW Cheque", name)
    if doc.status not in (STATUS_RECEIVED, STATUS_BANKED, STATUS_CLEARED):
        frappe.throw(f"This cheque is already {doc.status}.")

    if doc.clearing_entry and frappe.db.get_value("Journal Entry", doc.clearing_entry, "docstatus") == 1:
        je = frappe.get_doc("Journal Entry", doc.clearing_entry)
        je.flags.ignore_permissions = True
        je.cancel()

    payment = frappe.get_doc("Payments", doc.payments) if frappe.db.exists("Payments", doc.payments) else None
    if payment and not payment.is_corrected:
        if payment.payment_entry and frappe.db.get_value("Payment Entry", payment.payment_entry, "docstatus") == 1:
            pe = frappe.get_doc("Payment Entry", payment.payment_entry)
            pe.flags.ignore_permissions = True
            pe.cancel()
        frappe.db.set_value("Payments", payment.name, {
            "is_corrected": 1,
            "is_voided": 1,
            "corrected_on": frappe.utils.now_datetime(),
            "corrected_by": frappe.session.user,
            "correction_reason": f"Cheque {doc.cheque_no} bounced: {reason}",
        }, update_modified=False)
        _give_back_payment_to_job_cards(payment, "Payment Voided", "voided")
        payment.add_comment("Comment", f"Cheque {doc.cheque_no} bounced ({reason}); payment reversed by {frappe.session.user}.")

    doc.status = STATUS_BOUNCED
    doc.bounced_on = getdate(bounced_on or nowdate())
    doc.bounce_reason = reason
    doc.status_changed_by = frappe.session.user
    doc.save(ignore_permissions=True)

    customer = frappe.get_doc("Customer", doc.customer)
    if customer.custom_account_status != STATUS_ON_HOLD and doc.customer != _shared_cash_customer():
        customer.custom_account_status = STATUS_ON_HOLD
        customer.custom_hold_reason = f"Bounced cheque {doc.cheque_no} ({frappe.utils.fmt_money(doc.amount)}): {reason}"
        customer.flags.allow_account_change = True
        customer.flags.account_change_reason = f"Cheque {doc.cheque_no} bounced ({doc.name})"
        customer.save(ignore_permissions=True)
    return doc.status


def _shared_cash_customer():
    from crystal_alluminium_works.api import SHARED_CASH_CUSTOMER_NAME

    return SHARED_CASH_CUSTOMER_NAME


# ---------------------------------------------------------------------------------------------
# Scheduler (hooks.py → daily)


def send_banking_reminders():
    """Tell Accounts each morning which cheques have reached their banking date and are still
    in hand: one notification per Accounts Manager, not one per cheque."""
    today = getdate(nowdate())
    due = frappe.get_all(
        "CAW Cheque",
        filters={"status": STATUS_RECEIVED, "cheque_date": ["<=", today]},
        fields=["name", "cheque_no", "customer_name", "amount", "cheque_date"],
        order_by="cheque_date asc",
    )
    if not due:
        return
    total = sum(flt(row.amount) for row in due)
    lines = "".join(
        f"<li>{frappe.utils.escape_html(row.cheque_no or row.name)} — {frappe.utils.escape_html(row.customer_name or '')}, "
        f"{frappe.utils.fmt_money(row.amount)} (dated {frappe.utils.formatdate(row.cheque_date)})</li>"
        for row in due[:30]
    )
    subject = f"{len(due)} cheque{'s' if len(due) != 1 else ''} ready to bank ({frappe.utils.fmt_money(total)})"
    users = frappe.db.sql(
        """SELECT DISTINCT hr.parent FROM `tabHas Role` hr JOIN `tabUser` u ON u.name = hr.parent
           WHERE hr.role = 'Accounts Manager' AND hr.parenttype = 'User' AND u.enabled = 1
             AND u.name != 'Guest'"""
    )
    for (user,) in users:
        frappe.get_doc({
            "doctype": "Notification Log",
            "for_user": user,
            "type": "Alert",
            "subject": subject,
            "email_content": f"<p>These cheques have reached their banking date:</p><ul>{lines}</ul>",
            "link": "/desk/cheque-register",
        }).insert(ignore_permissions=True)
