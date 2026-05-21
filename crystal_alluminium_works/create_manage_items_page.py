import frappe

def create_page():
    page_name = "manage-items"
    
    if not frappe.db.exists("Page", page_name):
        frappe.get_doc({
            "doctype": "Page",
            "name": page_name,
            "page_name": page_name,
            "title": "Manage Items",
            "module": "Crystal Alluminium Works",
            "standard": "Yes",
            "roles": [{"role": "System Manager"}]
        }).insert(ignore_permissions=True)
        frappe.db.commit()
        print(f"Created Page: {page_name}")
    else:
        print(f"Page {page_name} already exists.")
