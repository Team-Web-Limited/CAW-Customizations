import frappe

def create_payments():
    frappe.flags.in_install = True

    # 1. Create Payments DocType
    if not frappe.db.exists("DocType", "Payments"):
        doc = frappe.get_doc({
            "doctype": "DocType",
            "name": "Payments",
            "module": "Crystal Alluminium Works",
            "custom": 0,
            "autoname": "autoincrement",
            "naming_rule": "Autoincrement",
            "fields": [
                {"fieldname": "title", "fieldtype": "Data", "label": "Title", "reqd": 1, "in_list_view": 1}
            ],
            "permissions": [{"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1}]
        })
        doc.insert()
        print("Created Payments DocType")
    else:
        print("Payments DocType already exists")

    # 2. Create Custom Page from it
    if not frappe.db.exists("Page", "payments-page"):
        page = frappe.get_doc({
            "doctype": "Page",
            "page_name": "payments-page",
            "title": "Payments Page",
            "module": "Crystal Alluminium Works",
            "standard": "Yes",
            "roles": [{"role": "System Manager"}]
        })
        page.insert(ignore_permissions=True)
        print("Created Payments Page")
    else:
        print("Payments Page already exists")
        
    frappe.db.commit()
