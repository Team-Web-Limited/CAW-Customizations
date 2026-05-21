import frappe


def execute():
    intervals = frappe.get_all(
        "Dimension Range",
        fields=[
            "name",
            "min_mm",
            "max_mm",
            "equivalent_inches",
            "equivalent_inches_min",
            "equivalent_inches_max",
        ],
    )

    for interval in intervals:
        updates = {}

        if not frappe.utils.flt(interval.equivalent_inches_min):
            updates["equivalent_inches_min"] = round(frappe.utils.flt(interval.min_mm) / 25.4, 2)

        if not frappe.utils.flt(interval.equivalent_inches_max):
            fallback_max = frappe.utils.flt(interval.equivalent_inches) or round(
                frappe.utils.flt(interval.max_mm) / 25.4, 2
            )
            updates["equivalent_inches_max"] = fallback_max

        if updates:
            frappe.db.set_value("Dimension Range", interval.name, updates, update_modified=False)
