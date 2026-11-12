import frappe


def execute():
    """Rate per Sheet / Piece shows in the document's currency, like the standard Rate column,
    instead of the company currency."""
    frappe.db.set_value(
        "Custom Field",
        {"fieldname": "custom_rate_per_piece", "dt": ["in", ["Purchase Order Item", "Purchase Receipt Item", "Purchase Invoice Item"]]},
        "options",
        "currency",
    )
    frappe.clear_cache()
