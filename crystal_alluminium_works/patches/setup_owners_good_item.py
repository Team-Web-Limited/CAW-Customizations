import frappe

from crystal_alluminium_works.api import OWNERS_GOOD_ITEM_CODE
from crystal_alluminium_works.create_custom_fields import add_custom_fields

OWNERS_GOOD_NAME = "Owners Good"


def execute():
    # Quotation Item custom_aluminium_rate_per_kg / custom_aluminium_weight_per_length.
    add_custom_fields()
    frappe.clear_cache(doctype="Quotation Item")

    # G85 Owners Good: an Aluminium item with no stored price, and non-stock (the customer's own
    # aluminium). db_set when it already exists, because ERPNext refuses to change is_stock_item
    # once any stock ledger entry exists.
    values = {
        "item_name": OWNERS_GOOD_NAME,
        "description": OWNERS_GOOD_NAME,
        "item_group": "Aluminium",
        "is_stock_item": 0,
        "is_sales_item": 1,
        "disabled": 0,
        "standard_rate": 0,
        "custom_aluminium_rate_per_kg": 0,
        "custom_aluminium_weight_per_length": 0,
    }
    if frappe.db.exists("Item", OWNERS_GOOD_ITEM_CODE):
        frappe.db.set_value("Item", OWNERS_GOOD_ITEM_CODE, values)
        return

    item = frappe.new_doc("Item")
    item.item_code = OWNERS_GOOD_ITEM_CODE
    item.stock_uom = "Nos"
    item.update(values)
    item.insert(ignore_permissions=True)
