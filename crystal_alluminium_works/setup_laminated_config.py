import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

def run_setup():
    # 1. Create Laminated Glass Config DocType
    if not frappe.db.exists("DocType", "Laminated Glass Config"):
        doc = frappe.get_doc({
            "doctype": "DocType",
            "name": "Laminated Glass Config",
            "module": "Crystal Alluminium Works",
            "custom": 1,
            "autoname": "field:parent_item",
            "fields": [
                {"fieldname": "parent_item", "fieldtype": "Link", "options": "Item", "label": "Parent Item", "unique": 1, "reqd": 1},
                {"fieldname": "polishing_rate", "fieldtype": "Currency", "label": "Polishing Rate (per rft)", "default": 0},
                {"fieldname": "hole_rate", "fieldtype": "Currency", "label": "Hole Rate (per hole)", "default": 0},
                {"fieldname": "notch_rate", "fieldtype": "Currency", "label": "Notch Rate (per notch)", "default": 0},
                {"fieldname": "sandblast_rate", "fieldtype": "Currency", "label": "Sandblast Rate (per sqft)", "default": 0}
            ],
            "permissions": [{"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1}]
        })
        doc.insert()
        print("Created Laminated Glass Config DocType")

    create_custom_fields({
        "Laminated Glass Config": [
            {
                "fieldname": "notch_rate",
                "label": "Notch Rate (per notch)",
                "fieldtype": "Currency",
                "insert_after": "hole_rate",
                "default": 0,
            }
        ],
        "Glass Pricing Settings": [
            {
                "fieldname": "notch_rate",
                "label": "Notch Rate",
                "fieldtype": "Currency",
                "insert_after": "hole_rate",
                "default": 0,
            }
        ]
    })

    # 2. Add custom_glass_type to Item
    create_custom_fields({
        "Item": [
            {
                "fieldname": "custom_glass_type",
                "label": "Glass Type",
                "fieldtype": "Select",
                "options": "Ordinary\nLaminated\nReady Laminated\nToughened",
                "default": "Ordinary",
                "insert_after": "item_group",
                "depends_on": "eval:doc.item_group=='Glass'"
            },
            {
                "fieldname": "custom_product_code",
                "label": "Product Code",
                "fieldtype": "Data",
                "insert_after": "custom_glass_type",
                "read_only": 1,
            }
        ]
    })
    print("Added custom item classification fields to Item")

if __name__ == "__main__":
    run_setup()
