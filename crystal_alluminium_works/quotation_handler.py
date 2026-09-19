import frappe
from crystal_alluminium_works.pricing_engine import calculate_ceiling_pricing, process_glass_item

def on_validate(doc, method):
    # 1. Remove all old auto-generated rows to avoid duplication
    items_to_keep = []
    for item in doc.items:
        if not item.custom_auto_generated:
            items_to_keep.append(item)
    doc.items = items_to_keep

    new_items = []
    
    # 2. Process each remaining item
    for idx, item in enumerate(doc.items):
        item_group = frappe.get_cached_value("Item", item.item_code, "item_group")
        
        if item_group == "Glass":
            auto_rows = process_glass_item(item, idx + 1)
            new_items.extend(auto_rows)
        elif item_group == "Ceiling":
            auto_rows = calculate_ceiling_pricing(item, idx + 1)
            new_items.extend(auto_rows)
            
    # 3. Append generated service rows
    for new_item in new_items:
        doc.append("items", new_item)

    # 4. Recalculate totals unconditionally — process_glass_item/calculate_ceiling_pricing
    # always overwrite the main row's own rate/amount in place (deriving price from area x
    # the Item's standard rate), even on rows that need no auto-generated service rows at
    # all (no holes/notches/polishing). Gating this on `new_items` skipped the recalc for
    # exactly those rows, leaving doc.grand_total/base_rate/base_amount stuck at whatever
    # they were before this hook ran instead of reflecting the rate it just set.
    doc.calculate_taxes_and_totals()


def on_submit(doc, method):
    # When a freshly-amended Quotation is submitted, re-point its existing Job Card to
    # this revision (the Job Card keeps its stable name/number).
    if not doc.get("amended_from"):
        return
    from crystal_alluminium_works.api import _on_quotation_amendment_submitted
    _on_quotation_amendment_submitted(doc)

