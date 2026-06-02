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
                {"fieldname": "polishing_rate_4_6", "fieldtype": "Currency", "label": "4-6 Polish Rate", "default": "20"},
                {"fieldname": "polishing_rate_8_10", "fieldtype": "Currency", "label": "8-10 Polish Rate", "default": "20"},
                {"fieldname": "polishing_rate_14_35", "fieldtype": "Currency", "label": "14-35 Polish Rate", "default": "20"},
                {"fieldname": "hole_rate", "fieldtype": "Currency", "label": "Hole Rate", "default": "25"},
                {"fieldname": "hole_rate_5mm", "fieldtype": "Currency", "label": "5mm Hole Rate", "default": "25"},
                {"fieldname": "hole_rate_6mm", "fieldtype": "Currency", "label": "6mm Hole Rate", "default": "25"},
                {"fieldname": "hole_rate_8mm", "fieldtype": "Currency", "label": "8mm Hole Rate", "default": "25"},
                {"fieldname": "hole_rate_10mm", "fieldtype": "Currency", "label": "10mm Hole Rate", "default": "25"},
                {"fieldname": "hole_rate_15mm", "fieldtype": "Currency", "label": "15mm Hole Rate", "default": "25"},
                {"fieldname": "hole_rate_20mm", "fieldtype": "Currency", "label": "20mm Hole Rate", "default": "25"},
                {"fieldname": "notch_rate", "fieldtype": "Currency", "label": "Notch Rate", "default": "25"},
                {"fieldname": "notch_rate_standard", "fieldtype": "Currency", "label": "Standard Notch Rate", "default": "25"},
                {"fieldname": "notch_rate_small", "fieldtype": "Currency", "label": "Small Notch Rate", "default": "25"},
                {"fieldname": "notch_rate_mirror_screws", "fieldtype": "Currency", "label": "Mirror Screws Notch Rate", "default": "25"},
                {"fieldname": "notch_rate_timber_box", "fieldtype": "Currency", "label": "Timber Box Notch Rate", "default": "25"},
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

    # 4. Aluminium Color
    if not frappe.db.exists("DocType", "Aluminium Color"):
        doc = frappe.get_doc({
            "doctype": "DocType",
            "name": "Aluminium Color",
            "module": "Crystal Alluminium Works",
            "custom": 0,
            "editable_grid": 1,
            "autoname": "field:color_name",
            "fields": [
                {"fieldname": "color_name", "fieldtype": "Data", "label": "Color", "reqd": 1, "in_list_view": 1, "unique": 1}
            ],
            "permissions": [{"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1}]
        })
        doc.insert()
        print("Created Aluminium Color")
        
    frappe.db.commit()

if __name__ == "__main__":
    create_doctypes()
