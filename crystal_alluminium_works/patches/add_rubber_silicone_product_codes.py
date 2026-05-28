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
        frappe.db.set_value(
            "Item",
            row.name,
            "custom_product_code",
            PRODUCT_CODES.get(row.item_group),
            update_modified=False,
        )

    frappe.clear_cache(doctype="Item")
