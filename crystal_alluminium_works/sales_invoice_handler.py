import frappe
from crystal_alluminium_works.pricing_engine import (
    calculate_ceiling_pricing,
    get_price_adjustment_multiplier,
    process_glass_item,
    reapply_price_adjustment,
)


def _reset_auto_generated_ceiling_component_pricing(doc):
    for item in doc.items:
        if not getattr(item, "custom_auto_generated", 0):
            continue

        if (getattr(item, "custom_product_category", "") or "") != "Ceiling":
            continue

        # Ceiling bundle component rows are informational only; the parent
        # ceiling row already carries the quoted commercial amount.
        item.rate = 0.0
        item.amount = 0.0
        if hasattr(item, "price_list_rate"):
            item.price_list_rate = 0.0
        if hasattr(item, "base_price_list_rate"):
            item.base_price_list_rate = 0.0
        if hasattr(item, "rate_with_margin"):
            item.rate_with_margin = 0.0
        if hasattr(item, "base_rate_with_margin"):
            item.base_rate_with_margin = 0.0
        if hasattr(item, "discount_amount"):
            item.discount_amount = 0.0
        if hasattr(item, "discount_percentage"):
            item.discount_percentage = 0.0
        if hasattr(item, "base_rate"):
            item.base_rate = 0.0
        if hasattr(item, "base_amount"):
            item.base_amount = 0.0
        if hasattr(item, "net_rate"):
            item.net_rate = 0.0
        if hasattr(item, "net_amount"):
            item.net_amount = 0.0
        if hasattr(item, "base_net_rate"):
            item.base_net_rate = 0.0
        if hasattr(item, "base_net_amount"):
            item.base_net_amount = 0.0


def _enforce_admin_only_amendment(doc):
    """An amended Sales Invoice may only change administrative fields (posting/due dates,
    PO ref, remarks, terms, print heading). Every commercial value is diffed against the
    cancelled original and any change is rejected — monetary corrections must go through a
    Credit Note or Sales Return instead. Pricing-engine regeneration is deliberately
    skipped so amounts can't silently drift if pricing config changed since the original."""
    from frappe.utils import flt

    original = frappe.get_doc("Sales Invoice", doc.amended_from)

    def _amt(value):
        return flt(value, 2)

    message = (
        "Only administrative fields (dates, PO reference, remarks, terms, print heading) can "
        "be changed on an amended invoice. Use a Credit Note or Sales Return to correct money, "
        "quantities or taxes."
    )

    if (doc.customer or "") != (original.customer or ""):
        frappe.throw(message)

    for field in ("total", "net_total", "grand_total", "base_grand_total", "total_taxes_and_charges"):
        if _amt(doc.get(field)) != _amt(original.get(field)):
            frappe.throw(message)

    def _rows(invoice):
        return [
            (r.item_code, _amt(r.qty), _amt(r.rate), _amt(r.amount))
            for r in invoice.items
            if not getattr(r, "custom_auto_generated", 0)
        ]

    if _rows(doc) != _rows(original):
        frappe.throw(message)

    # Administrative amendments stay non-stock and keep their manual posting time.
    doc.update_stock = 0
    doc.set_posting_time = 1


# Credit notes (returns) are numbered in their own series so they can't be mistaken for
# invoices: a bare number led by 9 (90001), a digit neither invoice series uses, with its own
# tabSeries counter ("9"). Set before naming runs; an amended credit note keeps its original
# name with the usual -1 suffix. (They were ACC-CNN-.YYYY.- until 2026-10-01.)
CREDIT_NOTE_NAMING_SERIES = "9.####"


# Invoices continue the numbering of the system they replace, one run per customer type, as
# the bare number with no prefix or year. The leading digit is each series' prefix, so the two
# keep separate counters in tabSeries ("1", "8"): Invoice Customers get 10009838, Cash
# Customers 80552. Invoices before 2026-10-01 keep their old INV-<year>- names; the counters
# carried over from "INV-2026-1" / "INV-2026-8" (see patches/carry_sales_invoice_series_counters).
INVOICE_CUSTOMER_NAMING_SERIES = "1.#######"
CASH_CUSTOMER_NAMING_SERIES = "8.####"


def before_insert(doc, method):
    if doc.get("amended_from"):
        return
    if doc.get("is_return"):
        doc.naming_series = CREDIT_NOTE_NAMING_SERIES
        return

    from crystal_alluminium_works.api import SHARED_CASH_CUSTOMER_NAME

    billing_type = frappe.db.get_value("Customer", doc.customer, "custom_customer_billing_type")
    is_cash = billing_type == "Cash Customer" or doc.customer == SHARED_CASH_CUSTOMER_NAME
    doc.naming_series = CASH_CUSTOMER_NAMING_SERIES if is_cash else INVOICE_CUSTOMER_NAMING_SERIES


def on_validate(doc, method):
    """
    Sales Invoice validate hook.
    Re-run the pricing engine to generate glass/ceiling service rows,
    mirroring the same logic used in quotation_handler.py and sales_order_handler.py.
    """
    # Amended invoices are administrative-only: lock commercial fields and skip the
    # pricing-engine regeneration entirely so amounts can't drift.
    if doc.get("amended_from"):
        _enforce_admin_only_amendment(doc)
        return

    # Credit notes / Sales Returns carry the original invoice's rows verbatim (with
    # reversed quantities); never re-run the pricing engine on them.
    if doc.get("is_return"):
        doc.update_stock = 0
        doc.set_posting_time = 1
        return

    # Keep custom invoicing non-stock for now.
    doc.update_stock = 0
    doc.set_posting_time = 1

    # ── 1. Remove old auto-generated rows to avoid duplication ────────
    items_to_keep = []
    for item in doc.items:
        if not item.custom_auto_generated:
            items_to_keep.append(item)
    doc.items = items_to_keep

    new_items = []
    # The Quotation Builder's +/- %, mapped here from the Quotation — see reapply_price_adjustment.
    adjustment_multiplier = get_price_adjustment_multiplier(doc)
    rates_adjusted = False

    # ── 2. Process each remaining item through the pricing engine ─────
    for idx, item in enumerate(doc.items):
        item_group = frappe.get_cached_value("Item", item.item_code, "item_group")

        if item_group == "Glass":
            auto_rows = process_glass_item(item, idx + 1)
            new_items.extend(auto_rows)
        elif item_group == "Ceiling":
            auto_rows = calculate_ceiling_pricing(item, idx + 1)
            new_items.extend(auto_rows)
        else:
            continue
        rates_adjusted = reapply_price_adjustment(item, item_group, adjustment_multiplier) or rates_adjusted

    # ── 3. Append generated service rows ──────────────────────────────
    for new_item in new_items:
        doc.append("items", new_item)

    # Ensure invoice-only accounting fields are filled for both mapped
    # rows and the auto-generated service lines before mandatory checks.
    doc.set_missing_item_details(for_validate=True)
    _reset_auto_generated_ceiling_component_pricing(doc)

    # ── 4. Recalculate totals since we added new items ────────────────
    if new_items or rates_adjusted:
        doc.calculate_taxes_and_totals()


def refresh_draft_invoice(name):
    invoice = frappe.get_doc("Sales Invoice", name)
    if invoice.docstatus != 0:
        frappe.throw("Only draft Sales Invoices can be refreshed safely.")

    invoice.save(ignore_permissions=True)
    return {
        "name": invoice.name,
        "grand_total": invoice.grand_total,
        "rounded_total": invoice.rounded_total,
        "outstanding_amount": invoice.outstanding_amount,
    }
