import frappe

PRODUCT_CATEGORY_OPTIONS = "\nAluminium\nGlass\nFittings\nCeiling\nRubber\nSilicone"

def add_category_field():
    if not frappe.db.exists("Custom Field", {"dt": "Quotation Item", "fieldname": "custom_product_category"}):
        doc = frappe.get_doc({
            "doctype": "Custom Field",
            "dt": "Quotation Item",
            "module": "Crystal Alluminium Works",
            "fieldname": "custom_product_category",
            "fieldtype": "Select",
            "label": "Product Category",
            "options": PRODUCT_CATEGORY_OPTIONS,
            "insert_after": "section_break_uaoc",
            "in_list_view": 1,
            "reqd": 0
        })
        doc.insert()
        frappe.db.commit()
        print("Created custom_product_category field")
    else:
        field = frappe.get_doc("Custom Field", {"dt": "Quotation Item", "fieldname": "custom_product_category"})
        if (field.options or "") != PRODUCT_CATEGORY_OPTIONS:
            field.options = PRODUCT_CATEGORY_OPTIONS
            field.save(ignore_permissions=True)
            frappe.db.commit()
            print("Updated custom_product_category field options")
        else:
            print("Field already exists")

if __name__ == "__main__":
    add_category_field()
