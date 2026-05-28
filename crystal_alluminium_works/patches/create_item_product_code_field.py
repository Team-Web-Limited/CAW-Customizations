import frappe

from crystal_alluminium_works.create_custom_fields import add_item_custom_fields


GLASS_CODES = {
    "Ordinary": "OG",
    "Laminated": "LG",
    "Ready Laminated": "RLG",
    "Toughened": "TG",
}

CATEGORY_CODES = {
    "Aluminium": "A01",
    "Fittings": "F01",
    "Ceiling": "C01",
    "Rubber": "R01",
    "Silicone": "S01",
}


def _infer_glass_type(item_code=None, item_name=None):
    source = f"{item_code or ''} {item_name or ''}".lower()
    if "ready laminated" in source:
        return "Ready Laminated"
    if "toughened" in source:
        return "Toughened"
    if "laminated" in source:
        return "Laminated"
    return "Ordinary"


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
    add_item_custom_fields()

    item_fields = ["name", "item_code", "item_name", "item_group"]
    if frappe.get_meta("Item").has_field("custom_glass_type"):
        item_fields.append("custom_glass_type")

    for row in frappe.get_all(
        "Item",
        filters={"item_group": ["in", ["Glass", "Aluminium", "Fittings", "Ceiling", "Rubber", "Silicone"]]},
        fields=item_fields,
    ):
        product_code = CATEGORY_CODES.get(row.item_group)
        if row.item_group == "Glass":
            if _is_glass_service_item(row.item_name):
                product_code = None
            else:
                glass_type = (getattr(row, "custom_glass_type", None) or "").strip() or _infer_glass_type(row.item_code, row.item_name)
                product_code = GLASS_CODES.get(glass_type)
        frappe.db.set_value("Item", row.name, "custom_product_code", product_code, update_modified=False)

    frappe.clear_cache(doctype="Item")
