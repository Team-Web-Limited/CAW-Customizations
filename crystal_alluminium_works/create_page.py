import frappe

def create_page():
    if not frappe.db.exists('Page', 'quotation-manager'):
        page = frappe.get_doc({
            'doctype': 'Page',
            'page_name': 'Quotation Manager',
            'title': 'Quotation Manager',
            'module': 'Crystal Alluminium Works',
            'standard': 'Yes',
            'roles': [{'role': 'System Manager'}]
        })
        page.insert(ignore_permissions=True)
        frappe.db.commit()
        print("Page created successfully")
    else:
        print("Page already exists")
