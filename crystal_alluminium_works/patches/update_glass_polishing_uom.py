import frappe


def execute():
    if not frappe.db.exists("UOM", "Rft"):
        frappe.get_doc({
            "doctype": "UOM",
            "uom_name": "Rft",
        }).insert(ignore_permissions=True)

    if not frappe.db.exists("Item", "Glass Polishing"):
        return

    item = frappe.get_doc("Item", "Glass Polishing")
    item.stock_uom = "Rft"

    current_uoms = [row.uom for row in item.get("uoms") or []]
    if "Rft" not in current_uoms:
        item.append("uoms", {"uom": "Rft", "conversion_factor": 1})

    item.save(ignore_permissions=True)
    frappe.clear_cache(doctype="Item")
