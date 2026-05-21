import frappe


def execute():
    if not frappe.db.exists("UOM", "Square Foot"):
        return

    if not frappe.db.exists("Item", "Glass Sandblasting"):
        return

    item = frappe.get_doc("Item", "Glass Sandblasting")
    item.stock_uom = "Square Foot"

    current_uoms = [row.uom for row in item.get("uoms") or []]
    if "Square Foot" not in current_uoms:
        item.append("uoms", {"uom": "Square Foot", "conversion_factor": 1})

    item.save(ignore_permissions=True)
    frappe.clear_cache(doctype="Item")
