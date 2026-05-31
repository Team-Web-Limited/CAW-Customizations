import frappe

from crystal_alluminium_works.pricing_engine import ensure_ceiling_component_items


def execute():
    if frappe.db.exists("Item", "Board"):
        try:
            frappe.delete_doc("Item", "Board", ignore_permissions=True, force=1)
        except Exception:
            frappe.db.set_value("Item", "Board", "disabled", 1, update_modified=False)

    ensure_ceiling_component_items()
    frappe.db.commit()
