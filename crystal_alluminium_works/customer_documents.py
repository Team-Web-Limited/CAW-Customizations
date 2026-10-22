"""Company documents for a credit account (Crystal CRM & Customer Account Controls, change 4).

A business that applies for an invoice (credit) account uploads its registration documents
against the account within a deadline. Accounts checks each one (approve, or reject with a
reason that goes back to Sales); an Admin then approves the account and sets its term and limit.
Until then the account is "Pending documents" and trades only on Payment must clear
(credit_control.get_customer_term).

Every upload, check and approval is kept: CAW Customer Document tracks changes, and the account
decisions go to the CAW Account Change Log.
"""
import frappe
from frappe.utils import add_days, cint, date_diff, flt, getdate, nowdate

from crystal_alluminium_works.credit_control import (
    ACCOUNT_TERMS,
    ADMIN_ROLE,
    PAYMENT_MUST_CLEAR,
    STATUS_ACTIVE,
    STATUS_PENDING_DOCUMENTS,
    _has_accounts_role,
)

REQUIRED = "Required"
REQUIRED_FOR_COMPANIES = "Required for limited companies"
REQUIRED_ABOVE_LIMIT = "Required above the agreed limit"
OPTIONAL = "Optional"

KRA_PIN_CERTIFICATE = "KRA PIN certificate"
DOCUMENT_CHECKLIST = (
    ("Certificate of Incorporation / Business Registration", REQUIRED, ""),
    (KRA_PIN_CERTIFICATE, REQUIRED, "The PIN must match the PIN on the account (used for eTIMS)."),
    ("CR12 (list of directors)", REQUIRED_FOR_COMPANIES, ""),
    ("Directors' ID copies", REQUIRED, ""),
    ("Signed credit application form", REQUIRED, "States the requested term and limit."),
    ("Bank or trade reference", REQUIRED_ABOVE_LIMIT, ""),
    ("Tax compliance certificate", OPTIONAL, "Record the expiry date; a renewal reminder is sent."),
)
DOCUMENT_TYPES = [row[0] for row in DOCUMENT_CHECKLIST]

DOC_PENDING = "Pending review"
DOC_CHECKED = "Checked"
DOC_REJECTED = "Rejected"
DOC_APPROVED = "Approved"

# Expiring documents are reminded this many days before, and on the day.
EXPIRY_REMINDER_DAYS = (30, 7, 0)


def get_document_settings():
    settings = frappe.get_cached_doc("CAW Credit Settings")
    return frappe._dict(
        deadline_days=cint(settings.get("document_deadline_days")) or 7,
        reference_required_above=flt(settings.get("reference_required_above")),
    )


def _is_required(requirement, customer, limit):
    if requirement == REQUIRED:
        return True
    if requirement == REQUIRED_FOR_COMPANIES:
        return customer.customer_type == "Company"
    if requirement == REQUIRED_ABOVE_LIMIT:
        threshold = get_document_settings().reference_required_above
        return bool(threshold) and flt(limit) > threshold
    return False


def _normalize_pin(value):
    from crystal_alluminium_works.customer_handler import normalize_kra_pin

    return normalize_kra_pin(value)


def _checklist(customer_doc, limit=None):
    """The checklist rows for a customer, each with its current document (if any)."""
    docs = {
        row.document_type: row
        for row in frappe.get_all(
            "CAW Customer Document",
            filters={"customer": customer_doc.name},
            fields=["name", "document_type", "file", "status", "expiry_date", "pin_on_document", "notes",
                    "rejection_reason", "uploaded_by", "uploaded_on", "checked_by", "checked_on",
                    "approved_by", "approved_on", "original_received", "original_received_on",
                    "original_received_by"],
        )
    }
    limit = customer_doc.get("custom_requested_limit") if limit is None else limit
    rows = []
    for document_type, requirement, note in DOCUMENT_CHECKLIST:
        rows.append(frappe._dict(
            document_type=document_type,
            requirement=requirement,
            note=note,
            required=_is_required(requirement, customer_doc, limit),
            document=docs.get(document_type),
        ))
    return rows


def missing_documents(customer_doc, limit=None):
    """Required documents not yet uploaded and checked by Accounts."""
    return [
        row.document_type
        for row in _checklist(customer_doc, limit)
        if row.required and not (row.document and row.document.status in (DOC_CHECKED, DOC_APPROVED))
    ]


# ---------------------------------------------------------------------------------------------
# Whitelisted


@frappe.whitelist()
def get_customer_documents(customer):
    frappe.has_permission("Customer", "read", customer, throw=True)
    doc = frappe.get_doc("Customer", customer)
    checklist = _checklist(doc)
    missing = missing_documents(doc)
    due_on = doc.get("custom_documents_due_on")
    return {
        "billing_type": doc.custom_customer_billing_type,
        "status": doc.custom_account_status,
        "pending": doc.custom_account_status == STATUS_PENDING_DOCUMENTS,
        "due_on": due_on,
        "overdue": bool(due_on) and doc.custom_account_status == STATUS_PENDING_DOCUMENTS and getdate(due_on) < getdate(nowdate()) and bool(missing),
        "requested_term": doc.get("custom_requested_term"),
        "requested_limit": doc.get("custom_requested_limit"),
        "started_by": doc.get("custom_application_started_by"),
        "checklist": checklist,
        "missing": missing,
        "complete": not missing,
        "can_upload": bool(frappe.has_permission("Customer", "write", customer)),
        "can_check": _has_accounts_role(),
        "can_approve": ADMIN_ROLE in frappe.get_roles(),
        "terms": ACCOUNT_TERMS,
        "deadline_days": get_document_settings().deadline_days,
    }


@frappe.whitelist(methods=["POST"])
def start_credit_application(customer, requested_term=None, requested_limit=0):
    """Open a credit application: the account trades on Payment must clear while the documents
    are collected, due within the deadline set in CAW Credit Settings."""
    frappe.has_permission("Customer", "write", customer, throw=True)
    doc = frappe.get_doc("Customer", customer)
    if doc.custom_customer_billing_type != "Invoice Customer":
        frappe.throw("Only an Invoice Customer can apply for credit. Convert the customer first.")
    if doc.custom_account_status == STATUS_PENDING_DOCUMENTS:
        frappe.throw("A credit application is already open for this customer.")
    if requested_term and requested_term not in ACCOUNT_TERMS:
        frappe.throw(f"Unknown account term {frappe.bold(requested_term)}.")
    due_on = add_days(nowdate(), get_document_settings().deadline_days)
    doc.custom_account_status = STATUS_PENDING_DOCUMENTS
    doc.custom_account_term = PAYMENT_MUST_CLEAR
    doc.custom_documents_due_on = due_on
    doc.custom_requested_term = requested_term or None
    doc.custom_requested_limit = flt(requested_limit)
    doc.custom_application_started_by = frappe.session.user
    doc.flags.allow_account_change = True
    doc.flags.account_change_reason = (
        f"Credit application opened; documents due {frappe.utils.formatdate(due_on)}"
    )
    doc.save(ignore_permissions=True)
    return get_customer_documents(customer)


@frappe.whitelist(methods=["POST"])
def upload_customer_document(customer, document_type, file, expiry_date=None, pin_on_document=None, notes=None):
    frappe.has_permission("Customer", "write", customer, throw=True)
    if document_type not in DOCUMENT_TYPES:
        frappe.throw("Choose a document from the checklist.")
    if not file:
        frappe.throw("Attach the document.")
    if document_type == KRA_PIN_CERTIFICATE and not (pin_on_document or "").strip():
        frappe.throw("Enter the PIN printed on the certificate.")
    name = frappe.db.get_value("CAW Customer Document", {"customer": customer, "document_type": document_type})
    doc = frappe.get_doc("CAW Customer Document", name) if name else frappe.new_doc("CAW Customer Document")
    if doc.get("status") == DOC_APPROVED and not _has_accounts_role():
        frappe.throw("This document is already approved. Ask Accounts to replace it.")
    doc.update({
        "customer": customer,
        "document_type": document_type,
        "file": file,
        "expiry_date": expiry_date or None,
        "pin_on_document": _normalize_pin(pin_on_document) or None,
        "notes": (notes or "").strip(),
        # A new upload is reviewed afresh.
        "status": DOC_PENDING,
        "rejection_reason": None,
        "checked_by": None,
        "checked_on": None,
        "approved_by": None,
        "approved_on": None,
        "uploaded_by": frappe.session.user,
        "uploaded_on": frappe.utils.now_datetime(),
        "expiry_reminded_on": None,
    })
    doc.save(ignore_permissions=True)
    return doc.name


@frappe.whitelist(methods=["POST"])
def review_customer_document(name, approve, reason=None):
    """Accounts checks a document: accept it, or reject it with the reason Sales will see."""
    if not _has_accounts_role():
        frappe.throw("Only Accounts can check documents.", frappe.PermissionError)
    doc = frappe.get_doc("CAW Customer Document", name)
    if cint(approve):
        if doc.document_type == KRA_PIN_CERTIFICATE:
            account_pin = _normalize_pin(frappe.db.get_value("Customer", doc.customer, "tax_id"))
            if not account_pin or account_pin != _normalize_pin(doc.pin_on_document):
                frappe.throw(
                    f"The PIN on the certificate ({doc.pin_on_document or 'none'}) doesn't match the PIN on the "
                    f"account ({account_pin or 'none'}). Fix the account's PIN or reject the certificate."
                )
        doc.status = DOC_CHECKED
        doc.rejection_reason = None
    else:
        reason = (reason or "").strip()
        if not reason:
            frappe.throw("Give the reason for rejecting it; Sales will see it.")
        doc.status = DOC_REJECTED
        doc.rejection_reason = reason
    doc.checked_by = frappe.session.user
    doc.checked_on = frappe.utils.now_datetime()
    doc.save(ignore_permissions=True)
    return doc.status


@frappe.whitelist(methods=["POST"])
def set_original_received(name, received):
    doc = frappe.get_doc("CAW Customer Document", name)
    frappe.has_permission("Customer", "write", doc.customer, throw=True)
    received = cint(received)
    doc.original_received = received
    doc.original_received_on = nowdate() if received else None
    doc.original_received_by = frappe.session.user if received else None
    doc.save(ignore_permissions=True)
    return received


@frappe.whitelist(methods=["POST"])
def approve_credit_account(customer, term, limit, reason=None):
    """Admin's final approval: the documents are complete and checked, so the account opens on the
    agreed term and limit."""
    if ADMIN_ROLE not in frappe.get_roles():
        frappe.throw("Only an Admin (System Manager) can approve a credit account.", frappe.PermissionError)
    if term not in ACCOUNT_TERMS:
        frappe.throw(f"Unknown account term {frappe.bold(term)}.")
    doc = frappe.get_doc("Customer", customer)
    if doc.custom_account_status != STATUS_PENDING_DOCUMENTS:
        frappe.throw("This customer has no open credit application.")
    missing = missing_documents(doc, limit=limit)
    if missing:
        frappe.throw("These documents still need to be uploaded and checked by Accounts:<br>• " + "<br>• ".join(missing))

    now = frappe.utils.now_datetime()
    for row in frappe.get_all("CAW Customer Document", filters={"customer": customer, "status": DOC_CHECKED}, pluck="name"):
        frappe.db.set_value("CAW Customer Document", row, {"status": DOC_APPROVED, "approved_by": frappe.session.user, "approved_on": now})

    doc.custom_account_term = term
    doc.custom_account_limit = flt(limit)
    doc.custom_account_status = STATUS_ACTIVE
    doc.flags.allow_account_change = True
    doc.flags.account_change_reason = (reason or "").strip() or "Credit account approved; documents complete"
    doc.save(ignore_permissions=True)
    return get_customer_documents(customer)


@frappe.whitelist()
def get_document_queue():
    """For the Account Approvals page: documents waiting for Accounts, and applications whose
    documents are complete and waiting for an Admin."""
    if not _has_accounts_role():
        frappe.throw("Only Accounts can see the document queue.", frappe.PermissionError)
    documents = frappe.get_all(
        "CAW Customer Document",
        filters={"status": DOC_PENDING},
        fields=["name", "customer", "customer_name", "document_type", "file", "uploaded_by", "uploaded_on",
                "expiry_date", "pin_on_document"],
        order_by="uploaded_on asc",
    )
    applications = []
    today = getdate(nowdate())
    for customer in frappe.get_all(
        "Customer",
        filters={"custom_account_status": STATUS_PENDING_DOCUMENTS},
        fields=["name"],
        order_by="custom_documents_due_on asc",
    ):
        doc = frappe.get_doc("Customer", customer.name)
        missing = missing_documents(doc)
        applications.append({
            "customer": doc.name,
            "customer_name": doc.customer_name,
            "due_on": doc.get("custom_documents_due_on"),
            "late": bool(doc.get("custom_documents_due_on")) and getdate(doc.custom_documents_due_on) < today and bool(missing),
            "requested_term": doc.get("custom_requested_term"),
            "requested_limit": doc.get("custom_requested_limit"),
            "missing": missing,
            "complete": not missing,
        })
    return {"documents": documents, "applications": applications, "is_admin": ADMIN_ROLE in frappe.get_roles()}


# ---------------------------------------------------------------------------------------------
# Scheduler (hooks.py → daily)


def _accounts_managers():
    return [
        row[0]
        for row in frappe.db.sql(
            """SELECT DISTINCT hr.parent FROM `tabHas Role` hr JOIN `tabUser` u ON u.name = hr.parent
               WHERE hr.role = 'Accounts Manager' AND hr.parenttype = 'User' AND u.enabled = 1
                 AND u.name != 'Guest'"""
        )
    ]


def _notify(users, subject, html, link):
    for user in set(filter(None, users)):
        frappe.get_doc({
            "doctype": "Notification Log",
            "for_user": user,
            "type": "Alert",
            "subject": subject,
            "email_content": html,
            "link": link,
        }).insert(ignore_permissions=True)


def send_document_reminders():
    """Daily: applications past their document deadline (to Accounts and whoever opened them), and
    documents about to expire (to Accounts)."""
    today = getdate(nowdate())
    accounts = _accounts_managers()

    for customer in frappe.get_all(
        "Customer",
        filters={"custom_account_status": STATUS_PENDING_DOCUMENTS, "custom_documents_due_on": ["<", today]},
        pluck="name",
    ):
        doc = frappe.get_doc("Customer", customer)
        missing = missing_documents(doc)
        if not missing:
            continue
        items = "".join(f"<li>{frappe.utils.escape_html(m)}</li>" for m in missing)
        _notify(
            accounts + [doc.get("custom_application_started_by")],
            f"{doc.customer_name}: credit documents overdue since {frappe.utils.formatdate(doc.custom_documents_due_on)}",
            f"<p>Still missing or not yet checked:</p><ul>{items}</ul><p>The account stays on Payment must clear.</p>",
            f"/desk/customer-manager/{doc.name}",
        )

    for row in frappe.get_all(
        "CAW Customer Document",
        filters={"expiry_date": ["is", "set"], "status": ["in", [DOC_CHECKED, DOC_APPROVED]]},
        fields=["name", "customer", "customer_name", "document_type", "expiry_date", "expiry_reminded_on"],
    ):
        days_left = date_diff(row.expiry_date, today)
        if days_left not in EXPIRY_REMINDER_DAYS or (row.expiry_reminded_on and getdate(row.expiry_reminded_on) == today):
            continue
        when = "today" if days_left == 0 else f"in {days_left} days"
        _notify(
            accounts,
            f"{row.customer_name}: {row.document_type} expires {when}",
            f"<p>{frappe.utils.escape_html(row.document_type)} for {frappe.utils.escape_html(row.customer_name)} "
            f"expires on {frappe.utils.formatdate(row.expiry_date)}. Ask the customer for the renewed one.</p>",
            f"/desk/customer-manager/{row.customer}",
        )
        frappe.db.set_value("CAW Customer Document", row.name, "expiry_reminded_on", today, update_modified=False)
