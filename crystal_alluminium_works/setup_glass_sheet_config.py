import frappe


GLASS_SHEET_TYPE_OPTIONS = "Ordinary\nReady Laminated"


def run_setup():
    if not frappe.db.exists("DocType", "Glass Sheet Config"):
        doc = frappe.get_doc({
            "doctype": "DocType",
            "name": "Glass Sheet Config",
            "module": "Crystal Alluminium Works",
            "custom": 1,
            "autoname": "hash",
            "fields": [
                {
                    "fieldname": "glass_type",
                    "fieldtype": "Select",
                    "label": "Glass Type",
                    "options": GLASS_SHEET_TYPE_OPTIONS,
                    "reqd": 1,
                },
                {
                    "fieldname": "size",
                    "fieldtype": "Data",
                    "label": "Size",
                    "reqd": 1,
                },
                {
                    "fieldname": "sft",
                    "fieldtype": "Float",
                    "label": "SFT",
                    "reqd": 1,
                    "default": 0,
                },
            ],
            "permissions": [{"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1}],
        })
        doc.insert()
        frappe.db.commit()
        return

    meta = frappe.get_meta("Glass Sheet Config")
    if meta.has_field("glass_type"):
        field = frappe.get_doc("DocField", {"parent": "Glass Sheet Config", "fieldname": "glass_type"})
        if (field.options or "").strip() != GLASS_SHEET_TYPE_OPTIONS:
            field.options = GLASS_SHEET_TYPE_OPTIONS
            field.save(ignore_permissions=True)
            frappe.clear_cache(doctype="Glass Sheet Config")


if __name__ == "__main__":
    run_setup()
