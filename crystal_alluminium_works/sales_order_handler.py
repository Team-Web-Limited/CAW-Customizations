import frappe
from crystal_alluminium_works.pricing_engine import calculate_ceiling_pricing, process_glass_item


def on_validate(doc, method):
    """
    Sales Order validate hook.
    1. Auto-set skip_delivery_note (Delivery Note is deferred).
    2. Re-run the pricing engine to generate glass/ceiling service rows,
       mirroring the same logic used in quotation_handler.py.
    """
    # ── 1. Skip Delivery Note (deferred feature) ──────────────────────
    doc.skip_delivery_note = 1

    # ── 2. Remove old auto-generated rows to avoid duplication ────────
    items_to_keep = []
    for item in doc.items:
        if not item.custom_auto_generated:
            items_to_keep.append(item)
    doc.items = items_to_keep

    new_items = []

    # ── 3. Process each remaining item through the pricing engine ─────
    for idx, item in enumerate(doc.items):
        item_group = frappe.get_cached_value("Item", item.item_code, "item_group")

        if item_group == "Glass":
            auto_rows = process_glass_item(item, idx + 1)
            new_items.extend(auto_rows)
        elif item_group == "Ceiling":
            auto_rows = calculate_ceiling_pricing(item, idx + 1)
            new_items.extend(auto_rows)

    # ── 4. Append generated service rows ──────────────────────────────
    for new_item in new_items:
        doc.append("items", new_item)

    # ── 5. Recalculate totals since we added new items ────────────────
    if new_items:
        doc.calculate_taxes_and_totals()
