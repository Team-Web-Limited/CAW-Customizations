"""Sales portfolio (Crystal CRM & Customer Account Controls, change 5).

Every account records the sales person who introduced it (Customer.custom_introduced_by). This
reports, per sales person and month: their accounts, sales (job cards opened), what was collected
(payments received, net of refunds) and what is outstanding and overdue now. A sales person sees
only their own accounts; Accounts and Admin see everyone. Commission is report-only for now: the
Collected figure is what it would be calculated on.

A sales person is matched to a login through Sales Person → Employee → User.
"""
import frappe
from frappe.utils import add_months, flt, get_first_day, get_last_day, getdate, nowdate

from crystal_alluminium_works.credit_control import (
    ADMIN_ROLE,
    INTRODUCED_BY_FIELD,
    _has_accounts_role,
    get_exposure,
)

UNASSIGNED = "(Not assigned)"


def _sales_person_for_user(user=None):
    user = user or frappe.session.user
    employee = frappe.db.get_value("Employee", {"user_id": user}, "name")
    return employee and frappe.db.get_value("Sales Person", {"employee": employee, "enabled": 1}, "name")


def _scope():
    """(sees_everyone, own sales person or None)."""
    if _has_accounts_role():
        return True, None
    return False, _sales_person_for_user()


def _month_range(month):
    start = get_first_day(getdate(month or nowdate()))
    return start, get_last_day(start)


def _customers_by_sales_person(sales_person=None):
    filters = {}
    if sales_person == UNASSIGNED:
        filters = {INTRODUCED_BY_FIELD: ["is", "not set"], "custom_customer_billing_type": "Invoice Customer"}
    elif sales_person:
        filters = {INTRODUCED_BY_FIELD: sales_person}
    else:
        filters = {"name": ["!=", ""]}
    rows = frappe.get_all(
        "Customer",
        filters=filters,
        fields=["name", "customer_name", INTRODUCED_BY_FIELD, "custom_account_status", "custom_account_term",
                "custom_customer_billing_type"],
    )
    grouped = {}
    for row in rows:
        owner = row.get(INTRODUCED_BY_FIELD)
        if not owner:
            if row.custom_customer_billing_type != "Invoice Customer":
                continue  # walk-in style cash accounts nobody introduced aren't a portfolio
            owner = UNASSIGNED
        grouped.setdefault(owner, []).append(row)
    return grouped


def _sales_in(customers, start, end):
    if not customers:
        return {}
    rows = frappe.db.sql(
        """SELECT customer, SUM(quotation_amount) FROM `tabCAW Job Card`
           WHERE customer IN %(customers)s AND status != 'Cancelled'
             AND DATE(creation) BETWEEN %(start)s AND %(end)s
           GROUP BY customer""",
        {"customers": customers, "start": start, "end": end},
    )
    return {customer: flt(amount) for customer, amount in rows}


def _collected_in(customers, start, end):
    if not customers:
        return {}
    rows = frappe.db.sql(
        """SELECT customer, SUM(CASE WHEN payment_type = 'Refund' THEN -amount ELSE amount END)
           FROM `tabPayments`
           WHERE customer IN %(customers)s AND is_corrected = 0
             AND date BETWEEN %(start)s AND %(end)s
           GROUP BY customer""",
        {"customers": customers, "start": start, "end": end},
    )
    return {customer: flt(amount) for customer, amount in rows}


def _account_rows(customers, start, end):
    names = [row.name for row in customers]
    sales = _sales_in(names, start, end)
    collected = _collected_in(names, start, end)
    rows = []
    for row in customers:
        exposure = get_exposure(row.name)
        rows.append({
            "customer": row.name,
            "customer_name": row.customer_name,
            "status": row.custom_account_status or "Active",
            "term": exposure["term"],
            "sales": flt(sales.get(row.name), 2),
            "collected": flt(collected.get(row.name), 2),
            "outstanding": exposure["used"],
            "overdue": exposure["overdue"],
            "limit": exposure["limit"],
        })
    return rows


@frappe.whitelist()
def get_portfolio(month=None):
    sees_everyone, own = _scope()
    if not sees_everyone and not own:
        return {"rows": [], "message": "Your login isn't linked to a Sales Person (Sales Person → Employee → User)."}
    start, end = _month_range(month)
    grouped = _customers_by_sales_person(None if sees_everyone else own)
    rows = []
    for sales_person, customers in sorted(grouped.items(), key=lambda item: (item[0] == UNASSIGNED, item[0])):
        accounts = _account_rows(customers, start, end)
        rows.append({
            "sales_person": sales_person,
            "accounts": len(accounts),
            "sales": flt(sum(a["sales"] for a in accounts), 2),
            "collected": flt(sum(a["collected"] for a in accounts), 2),
            "outstanding": flt(sum(a["outstanding"] for a in accounts), 2),
            "overdue": flt(sum(a["overdue"] for a in accounts), 2),
            "on_hold": sum(1 for a in accounts if a["status"] == "On hold"),
        })
    return {
        "rows": rows,
        "month_start": start,
        "month_end": end,
        "own": own,
        "is_admin": ADMIN_ROLE in frappe.get_roles(),
    }


@frappe.whitelist()
def get_portfolio_accounts(sales_person, month=None):
    sees_everyone, own = _scope()
    if not sees_everyone and sales_person != own:
        frappe.throw("You can only see your own accounts.", frappe.PermissionError)
    start, end = _month_range(month)
    customers = _customers_by_sales_person(sales_person).get(sales_person, [])
    rows = _account_rows(customers, start, end)
    return sorted(rows, key=lambda row: (-row["overdue"], -row["outstanding"]))


@frappe.whitelist()
def get_monthly_trend(sales_person, months=6):
    """Sales and collections for one sales person over the last few months."""
    sees_everyone, own = _scope()
    if not sees_everyone and sales_person != own:
        frappe.throw("You can only see your own accounts.", frappe.PermissionError)
    names = [row.name for row in _customers_by_sales_person(sales_person).get(sales_person, [])]
    result = []
    first = get_first_day(nowdate())
    for offset in range(int(months) - 1, -1, -1):
        start = add_months(first, -offset)
        end = get_last_day(start)
        result.append({
            "month": start,
            "sales": flt(sum(_sales_in(names, start, end).values()), 2),
            "collected": flt(sum(_collected_in(names, start, end).values()), 2),
        })
    return result


@frappe.whitelist(methods=["POST"])
def reassign_accounts(from_sales_person, to_sales_person, reason, customers=None):
    """Handover: an Admin moves a sales person's accounts (all, or the ones listed) to another.
    Each move is kept on the account's history."""
    if ADMIN_ROLE not in frappe.get_roles():
        frappe.throw("Only an Admin (System Manager) can reassign accounts.", frappe.PermissionError)
    reason = (reason or "").strip()
    if not reason:
        frappe.throw("Give a reason for the handover.")
    if not frappe.db.exists("Sales Person", to_sales_person):
        frappe.throw(f"Sales Person {frappe.bold(to_sales_person)} not found.")
    if from_sales_person == to_sales_person:
        frappe.throw("Choose a different sales person to hand over to.")
    customers = frappe.parse_json(customers) if isinstance(customers, str) else customers
    filters = (
        {INTRODUCED_BY_FIELD: ["is", "not set"], "custom_customer_billing_type": "Invoice Customer"}
        if from_sales_person == UNASSIGNED
        else {INTRODUCED_BY_FIELD: from_sales_person}
    )
    if customers:
        filters["name"] = ["in", customers]
    moved = 0
    for name in frappe.get_all("Customer", filters=filters, pluck="name"):
        doc = frappe.get_doc("Customer", name)
        doc.set(INTRODUCED_BY_FIELD, to_sales_person)
        doc.flags.allow_account_change = True
        doc.flags.account_change_reason = f"Handover: {reason}"
        doc.save(ignore_permissions=True)
        moved += 1
    return moved
