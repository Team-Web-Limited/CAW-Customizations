import frappe

from crystal_alluminium_works.api import MISCELLANEOUS_ITEM_CODE, MISCELLANEOUS_ITEM_GROUP
from crystal_alluminium_works.create_custom_fields import add_custom_fields

MISCELLANEOUS_NAME = "Miscellaneous"


def execute():
    # "Miscellaneous" in the item rows' Product Category options (PRODUCT_CATEGORY_OPTIONS).
    add_custom_fields()
    if not frappe.db.exists("Item Group", MISCELLANEOUS_ITEM_GROUP):
        frappe.get_doc({
            "doctype": "Item Group",
            "item_group_name": MISCELLANEOUS_ITEM_GROUP,
            "parent_item_group": "All Item Groups",
            "is_group": 0,
        }).insert(ignore_permissions=True)

    # A58 was an unused Aluminium item ("BOOTH": never quoted or invoiced; its only stock
    # records are zero-quantity opening reconciliations). It becomes the non-stock wildcard.
    # db.set_value rather than save: ERPNext refuses to change is_stock_item once any stock
    # ledger entry exists, even a zero-quantity one.
    values = {
        "item_name": MISCELLANEOUS_NAME,
        "description": MISCELLANEOUS_NAME,
        "item_group": MISCELLANEOUS_ITEM_GROUP,
        "is_stock_item": 0,
        "is_sales_item": 1,
        "disabled": 0,
        "standard_rate": 0,
    }
    if frappe.db.exists("Item", MISCELLANEOUS_ITEM_CODE):
        frappe.db.set_value("Item", MISCELLANEOUS_ITEM_CODE, values)
        return

    item = frappe.new_doc("Item")
    item.item_code = MISCELLANEOUS_ITEM_CODE
    item.stock_uom = "Nos"
    item.update(values)
    item.insert(ignore_permissions=True)
