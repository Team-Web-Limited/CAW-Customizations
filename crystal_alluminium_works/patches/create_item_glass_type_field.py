import frappe

from crystal_alluminium_works.create_custom_fields import add_item_custom_fields, ITEM_GLASS_TYPE_OPTIONS


def _infer_glass_type(item_code=None, item_name=None):
    source = f"{item_code or ''} {item_name or ''}".lower()
    if "ready laminated" in source:
        return "Ready Laminated"
    if "toughened" in source:
        return "Toughened"
    if "laminated" in source:
        return "Laminated"
    return "Ordinary"


def execute():
    add_item_custom_fields()

    custom_field_name = frappe.db.exists("Custom Field", {"dt": "Item", "fieldname": "custom_glass_type"})
    if custom_field_name:
        custom_field = frappe.get_doc("Custom Field", custom_field_name)
        if (custom_field.options or "") != ITEM_GLASS_TYPE_OPTIONS:
            custom_field.options = ITEM_GLASS_TYPE_OPTIONS
            custom_field.save(ignore_permissions=True)

    for item in frappe.get_all("Item", filters={"item_group": "Glass"}, fields=["name", "item_code", "item_name"]):
        frappe.db.set_value(
            "Item",
            item.name,
            "custom_glass_type",
            _infer_glass_type(item.item_code, item.item_name),
            update_modified=False,
        )

    frappe.clear_cache(doctype="Item")
