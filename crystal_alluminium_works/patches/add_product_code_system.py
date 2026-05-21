import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


GLASS_CODES = {
    "Ordinary": "OG",
    "Laminated": "LG",
    "Ready Laminated": "RLG",
    "Toughened": "TG",
}
ALUMINIUM_CODES = {
    "Aluminium": "A01",
}
CATEGORY_CODES = {
    "Fittings": "F01",
    "Ceiling": "C01",
}


def _normalize_aluminium_type(value):
    return None


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


def _get_product_code(item):
    if item.item_group == "Glass":
        if _is_glass_service_item(item.item_name):
            return None
        glass_type = (item.custom_glass_type or "").strip() or "Ordinary"
        return GLASS_CODES.get(glass_type)

    if item.item_group == "Aluminium":
        item.custom_aluminium_type = None
        return ALUMINIUM_CODES["Aluminium"]

    return CATEGORY_CODES.get(item.item_group)


def execute():
    create_custom_fields({
        "Item": [
            {
                "fieldname": "custom_product_code",
                "label": "Product Code",
                "fieldtype": "Data",
                "insert_after": "custom_glass_type",
                "read_only": 1,
            },
        ]
    })

    items = frappe.get_all(
        "Item",
        filters={"item_group": ["in", ["Glass", "Aluminium", "Fittings", "Ceiling"]]},
        fields=["name"],
    )

    for row in items:
        item = frappe.get_doc("Item", row.name)
        item.custom_product_code = _get_product_code(item)
        item.save(ignore_permissions=True)

    frappe.clear_cache(doctype="Item")
