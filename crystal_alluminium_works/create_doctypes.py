import frappe

def create_doctypes():
    frappe.flags.in_install = True

    # 1. Dimension Range
    if not frappe.db.exists("DocType", "Dimension Range"):
        doc = frappe.get_doc({
            "doctype": "DocType",
            "name": "Dimension Range",
            "module": "Crystal Alluminium Works",
            "custom": 0,
            "editable_grid": 1,
            "fields": [
                {"fieldname": "min_mm", "fieldtype": "Float", "label": "Min (mm)", "reqd": 1, "in_list_view": 1},
                {"fieldname": "max_mm", "fieldtype": "Float", "label": "Max (mm)", "reqd": 1, "in_list_view": 1},
                {"fieldname": "equivalent_ft", "fieldtype": "Float", "label": "Equivalent (ft)", "reqd": 1, "in_list_view": 1},
                {"fieldname": "equivalent_inches", "fieldtype": "Float", "label": "Equivalent (inches)", "reqd": 1, "in_list_view": 1},
                {"fieldname": "equivalent_inches_min", "fieldtype": "Float", "label": "Equivalent Inches Min", "in_list_view": 1},
                {"fieldname": "equivalent_inches_max", "fieldtype": "Float", "label": "Equivalent Inches Max", "in_list_view": 1},
                {"fieldname": "interval_set", "fieldtype": "Select", "label": "Interval Set", "options": "Standard Glass\nToughened Glass", "default": "Standard Glass", "reqd": 1, "in_list_view": 1}
            ],
            "permissions": [{"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1}]
        })
        doc.insert()
        print("Created Dimension Range")

    # 2. Glass Pricing Settings
    if not frappe.db.exists("DocType", "Glass Pricing Settings"):
        doc = frappe.get_doc({
            "doctype": "DocType",
            "name": "Glass Pricing Settings",
            "module": "Crystal Alluminium Works",
            "custom": 0,
            "issingle": 1,
            "fields": [
                {"fieldname": "base_rate", "fieldtype": "Currency", "label": "Base Rate", "default": "90"},
                {"fieldname": "polishing_rate", "fieldtype": "Currency", "label": "Polishing Rate", "default": "20"},
                {"fieldname": "hole_rate", "fieldtype": "Currency", "label": "Hole Rate", "default": "25"},
                {"fieldname": "notch_rate", "fieldtype": "Currency", "label": "Notch Rate", "default": "25"},
                {"fieldname": "sandblast_rate", "fieldtype": "Currency", "label": "Sandblast Rate", "default": "70"}
            ],
            "permissions": [{"role": "System Manager", "read": 1, "write": 1, "create": 1}]
        })
        doc.insert()
        print("Created Glass Pricing Settings")

    # 3. Ceiling Composition
    if not frappe.db.exists("DocType", "Ceiling Composition"):
        doc = frappe.get_doc({
            "doctype": "DocType",
            "name": "Ceiling Composition",
            "module": "Crystal Alluminium Works",
            "custom": 0,
            "editable_grid": 1,
            "fields": [
                {"fieldname": "component_name", "fieldtype": "Data", "label": "Component", "reqd": 1, "in_list_view": 1},
                {"fieldname": "ratio", "fieldtype": "Float", "label": "Ratio per sqm", "reqd": 1, "in_list_view": 1}
            ],
            "permissions": [{"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1}]
        })
        doc.insert()
        print("Created Ceiling Composition")
        
    frappe.db.commit()

if __name__ == "__main__":
    create_doctypes()
