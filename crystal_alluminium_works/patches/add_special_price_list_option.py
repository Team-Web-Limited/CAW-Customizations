import frappe

PRICE_LIST_OPTIONS = "\nRetail\nWholesale\nSpecial"


def execute():
    """"Special" in the item rows' Price List select: the Quotation Builder's aluminium Special
    Price saves as the Special price list, which the select used to reject."""
    for name in frappe.get_all(
        "Custom Field", filters={"fieldname": "custom_price_list", "fieldtype": "Select"}, pluck="name"
    ):
        field = frappe.get_doc("Custom Field", name)
        if "Special" not in (field.options or "").split("\n"):
            field.options = PRICE_LIST_OPTIONS
            field.save(ignore_permissions=True)
