import frappe

def execute():
    doc = frappe.get_doc("Workspace Sidebar", "Crystal Alluminium Works")
    child = doc.append("items", {
        "label": "Payments Page",
        "link_to": "payments-page",
        "link_type": "Page",
        "type": "Link",
        "icon": "credit-card",
        "child": 1
    })
    doc.save()
    frappe.db.commit()
    print("Added Payments Page to Sidebar")
