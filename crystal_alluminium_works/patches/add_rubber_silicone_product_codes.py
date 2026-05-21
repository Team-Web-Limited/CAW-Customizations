import frappe


PRODUCT_CODES = {
    "Rubber": "R01",
    "Silicone": "S01",
}


def execute():
    if not frappe.get_meta("Item").has_field("custom_product_code"):
        return

    items = frappe.get_all(
        "Item",
        filters={"item_group": ["in", list(PRODUCT_CODES.keys())]},
        fields=["name", "item_group"],
    )

    for row in items:
        item = frappe.get_doc("Item", row.name)
        item.custom_product_code = PRODUCT_CODES.get(item.item_group)
        item.save(ignore_permissions=True)

    frappe.clear_cache(doctype="Item")
