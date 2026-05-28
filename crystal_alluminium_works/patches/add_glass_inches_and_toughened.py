import frappe


def execute():
    if frappe.db.exists("Custom Field", {"dt": "Item", "fieldname": "custom_glass_type"}):
        custom_field = frappe.get_doc("Custom Field", {"dt": "Item", "fieldname": "custom_glass_type"})
        custom_field.options = "Ordinary\nLaminated\nReady Laminated\nToughened"
        custom_field.save(ignore_permissions=True)

    intervals = frappe.get_all("Dimension Range", fields=["name", "equivalent_ft", "equivalent_inches", "interval_set"])
    for interval in intervals:
        doc = None
        if not frappe.utils.flt(interval.equivalent_inches) or not interval.interval_set:
            doc = frappe.get_doc("Dimension Range", interval.name)
        if not frappe.utils.flt(interval.equivalent_inches):
            doc.equivalent_inches = frappe.utils.flt(interval.equivalent_ft) * 12
        if not interval.interval_set:
            doc.interval_set = "Standard Glass"
        if doc:
            doc.save(ignore_permissions=True)

    if frappe.db.exists("Item", "Toughened Glass"):
        current_stock_uom = frappe.db.get_value("Item", "Toughened Glass", "stock_uom")
        frappe.db.set_value(
            "Item",
            "Toughened Glass",
            {
                "item_group": "Glass",
                "stock_uom": current_stock_uom or "Square Foot",
                "custom_glass_type": "Toughened",
            },
            update_modified=False,
        )
    elif frappe.db.exists("Item Group", "Glass"):
        item = frappe.get_doc({
            "doctype": "Item",
            "item_code": "Toughened Glass",
            "item_name": "Toughened Glass",
            "item_group": "Glass",
            "stock_uom": "Square Foot",
            "is_stock_item": 0,
            "standard_rate": 200.0,
            "custom_glass_type": "Toughened",
        })
        item.append("uoms", {"uom": "Square Foot", "conversion_factor": 1})
        item.insert(ignore_permissions=True)

    frappe.clear_cache(doctype="Item")
