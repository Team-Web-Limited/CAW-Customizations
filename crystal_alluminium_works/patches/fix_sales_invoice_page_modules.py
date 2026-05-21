import frappe


def execute():
    page_names = ("sales-invoices", "sales-invoice-manager")

    for page_name in page_names:
        if frappe.db.exists("Page", page_name):
            frappe.db.set_value(
                "Page",
                page_name,
                "module",
                "Crystal Alluminium Works",
                update_modified=False,
            )
