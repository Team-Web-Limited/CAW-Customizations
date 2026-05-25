import frappe

from crystal_alluminium_works.create_custom_fields import GLASS_SALE_MODE_OPTIONS


def execute():
    for doctype in ("Quotation Item", "Sales Order Item", "Sales Invoice Item"):
        custom_field_name = frappe.db.exists("Custom Field", {"dt": doctype, "fieldname": "custom_glass_sale_mode"})
        if not custom_field_name:
            continue

        custom_field = frappe.get_doc("Custom Field", custom_field_name)
        if (custom_field.options or "") == GLASS_SALE_MODE_OPTIONS:
            continue

        custom_field.options = GLASS_SALE_MODE_OPTIONS
        custom_field.save(ignore_permissions=True)
        frappe.clear_cache(doctype=doctype)
