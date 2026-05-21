import frappe


PRODUCT_CATEGORY_OPTIONS = "\nAluminium\nGlass\nFittings\nCeiling\nRubber\nSilicone"
TARGET_DOCTYPES = ("Quotation Item", "Sales Order Item", "Sales Invoice Item")


def execute():
    updated = False

    for dt in TARGET_DOCTYPES:
        field_name = frappe.db.exists("Custom Field", {"dt": dt, "fieldname": "custom_product_category"})
        if not field_name:
            continue

        field = frappe.get_doc("Custom Field", field_name)
        if (field.options or "") == PRODUCT_CATEGORY_OPTIONS:
            continue

        field.options = PRODUCT_CATEGORY_OPTIONS
        field.save(ignore_permissions=True)
        updated = True

    if updated:
        frappe.clear_cache()
