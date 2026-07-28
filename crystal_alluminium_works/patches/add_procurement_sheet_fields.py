"""Extend the glass sheet / ceiling piece stock-in fields from Purchase Receipt
Item to Material Request Item and Purchase Order Item, so the buying workflow can
start at a request or an order instead of only at the receipt.

Also makes the Purchase Receipt Item copies editable — they were read-only because
only the CAW Stock Entry page wrote them; now a receipt raised from a Purchase
Order can be adjusted (e.g. fewer sheets delivered than ordered).

custom_product_category also moves to the very first field position (ahead of
item_code) so the buyer picks a category before an item, and custom_rate_per_piece
is dropped from Material Request Item — there's no pricing at the request stage.

Field order ends up: category, item code, item name (forced read-only), sheet
size, sheets/pcs — the fields the buyer actually needs to touch when raising a
glass sheet order. Glass Sale Mode and SFT/Sheet are still tracked (the pricing
math in purchase_handler.py depends on them) but hidden, since they're derived,
not entered.
"""

import frappe

from crystal_alluminium_works.create_custom_fields import add_custom_fields


def execute():
    stale_field = frappe.db.get_value(
        "Custom Field", {"dt": "Material Request Item", "fieldname": "custom_rate_per_piece"}
    )
    if stale_field:
        frappe.delete_doc("Custom Field", stale_field, ignore_permissions=True)

    add_custom_fields()

    # Parents too — their cached form meta carries the new doctype_js.
    for doctype in (
        "Material Request",
        "Material Request Item",
        "Purchase Order",
        "Purchase Order Item",
        "Purchase Receipt",
        "Purchase Receipt Item",
    ):
        frappe.clear_cache(doctype=doctype)
