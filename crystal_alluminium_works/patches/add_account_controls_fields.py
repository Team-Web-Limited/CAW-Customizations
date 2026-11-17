import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

from crystal_alluminium_works.create_custom_fields import get_account_control_fields


def execute():
    create_custom_fields(get_account_control_fields(), update=True)
    for doctype in ("Customer", "Contact", "Quotation", "Sales Invoice"):
        frappe.clear_cache(doctype=doctype)
