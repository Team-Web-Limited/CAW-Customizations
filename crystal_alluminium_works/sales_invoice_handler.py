import frappe
from crystal_alluminium_works.pricing_engine import calculate_ceiling_pricing, process_glass_item


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


def on_validate(doc, method):
    """
    Sales Invoice validate hook.
    Re-run the pricing engine to generate glass/ceiling service rows,
    mirroring the same logic used in quotation_handler.py and sales_order_handler.py.
    """
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

    # ── 2. Process each remaining item through the pricing engine ─────
    for idx, item in enumerate(doc.items):
        item_group = frappe.get_cached_value("Item", item.item_code, "item_group")

        if item_group == "Glass":
            auto_rows = process_glass_item(item, idx + 1)
            new_items.extend(auto_rows)
        elif item_group == "Ceiling":
            auto_rows = calculate_ceiling_pricing(item, idx + 1)
            new_items.extend(auto_rows)

    # ── 3. Append generated service rows ──────────────────────────────
    for new_item in new_items:
        doc.append("items", new_item)

    # Ensure invoice-only accounting fields are filled for both mapped
    # rows and the auto-generated service lines before mandatory checks.
    doc.set_missing_item_details(for_validate=True)
    _reset_auto_generated_ceiling_component_pricing(doc)

    # ── 4. Recalculate totals since we added new items ────────────────
    if new_items:
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
