import frappe


GLASS_CODES = {
    "Ordinary": "OG",
    "Laminated": "LG",
    "Ready Laminated": "RLG",
    "Toughened": "TG",
}


def _is_glass_service_item(item_name):
    item_name = (item_name or "").strip().lower()
    return any(keyword in item_name for keyword in (
        "polishing",
        "drilling",
        "sandblasting",
        "hole",
        "notching",
        "notch",
    ))


def execute():
    if not frappe.get_meta("Item").has_field("custom_product_code"):
        return

    items = frappe.get_all(
        "Item",
        filters={"item_group": "Glass"},
        fields=["name", "item_name", "custom_glass_type"],
    )

    for row in items:
        if _is_glass_service_item(row.item_name):
            continue

        item = frappe.get_doc("Item", row.name)
        item.custom_product_code = GLASS_CODES.get((item.custom_glass_type or "").strip() or "Ordinary")
        item.save(ignore_permissions=True)

    frappe.clear_cache(doctype="Item")
