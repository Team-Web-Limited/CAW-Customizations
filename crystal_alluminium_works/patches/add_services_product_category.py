import frappe

from crystal_alluminium_works.create_custom_fields import PRODUCT_CATEGORY_OPTIONS


def execute():
    """"Services" in every Product Category select (Quotation Builder + Services, api.py)."""
    for name in frappe.get_all(
        "Custom Field", filters={"fieldname": "custom_product_category", "fieldtype": "Select"}, pluck="name"
    ):
        field = frappe.get_doc("Custom Field", name)
        if field.options != PRODUCT_CATEGORY_OPTIONS:
            field.options = PRODUCT_CATEGORY_OPTIONS
            field.save(ignore_permissions=True)
