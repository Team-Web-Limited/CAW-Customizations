"""Customer account controls: account terms, account limit, contacts by role and the introducing
sales person (Crystal CRM & Customer Account Controls, phase 1).

Job-card invoices are marked Paid the moment they are made and every Payment posts as an
unallocated advance (see api._force_invoice_paid_display), so ERPNext's own receivables, credit
limit and ageing read nothing for this business. Everything here runs on job card balances
instead — api._get_customer_balances, the same figure the Customer Manager shows as Outstanding.

Three checkpoints call assert_credit_ok: Create Job Card, Release (every job-card invoice) and
Invoice (a Sales Invoice made without a job card). A refusal raises CreditControlBlock and puts
the figures in frappe.response["credit_block"]; public/js/caw_credit_control.js handles that
exception type on every page and offers Record Payment / Request Approval.
"""
import re

import frappe
from frappe.utils import add_days, cint, date_diff, flt, getdate, nowdate

PAYMENT_MUST_CLEAR = "Payment must clear"
CURRENT_CHEQUE = "Current cheque"
PD_CHEQUE_DAYS = (7, 15, 30, 45)
ON_ACCOUNT_DAYS = (5, 7, 10, 14, 20, 25, 30, 35, 45, 60, 75)
ACCOUNT_TERMS = (
    [PAYMENT_MUST_CLEAR, CURRENT_CHEQUE]
    + [f"PD cheque {days} days" for days in PD_CHEQUE_DAYS]
    + [f"On account {days} days" for days in ON_ACCOUNT_DAYS]
)
ACCOUNT_TERM_OPTIONS = "\n" + "\n".join(ACCOUNT_TERMS)
# Existing Invoice Customers were releasing on credit before terms existed; the backfill keeps
# them doing so (patches/backfill_account_terms) until Accounts sets each one properly.
LEGACY_INVOICE_CUSTOMER_TERM = "On account 30 days"

STATUS_ACTIVE = "Active"
STATUS_ON_HOLD = "On hold"
STATUS_PENDING_DOCUMENTS = "Pending documents"
ACCOUNT_STATUS_OPTIONS = "\n".join([STATUS_ACTIVE, STATUS_ON_HOLD, STATUS_PENDING_DOCUMENTS])

CONTACT_ROLES = (
    "Director / Owner",
    "Accounts / Finance",
    "Orders / Purchasing",
    "Authorised collector",
    "Site / Delivery contact",
)
AUTHORISED_COLLECTOR = "Authorised collector"
CONTACT_ROLE_OPTIONS = "\n" + "\n".join(CONTACT_ROLES)

# "Accounts" in the spec is Accounts Manager; "Admin" is System Manager.
ACCOUNTS_ROLES = {"Accounts Manager", "System Manager"}
ADMIN_ROLE = "System Manager"

CHECKPOINT_JOB_CARD = "Job Card"
CHECKPOINT_RELEASE = "Release"
CHECKPOINT_INVOICE = "Invoice"

AGEING_BUCKETS = (("0-30", 0, 30), ("31-60", 31, 60), ("61-90", 61, 90), ("90+", 91, None))

# Account fields only Accounts may change; introduced_by is handled on its own (Admin only once set).
ACCOUNT_CONTROL_FIELDS = {
    "custom_account_term": "Term",
    "custom_account_limit": "Limit",
    "custom_account_status": "Status",
    "custom_hold_reason": "Hold Reason",
}
INTRODUCED_BY_FIELD = "custom_introduced_by"

# Whatever is left after payments that is smaller than this is noise, not exposure — the same
# shilling tolerance job cards settle on (api.PAYMENT_SETTLEMENT_TOLERANCE).
TOLERANCE = 1


class CreditControlBlock(frappe.ValidationError):
    pass


# ---------------------------------------------------------------------------------------------
# Terms


def parse_term(term):
    """{"group": "cash" | "cheque" | "pd_cheque" | "on_account", "days": int} for a term label.
    A blank or unknown term reads as Payment must clear — the safest term there is."""
    term = (term or "").strip()
    match = re.match(r"^(PD cheque|On account) (\d+) days$", term)
    if match:
        return {"group": "pd_cheque" if match.group(1) == "PD cheque" else "on_account", "days": cint(match.group(2))}
    if term == CURRENT_CHEQUE:
        return {"group": "cheque", "days": 0}
    return {"group": "cash", "days": 0}


def is_on_account(term):
    return parse_term(term)["group"] == "on_account"


def get_settings():
    settings = frappe.get_cached_doc("CAW Credit Settings") if frappe.db.exists("DocType", "CAW Credit Settings") else None
    return frappe._dict(
        admin_approval_threshold=flt(settings.admin_approval_threshold) if settings else 0,
        new_invoice_customer_term=(settings and settings.new_invoice_customer_term) or PAYMENT_MUST_CLEAR,
    )


def get_customer_term(customer, job_card=None):
    """The term a piece of work runs on: the job card's own (stamped when it was created, or set
    for that one job by Accounts), else the customer's. Cash customers are always on Payment must
    clear."""
    if job_card:
        term = frappe.db.get_value("CAW Job Card", job_card, "account_term")
        if term:
            return term
    if not customer:
        return PAYMENT_MUST_CLEAR
    values = frappe.db.get_value(
        "Customer", customer, ["custom_customer_billing_type", "custom_account_term", "custom_account_status"], as_dict=True
    ) or {}
    # Until an Admin approves the documents, a credit applicant only trades on Payment must clear.
    if values.get("custom_customer_billing_type") != "Invoice Customer" or values.get("custom_account_status") == STATUS_PENDING_DOCUMENTS:
        return PAYMENT_MUST_CLEAR
    return values.get("custom_account_term") or PAYMENT_MUST_CLEAR


def due_date_for(term, posting_date, job_card=None):
    """Invoice due date: invoice date + the term's days for On account; a PD cheque's own banking
    date when the job card has one in hand (else invoice date + the term's days); else on invoice."""
    posting_date = getdate(posting_date or nowdate())
    parsed = parse_term(term)
    if parsed["group"] == "pd_cheque" and job_card:
        from crystal_alluminium_works.cheque_register import latest_cheque_date

        cheque_date = latest_cheque_date(job_card)
        if cheque_date and getdate(cheque_date) >= posting_date:
            return getdate(cheque_date)
    days = parsed["days"]
    return add_days(posting_date, days) if days else posting_date


# ---------------------------------------------------------------------------------------------
# Exposure


def _job_card_invoices(job_card):
    """Submitted invoices that released this job card's goods, oldest first, each valued with
    visual VAT the way the job card's own total is (credit notes come back negative)."""
    from crystal_alluminium_works.api import VAT_RATE

    rows = frappe.db.sql(
        """
        SELECT name, posting_date, due_date, custom_account_term, grand_total, total_taxes_and_charges, is_return
        FROM `tabSales Invoice`
        WHERE docstatus = 1
          AND (custom_source_job_card = %(job_card)s
               OR (IFNULL(custom_source_job_card, '') = '' AND custom_source_quotation = %(quotation)s))
        ORDER BY posting_date ASC, creation ASC
        """,
        {"job_card": job_card.name, "quotation": job_card.quotation or ""},
        as_dict=True,
    )
    for row in rows:
        value = flt(row.grand_total)
        if flt(row.total_taxes_and_charges) == 0:
            value *= 1 + VAT_RATE
        row.value = value
    return rows


def job_card_due_portions(job_card, as_of):
    """[(invoice, amount, days_past_due)] for the released, still-unpaid part of a job card
    (`job_card` needs name, quotation, account_term, paid and balance). Payments clear the oldest
    invoices first, so what is still owed sits on the newest ones. days_past_due <= 0 means not
    yet due. The unreleased rest of the balance is not due at all: nothing has gone out for it."""
    if flt(job_card.balance) < TOLERANCE:
        return []
    invoices = _job_card_invoices(job_card)
    released = sum(row.value for row in invoices)
    unpaid_released = min(released - flt(job_card.paid), flt(job_card.balance))
    if unpaid_released < TOLERANCE:
        return []

    portions = []
    for row in reversed([r for r in invoices if not r.is_return and r.value > 0]):
        if unpaid_released < TOLERANCE:
            break
        owed = min(row.value, unpaid_released)
        unpaid_released -= owed
        # Invoices made before account terms existed were due on the day; read them by the term
        # the job card has now instead.
        due_date = row.due_date if row.custom_account_term else due_date_for(job_card.account_term, row.posting_date)
        portions.append((row.name, owed, date_diff(as_of, due_date or row.posting_date)))
    return portions


def _job_card_overdue(job_card, today):
    """The past-due portions of job_card_due_portions."""
    return [portion for portion in job_card_due_portions(job_card, today) if portion[2] > 0]


def _bucket(days):
    for label, low, high in AGEING_BUCKETS:
        if days >= low and (high is None or days <= high):
            return label
    return AGEING_BUCKETS[-1][0]


def get_exposure(customer):
    """How much of the customer's account limit is in use, and what is overdue.

    used = every open job card balance (released or not — an approved job card reserves its
    value) + standalone invoice outstanding + cheques not yet cleared (they read as paid but are
    not money in the bank) − unallocated advances/deposits, never below zero."""
    from crystal_alluminium_works.api import _get_customer_balances, _get_customer_unallocated_credit
    from crystal_alluminium_works.cheque_register import uncleared_total

    today = getdate(nowdate())
    balances = _get_customer_balances(customer)
    open_job_cards = sum(flt(row.balance) for row in balances["job_cards"])
    open_invoices = sum(flt(row.outstanding) for row in balances["invoices"])
    unallocated = flt(_get_customer_unallocated_credit(customer))
    uncleared_cheques = uncleared_total(customer)
    used = max(open_job_cards + open_invoices + uncleared_cheques - unallocated, 0)

    ageing = {label: 0.0 for label, _low, _high in AGEING_BUCKETS}
    overdue_rows = []
    for job_card in balances["job_cards"]:
        for invoice, amount, days in _job_card_overdue(job_card, today):
            ageing[_bucket(days)] += amount
            overdue_rows.append({"job_card": job_card.name, "invoice": invoice, "amount": flt(amount, 2), "days": days})
    for invoice in balances["invoices"]:
        days = date_diff(today, invoice.due_date or invoice.posting_date)
        if flt(invoice.outstanding) >= TOLERANCE and days > 0:
            ageing[_bucket(days)] += flt(invoice.outstanding)
            overdue_rows.append({"job_card": None, "invoice": invoice.name, "amount": flt(invoice.outstanding, 2), "days": days})

    values = frappe.db.get_value(
        "Customer",
        customer,
        ["custom_customer_billing_type", "custom_account_term", "custom_account_limit", "custom_account_status"],
        as_dict=True,
    ) or {}
    limit = flt(values.get("custom_account_limit"))
    overdue = sum(ageing.values())
    return {
        "customer": customer,
        "billing_type": values.get("custom_customer_billing_type"),
        "term": get_customer_term(customer),
        "status": values.get("custom_account_status") or STATUS_ACTIVE,
        "limit": limit,
        "limit_set": limit > 0,
        "open_job_cards": flt(open_job_cards, 2),
        "open_invoices": flt(open_invoices, 2),
        "unallocated_credit": flt(unallocated, 2),
        "uncleared_cheques": flt(uncleared_cheques, 2),
        "used": flt(used, 2),
        "available": flt(limit - used, 2) if limit > 0 else None,
        "overdue": flt(overdue, 2),
        "ageing": {label: flt(amount, 2) for label, amount in ageing.items()},
        "overdue_rows": sorted(overdue_rows, key=lambda row: -row["days"]),
        "currency": balances["currency"],
    }


# ---------------------------------------------------------------------------------------------
# Checkpoints


def _find_covering_approval(customer, checkpoint, quotation, job_card, excess, overdue):
    """An Approved, unused one-time approval for this work that covers at least what is being
    asked for now."""
    from crystal_alluminium_works.api import _resolve_quotation_chain

    chain = set(_resolve_quotation_chain(quotation) or [quotation]) if quotation else set()
    rows = frappe.get_all(
        "CAW Credit Approval",
        filters={"customer": customer, "checkpoint": checkpoint, "status": "Approved"},
        fields=["name", "quotation", "job_card", "excess", "overdue"],
        order_by="decided_on asc",
    )
    for row in rows:
        same_work = (job_card and row.job_card == job_card) or (row.quotation and row.quotation in chain)
        if same_work and flt(row.excess) + TOLERANCE >= excess and flt(row.overdue) + TOLERANCE >= overdue:
            return row.name
    return None


def _block(message, payload, title):
    frappe.local.response["credit_block"] = payload
    frappe.throw(message, exc=CreditControlBlock, title=title)


def assert_credit_ok(customer, checkpoint, extra_amount=0, quotation=None, job_card=None, used_for=None, check_limit=True):
    """Stop work an account may not take on now. Returns quietly when it may proceed.

    - On hold: nothing new for anyone — no job cards, releases or invoices.
    - Cash customers and every term but On account: no limit check here; release is held to what
      has been paid instead (api._assert_release_within_paid).
    - On account with a limit set: used + extra_amount must stay within the limit, and at
      Release / Invoice nothing may be overdue. A one-time approval for this work lets it through
      and is marked Used.
    A blank limit means Accounts has not set one yet: nothing is checked against it.
    check_limit=False checks the hold only (work already paid for adds nothing to what is owed)."""
    from crystal_alluminium_works.api import SHARED_CASH_CUSTOMER_NAME

    if not customer or customer == SHARED_CASH_CUSTOMER_NAME:
        return
    values = frappe.db.get_value(
        "Customer",
        customer,
        ["customer_name", "custom_customer_billing_type", "custom_account_status", "custom_hold_reason", "custom_account_limit"],
        as_dict=True,
    )
    if not values:
        return
    label = values.customer_name or customer

    if values.custom_account_status == STATUS_ON_HOLD:
        reason = values.custom_hold_reason or "no reason recorded"
        _block(
            f"{frappe.bold(label)}'s account is <b>on hold</b> ({frappe.utils.escape_html(reason)}). "
            "No new job cards, releases or invoices until Accounts clears the hold in Customer Manager.",
            {"kind": "on_hold", "customer": customer, "customer_name": label, "checkpoint": checkpoint, "reason": reason},
            "Account on hold",
        )

    term = get_customer_term(customer, job_card)
    if not check_limit or values.custom_customer_billing_type != "Invoice Customer" or not is_on_account(term):
        return
    limit = flt(values.custom_account_limit)
    if limit <= 0:
        return

    exposure = get_exposure(customer)
    extra_amount = max(flt(extra_amount), 0)
    excess = flt(exposure["used"] + extra_amount - limit, 2)
    overdue = exposure["overdue"] if checkpoint in (CHECKPOINT_RELEASE, CHECKPOINT_INVOICE) else 0
    if excess < TOLERANCE:
        excess = 0
    if overdue < TOLERANCE:
        overdue = 0
    if not excess and not overdue:
        return

    approval = _find_covering_approval(customer, checkpoint, quotation, job_card, excess, overdue)
    if approval:
        frappe.db.set_value(
            "CAW Credit Approval",
            approval,
            {"status": "Used", "used_on": frappe.utils.now_datetime(), "used_for": used_for or job_card or quotation},
        )
        return

    fmt = lambda value: frappe.utils.fmt_money(value, currency=exposure["currency"])
    reasons = []
    if excess:
        reasons.append(
            f"Outstanding {fmt(exposure['used'])}"
            + (f" + this {checkpoint.lower()} {fmt(extra_amount)}" if extra_amount else "")
            + f" = {fmt(exposure['used'] + extra_amount)}, which is <b>{fmt(excess)} over</b> the "
            f"{fmt(limit)} account limit."
        )
    if overdue:
        reasons.append(f"<b>{fmt(overdue)} is overdue</b> and must be collected before goods are released.")
    _block(
        f"{frappe.bold(label)}: " + " ".join(reasons)
        + "<br><br>Record a payment, ask Accounts for a one-time approval, or have Accounts raise the limit.",
        {
            "kind": "limit",
            "customer": customer,
            "customer_name": label,
            "checkpoint": checkpoint,
            "quotation": quotation,
            "job_card": job_card,
            "term": term,
            "limit": limit,
            "used": exposure["used"],
            "amount": extra_amount,
            "excess": excess,
            "overdue": overdue,
            "currency": exposure["currency"],
        },
        "Account limit reached" if excess else "Overdue balance",
    )


# ---------------------------------------------------------------------------------------------
# Customer validate (hooks.py → customer_handler.validate)


def _has_accounts_role():
    return bool(ACCOUNTS_ROLES & set(frappe.get_roles()))


def _log_change(customer, field, old, new, reason=None, job_card=None):
    frappe.get_doc({
        "doctype": "CAW Account Change Log",
        "customer": customer,
        "field_changed": field,
        "old_value": "" if old is None else str(old),
        "new_value": "" if new is None else str(new),
        "reason": reason or "",
        "job_card": job_card,
        "changed_by": frappe.session.user,
        "changed_on": frappe.utils.now_datetime(),
    }).insert(ignore_permissions=True)


def _display(fieldname, value):
    if fieldname == "custom_account_limit":
        return frappe.utils.fmt_money(value) if flt(value) else "Not set"
    return value or ""


def validate_customer(doc, before):
    """Defaults, permission and history for the account fields, whichever way the Customer is
    saved (Customer Manager, the desk form, a data import)."""
    if not before and not doc.flags.allow_account_change and not _has_accounts_role():
        # A new account starts on the default term with no limit until Accounts sets them.
        doc.custom_account_term = None
        doc.custom_account_limit = 0
        doc.custom_account_status = STATUS_ACTIVE
    if doc.get("custom_customer_billing_type") != "Invoice Customer":
        # Cash customers always pay up front, whatever was keyed in.
        doc.custom_account_term = PAYMENT_MUST_CLEAR
    elif not doc.get("custom_account_term"):
        doc.custom_account_term = get_settings().new_invoice_customer_term
    if not doc.get("custom_account_status"):
        doc.custom_account_status = STATUS_ACTIVE
    if doc.custom_account_status != STATUS_ON_HOLD:
        doc.custom_hold_reason = None
    if doc.custom_account_status == STATUS_PENDING_DOCUMENTS:
        doc.custom_account_term = PAYMENT_MUST_CLEAR

    if not before:
        return

    # A credit application closes only through Approve Credit Account (customer_documents.py),
    # once the documents are checked — or by a System Manager.
    if (
        before.get("custom_account_status") == STATUS_PENDING_DOCUMENTS
        and doc.custom_account_status not in (STATUS_PENDING_DOCUMENTS, STATUS_ON_HOLD)
        and not doc.flags.allow_account_change
        and ADMIN_ROLE not in frappe.get_roles()
    ):
        frappe.throw(
            "This account is waiting for its company documents. It opens when an Admin approves the "
            "credit application in Customer Manager.",
            title="Pending documents",
        )

    billing_changed = before.get("custom_customer_billing_type") != doc.get("custom_customer_billing_type")
    reason = doc.flags.account_change_reason
    for fieldname, label in ACCOUNT_CONTROL_FIELDS.items():
        old, new = before.get(fieldname), doc.get(fieldname)
        if fieldname == "custom_account_limit":
            changed = flt(old) != flt(new)
        else:
            changed = (old or "") != (new or "")
        if not changed:
            continue
        # The term follows a Convert to Invoice Customer on its own (set above).
        derived = fieldname == "custom_account_term" and billing_changed
        if not derived and not doc.flags.allow_account_change and not _has_accounts_role():
            frappe.throw(
                f"Only Accounts can change a customer's account {label.lower()}.",
                frappe.PermissionError,
                title="Account controls",
            )
        if fieldname != "custom_hold_reason":
            _log_change(doc.name, label, _display(fieldname, old), _display(fieldname, new),
                        reason or ("Converted to Invoice Customer" if derived else "Changed on the Customer form"))

    old_owner, new_owner = before.get(INTRODUCED_BY_FIELD), doc.get(INTRODUCED_BY_FIELD)
    if (old_owner or "") != (new_owner or ""):
        if old_owner and not doc.flags.allow_account_change and ADMIN_ROLE not in frappe.get_roles():
            frappe.throw(
                "Only an Admin (System Manager) can change the sales person who introduced an account.",
                frappe.PermissionError,
                title="Introduced by",
            )
        _log_change(doc.name, "Introduced By", old_owner, new_owner, reason or ("Set" if not old_owner else "Changed on the Customer form"))


def log_new_customer(doc, method=None):
    """Customer after_insert: the introducing sales person is part of the account's history."""
    if doc.get(INTRODUCED_BY_FIELD):
        _log_change(doc.name, "Introduced By", None, doc.get(INTRODUCED_BY_FIELD), "Account opened")


# ---------------------------------------------------------------------------------------------
# Whitelisted: account summary and controls


def _assert_accounts():
    if not _has_accounts_role():
        frappe.throw("Only Accounts (Accounts Manager) can do this.", frappe.PermissionError)


@frappe.whitelist()
def get_account_summary(customer):
    frappe.has_permission("Customer", "read", customer, throw=True)
    summary = get_exposure(customer)
    values = frappe.db.get_value("Customer", customer, ["custom_hold_reason", INTRODUCED_BY_FIELD], as_dict=True) or {}
    summary["hold_reason"] = values.get("custom_hold_reason")
    summary["introduced_by"] = values.get(INTRODUCED_BY_FIELD)
    summary["can_edit_controls"] = _has_accounts_role()
    summary["can_change_introduced_by"] = ADMIN_ROLE in frappe.get_roles() or not values.get(INTRODUCED_BY_FIELD)
    summary["pending_approvals"] = frappe.db.count("CAW Credit Approval", {"customer": customer, "status": "Pending"})
    return summary


@frappe.whitelist()
def get_account_options():
    return {
        "terms": ACCOUNT_TERMS,
        "statuses": ACCOUNT_STATUS_OPTIONS.split("\n"),
        "contact_roles": list(CONTACT_ROLES),
        "is_accounts": _has_accounts_role(),
        "is_admin": ADMIN_ROLE in frappe.get_roles(),
    }


@frappe.whitelist(methods=["POST"])
def update_account_controls(customer, term=None, limit=None, status=None, hold_reason=None, reason=None):
    _assert_accounts()
    reason = (reason or "").strip()
    if not reason:
        frappe.throw("Give a reason for the change; it is kept on the account's history.")
    doc = frappe.get_doc("Customer", customer)
    if term is not None:
        if term not in ACCOUNT_TERMS:
            frappe.throw(f"Unknown account term {frappe.bold(term)}.")
        if doc.custom_customer_billing_type != "Invoice Customer" and term != PAYMENT_MUST_CLEAR:
            frappe.throw("Cash customers always pay on <b>Payment must clear</b>. Convert them to an Invoice Customer first.")
        doc.custom_account_term = term
    if limit is not None:
        if flt(limit) < 0:
            frappe.throw("The account limit can't be negative.")
        doc.custom_account_limit = flt(limit)
    if status is not None:
        if status not in ACCOUNT_STATUS_OPTIONS.split("\n"):
            frappe.throw(f"Unknown account status {frappe.bold(status)}.")
        if (
            doc.custom_account_status == STATUS_PENDING_DOCUMENTS
            and status not in (STATUS_PENDING_DOCUMENTS, STATUS_ON_HOLD)
            and ADMIN_ROLE not in frappe.get_roles()
        ):
            frappe.throw("This account is waiting for its company documents; an Admin opens it by approving the credit application.")
        doc.custom_account_status = status
        if status == STATUS_ON_HOLD:
            if not (hold_reason or "").strip():
                frappe.throw("Say why the account is on hold.")
            doc.custom_hold_reason = hold_reason.strip()
    doc.flags.account_change_reason = reason
    doc.flags.allow_account_change = True
    doc.save(ignore_permissions=True)
    return get_account_summary(customer)


@frappe.whitelist(methods=["POST"])
def set_introduced_by(customer, sales_person, reason=None):
    doc = frappe.get_doc("Customer", customer)
    current = doc.get(INTRODUCED_BY_FIELD)
    if current and ADMIN_ROLE not in frappe.get_roles():
        frappe.throw("Only an Admin (System Manager) can change the sales person who introduced an account.", frappe.PermissionError)
    if not current:
        frappe.has_permission("Customer", "write", customer, throw=True)
    if sales_person and not frappe.db.exists("Sales Person", sales_person):
        frappe.throw(f"Sales Person {frappe.bold(sales_person)} not found.")
    if current and not (reason or "").strip():
        frappe.throw("Give a reason for the handover; it is kept on the account's history.")
    doc.set(INTRODUCED_BY_FIELD, sales_person or None)
    doc.flags.account_change_reason = (reason or "").strip() or "Set"
    doc.flags.allow_account_change = True
    doc.save(ignore_permissions=True)
    return get_account_summary(customer)


@frappe.whitelist()
def get_account_history(customer):
    frappe.has_permission("Customer", "read", customer, throw=True)
    return frappe.get_all(
        "CAW Account Change Log",
        filters={"customer": customer},
        fields=["field_changed", "old_value", "new_value", "reason", "job_card", "changed_by", "changed_on"],
        order_by="changed_on desc",
        limit_page_length=200,
    )


@frappe.whitelist(methods=["POST"])
def override_job_term(job_card, term, reason):
    """Accounts may put one job on a different term (e.g. a PD cheque on one large order); the
    customer's own term is untouched and the reason is kept."""
    _assert_accounts()
    reason = (reason or "").strip()
    if not reason:
        frappe.throw("Give a reason for changing this job's term.")
    if term not in ACCOUNT_TERMS:
        frappe.throw(f"Unknown account term {frappe.bold(term)}.")
    card = frappe.get_doc("CAW Job Card", job_card)
    if card.payment_mode == "Cash Customer" and term != PAYMENT_MUST_CLEAR:
        frappe.throw("A cash job card always runs on <b>Payment must clear</b>.")
    old = card.account_term or get_customer_term(card.customer)
    frappe.db.set_value(
        "CAW Job Card",
        job_card,
        {"account_term": term, "term_override_reason": reason, "term_overridden_by": frappe.session.user},
    )
    _log_change(card.customer, "Job Term Override", old, term, reason, job_card=job_card)
    return term


# ---------------------------------------------------------------------------------------------
# Whitelisted: one-time approvals


@frappe.whitelist(methods=["POST"])
def request_credit_approval(customer, checkpoint, reason, quotation=None, job_card=None, amount=0):
    """Ask Accounts to let one blocked piece of work through. The figures are recomputed here
    rather than taken from the client."""
    reason = (reason or "").strip()
    if not reason:
        frappe.throw("Say why this work should go ahead.")
    if checkpoint not in (CHECKPOINT_JOB_CARD, CHECKPOINT_RELEASE, CHECKPOINT_INVOICE):
        frappe.throw("Unknown checkpoint.")
    frappe.has_permission("Customer", "read", customer, throw=True)
    exposure = get_exposure(customer)
    amount = max(flt(amount), 0)
    excess = max(flt(exposure["used"] + amount - exposure["limit"], 2), 0) if exposure["limit_set"] else 0
    overdue = exposure["overdue"] if checkpoint != CHECKPOINT_JOB_CARD else 0

    # One open request per piece of work: asking again refreshes it instead of adding another.
    existing = frappe.db.get_value(
        "CAW Credit Approval",
        {
            "customer": customer,
            "checkpoint": checkpoint,
            "status": "Pending",
            "quotation": quotation or ["is", "not set"],
            "job_card": job_card or ["is", "not set"],
        },
    )
    doc = frappe.get_doc("CAW Credit Approval", existing) if existing else frappe.new_doc("CAW Credit Approval")
    doc.update({
        "customer": customer,
        "checkpoint": checkpoint,
        "quotation": quotation,
        "job_card": job_card,
        "amount": amount,
        "used_amount": exposure["used"],
        "credit_limit": exposure["limit"],
        "excess": excess,
        "overdue": overdue,
        "reason": reason,
        "status": "Pending",
        "requested_by": frappe.session.user,
        "requested_on": frappe.utils.now_datetime(),
    })
    doc.save(ignore_permissions=True)
    return doc.name


def _approval_needs_admin(doc):
    threshold = get_settings().admin_approval_threshold
    return bool(threshold) and flt(doc.excess) + flt(doc.overdue) > threshold


@frappe.whitelist()
def get_credit_approvals(status="Pending", limit=100):
    _assert_accounts()
    filters = {"status": status} if status in ("Pending", "Approved", "Rejected", "Used") else {"status": ["!=", "Pending"]}
    rows = frappe.get_all(
        "CAW Credit Approval",
        filters=filters,
        fields=["name", "customer", "customer_name", "checkpoint", "quotation", "job_card", "amount", "used_amount",
                "credit_limit", "excess", "overdue", "reason", "status", "requested_by", "requested_on",
                "decided_by", "decided_on", "decision_note", "used_on", "used_for"],
        order_by="requested_on desc",
        limit_page_length=cint(limit) or 100,
    )
    is_admin = ADMIN_ROLE in frappe.get_roles()
    for row in rows:
        row.needs_admin = _approval_needs_admin(row)
        row.can_decide = row.status == "Pending" and (is_admin or not row.needs_admin)
    return rows


@frappe.whitelist(methods=["POST"])
def decide_credit_approval(name, approve, note=None):
    _assert_accounts()
    doc = frappe.get_doc("CAW Credit Approval", name)
    if doc.status != "Pending":
        frappe.throw(f"This request is already {doc.status}.")
    approve = cint(approve)
    if approve and _approval_needs_admin(doc) and ADMIN_ROLE not in frappe.get_roles():
        frappe.throw(
            "This request is above the amount Accounts may approve; it needs an Admin (System Manager).",
            frappe.PermissionError,
        )
    note = (note or "").strip()
    if not approve and not note:
        frappe.throw("Give a reason for rejecting the request.")
    doc.status = "Approved" if approve else "Rejected"
    doc.decided_by = frappe.session.user
    doc.decided_on = frappe.utils.now_datetime()
    doc.decision_note = note
    doc.save(ignore_permissions=True)
    return doc.status


# ---------------------------------------------------------------------------------------------
# Whitelisted: contacts by role


def _contact_rows(customer, include_inactive=False):
    names = frappe.get_all(
        "Dynamic Link",
        filters={"link_doctype": "Customer", "link_name": customer, "parenttype": "Contact"},
        pluck="parent",
    )
    if not names:
        return []
    filters = {"name": ["in", list(set(names))]}
    if not include_inactive:
        filters["custom_contact_active"] = 1
    primary = frappe.db.get_value("Customer", customer, "customer_primary_contact")
    rows = frappe.get_all(
        "Contact",
        filters=filters,
        fields=["name", "first_name", "last_name", "full_name", "custom_account_role", "mobile_no", "phone",
                "email_id", "custom_id_number", "custom_receives_statements", "custom_contact_active"],
        order_by="custom_contact_active desc, custom_account_role asc, first_name asc",
    )
    for row in rows:
        row.full_name = row.full_name or " ".join(filter(None, [row.first_name, row.last_name])) or row.name
        row.is_primary = row.name == primary
    return rows


@frappe.whitelist()
def get_account_contacts(customer, include_inactive=0):
    frappe.has_permission("Customer", "read", customer, throw=True)
    return _contact_rows(customer, include_inactive=cint(include_inactive))


@frappe.whitelist()
def get_authorised_collectors(customer):
    frappe.has_permission("Customer", "read", customer, throw=True)
    return [row for row in _contact_rows(customer) if row.custom_account_role == AUTHORISED_COLLECTOR]


@frappe.whitelist(methods=["POST"])
def save_account_contact(customer, full_name, role, mobile_no=None, email_id=None, id_number=None,
                         receives_statements=0, contact=None):
    frappe.has_permission("Contact", "write" if contact else "create", throw=True)
    full_name = " ".join((full_name or "").split())
    if not full_name:
        frappe.throw("Enter the contact's name.")
    if role not in CONTACT_ROLES:
        frappe.throw("Choose the contact's role.")
    id_number = (id_number or "").strip()
    if role == AUTHORISED_COLLECTOR and not id_number:
        frappe.throw("An authorised collector needs an ID number; the yard checks it at release.")
    mobile_no = (mobile_no or "").strip()
    email_id = (email_id or "").strip()

    if contact:
        doc = frappe.get_doc("Contact", contact)
        if not any(link.link_doctype == "Customer" and link.link_name == customer for link in doc.links):
            frappe.throw("That contact doesn't belong to this customer.")
    else:
        doc = frappe.new_doc("Contact")
        doc.append("links", {"link_doctype": "Customer", "link_name": customer})

    first, _sep, last = full_name.partition(" ")
    doc.first_name = first
    doc.last_name = last
    doc.custom_account_role = role
    doc.custom_id_number = id_number
    doc.custom_receives_statements = cint(receives_statements)
    doc.custom_contact_active = 1

    # Replace the contact's own number/email rather than piling up old ones.
    if (doc.mobile_no or "") != mobile_no:
        doc.set("phone_nos", [row for row in doc.phone_nos if not row.is_primary_mobile_no])
        if mobile_no:
            doc.add_phone(mobile_no, is_primary_mobile_no=1)
    if (doc.email_id or "") != email_id:
        doc.set("email_ids", [row for row in doc.email_ids if not row.is_primary])
        if email_id:
            doc.add_email(email_id, is_primary=1)
    doc.save(ignore_permissions=True)
    return doc.name


@frappe.whitelist(methods=["POST"])
def set_contact_active(contact, active):
    frappe.has_permission("Contact", "write", contact, throw=True)
    frappe.db.set_value("Contact", contact, "custom_contact_active", 1 if cint(active) else 0)
    return cint(active)


def resolve_collector(customer, collector):
    """The person collecting goods at a release. When the customer has authorised collectors,
    it must be one of them (the yard checks the ID); otherwise any name/ID given is recorded."""
    from crystal_alluminium_works.api import SHARED_CASH_CUSTOMER_NAME

    collector = frappe.parse_json(collector) if isinstance(collector, str) else (collector or {})
    collector = frappe._dict(collector or {})
    authorised = [] if customer == SHARED_CASH_CUSTOMER_NAME else [
        row for row in _contact_rows(customer) if row.custom_account_role == AUTHORISED_COLLECTOR
    ]
    if authorised:
        match = next((row for row in authorised if row.name == collector.get("contact")), None)
        if not match:
            frappe.throw(
                "Only an authorised collector may collect goods for this customer. Choose who is collecting.",
                title="Authorised collector required",
            )
        return {"collector_contact": match.name, "collector_name": match.full_name, "collector_id_number": match.custom_id_number}
    name = (collector.get("name") or "").strip()
    id_number = (collector.get("id_number") or "").strip()
    if not name and not id_number:
        return None
    return {"collector_contact": None, "collector_name": name, "collector_id_number": id_number}


def stamp_collector(invoice_name, collector):
    """Record who collected on every release row the invoice wrote."""
    if not collector:
        return
    for doctype in ("CAW Job Card Release", "CAW Ceiling Release"):
        for name in frappe.get_all(doctype, filters={"sales_invoice": invoice_name}, pluck="name"):
            frappe.db.set_value(doctype, name, collector, update_modified=False)
