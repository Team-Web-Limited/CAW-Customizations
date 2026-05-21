import frappe


def execute():
    for page_name in ("sales-order-manager", "sales-orders"):
        if frappe.db.exists("Page", page_name):
            frappe.db.set_value("Page", page_name, "module", "Selling", update_modified=False)
