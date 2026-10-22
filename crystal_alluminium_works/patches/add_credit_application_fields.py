import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

from crystal_alluminium_works.create_custom_fields import get_account_control_fields


def execute():
    """Credit application fields on Customer (customer_documents.py)."""
    create_custom_fields(get_account_control_fields(), update=True)
    frappe.clear_cache(doctype="Customer")
