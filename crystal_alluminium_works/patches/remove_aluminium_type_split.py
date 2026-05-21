import frappe


ALUMINIUM_PRODUCT_CODE = "A01"


def _update_custom_field(fieldname, values):
    field_name = frappe.db.exists("Custom Field", {"dt": "Item", "fieldname": fieldname})
    if not field_name:
        return

    field = frappe.get_doc("Custom Field", field_name)
    changed = False
    for key, value in values.items():
        if getattr(field, key, None) != value:
            setattr(field, key, value)
            changed = True

    if changed:
        field.save(ignore_permissions=True)


def execute():
    _update_custom_field("custom_aluminium_type", {
        "hidden": 1,
        "reqd": 0,
        "read_only": 1,
        "depends_on": "",
        "default": "",
    })
    _update_custom_field("custom_product_code", {
        "insert_after": "custom_glass_type",
    })

    item_names = frappe.get_all("Item", filters={"item_group": "Aluminium"}, pluck="name")
    for item_name in item_names:
        item = frappe.get_doc("Item", item_name)
        if hasattr(item, "custom_aluminium_type"):
            item.custom_aluminium_type = None
        if hasattr(item, "custom_product_code"):
            item.custom_product_code = ALUMINIUM_PRODUCT_CODE
        item.save(ignore_permissions=True)

    frappe.clear_cache(doctype="Item")
