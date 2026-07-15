import re

import frappe
from frappe.utils import get_datetime

from crystal_alluminium_works.create_custom_fields import add_custom_fields

JC_NAME_PATTERN = re.compile(r"CAW Job Card:\s*(JOB-CARD-[\w-]+)")
ROW_PATTERN = re.compile(r"Row:\s*([\w-]+)")
INVOICE_EDIT_PATTERN = re.compile(r"Invoice Edit:\s*([\w-]+)")


def execute():
    """Stamp custom_sales_invoice on historical deduction/repack Stock Entries so the Stock
    Ledger's Date/Invoice column resolves each movement to the invoice that caused it.

    - Invoice-edit entries carry the invoice in their own remarks ("Invoice Edit: ...").
    - Glass deducted early at JC Operations ("Row: {quotation_item}") is attributed to the
      earliest invoice that released that row (the read path lists all of them at display time).
    - Other invoice-time deductions are matched to the CAW Job Card / Ceiling Release created
      in the same call, by job card + item code, choosing the closest creation time.
    Ambiguous/unmatched rows are left blank (the read path keeps its legacy fallback)."""
    # Fixtures sync after post_model_sync patches, so create the field now (idempotent).
    add_custom_fields()
    if not frappe.db.has_column("Stock Entry", "custom_sales_invoice"):
        return 0

    entries = frappe.get_all(
        "Stock Entry",
        filters={
            "docstatus": 1,
            "remarks": ["like", "%CAW Job Card:%"],
            "custom_sales_invoice": ["in", ["", None]],
        },
        fields=["name", "remarks", "creation"],
        limit_page_length=0,
    )

    updated = 0
    for entry in entries:
        remarks = entry.remarks or ""
        invoice = _resolve_invoice(entry, remarks)
        if not invoice or not frappe.db.exists("Sales Invoice", invoice):
            continue
        frappe.db.set_value(
            "Stock Entry", entry.name, "custom_sales_invoice", invoice, update_modified=False
        )
        updated += 1

    return updated


def _resolve_invoice(entry, remarks):
    edit_match = INVOICE_EDIT_PATTERN.search(remarks)
    if edit_match:
        return edit_match.group(1)

    row_match = ROW_PATTERN.search(remarks)
    if row_match:
        return frappe.db.get_value(
            "CAW Job Card Release",
            {"quotation_item": row_match.group(1), "sales_invoice": ["is", "set"]},
            "sales_invoice",
            order_by="creation asc",
        )

    jc_match = JC_NAME_PATTERN.search(remarks)
    if not jc_match:
        return None
    job_card = jc_match.group(1)

    item_codes = frappe.get_all(
        "Stock Entry Detail", filters={"parent": entry.name}, pluck="item_code"
    )
    if not item_codes:
        return None

    candidates = frappe.get_all(
        "CAW Job Card Release",
        filters={"job_card": job_card, "item_code": ["in", item_codes], "sales_invoice": ["is", "set"]},
        fields=["sales_invoice", "creation"],
    )
    candidates += frappe.get_all(
        "CAW Ceiling Release",
        filters={"job_card": job_card, "item_code": ["in", item_codes], "sales_invoice": ["is", "set"]},
        fields=["sales_invoice", "creation"],
    )
    if not candidates:
        return None

    se_creation = get_datetime(entry.creation)
    closest = min(candidates, key=lambda c: abs((get_datetime(c.creation) - se_creation).total_seconds()))
    return closest.sales_invoice
