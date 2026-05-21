import frappe

def create_doctype():
    if not frappe.db.exists("DocType", "Ceiling Configuration"):
        doc = frappe.get_doc({
            "doctype": "DocType",
            "name": "Ceiling Configuration",
            "module": "Crystal Alluminium Works",
            "custom": 1,
            "istable": 0,
            "naming_rule": "By fieldname",
            "autoname": "field:parent_item",
            "fields": [
                {
                    "fieldname": "parent_item",
                    "label": "Parent Item",
                    "fieldtype": "Link",
                    "options": "Item",
                    "reqd": 1,
                    "unique": 1
                },
                {"fieldname": "sb_1", "fieldtype": "Section Break", "label": "Component 1 (4ftT)"},
                {"fieldname": "item_1", "label": "Item", "fieldtype": "Link", "options": "Item"},
                {"fieldname": "ratio_1", "label": "Ratio", "fieldtype": "Float", "default": "2.5"},
                
                {"fieldname": "cb_1", "fieldtype": "Column Break"},
                {"fieldname": "item_2", "label": "Item (2ftT)", "fieldtype": "Link", "options": "Item"},
                {"fieldname": "ratio_2", "label": "Ratio", "fieldtype": "Float", "default": "2.5"},
                
                {"fieldname": "sb_2", "fieldtype": "Section Break", "label": "Component 3 & 4"},
                {"fieldname": "item_3", "label": "Item (Angle)", "fieldtype": "Link", "options": "Item"},
                {"fieldname": "ratio_3", "label": "Ratio", "fieldtype": "Float", "default": "3.0"},
                
                {"fieldname": "cb_2", "fieldtype": "Column Break"},
                {"fieldname": "item_4", "label": "Item (Board)", "fieldtype": "Link", "options": "Item"},
                {"fieldname": "ratio_4", "label": "Ratio", "fieldtype": "Float", "default": "0.36"}
            ],
            "permissions": [{"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1}]
        })
        doc.insert()
        frappe.db.commit()
        print("Created Ceiling Configuration DocType")
    else:
        print("Ceiling Configuration DocType already exists")
