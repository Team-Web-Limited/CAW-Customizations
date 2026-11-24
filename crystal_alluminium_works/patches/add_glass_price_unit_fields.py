"""Glass on Purchase Order / Receipt / Invoice can be priced Per Sheet, Per m² or Per sft
(custom_price_unit + custom_unit_price), with the per-sft Rate derived from it, and shows the
accepted quantity in m² (custom_qty_sqm) to tick against the supplier invoice.

Rows already priced through Rate per Sheet / Piece carry that over as Per Sheet, so nothing
changes for them. Rate is held to 7 decimals so a per-m² price lands on the supplier's amount.
"""

import frappe

from crystal_alluminium_works.create_custom_fields import add_custom_fields
from crystal_alluminium_works.purchase_handler import sheet_size_sqm


def execute():
    add_custom_fields()
    # Existing field: glass now prices through Price Unit + Price, ceiling keeps it.
    for child in ("Purchase Order Item", "Purchase Receipt Item", "Purchase Invoice Item"):
        name = frappe.db.get_value("Custom Field", {"dt": child, "fieldname": "custom_rate_per_piece"})
        if name:
            frappe.db.set_value("Custom Field", name, {
                "depends_on": "eval:doc.custom_product_category=='Ceiling'",
                "insert_after": "custom_unit_price",
            })
        price = frappe.db.get_value("Custom Field", {"dt": child, "fieldname": "custom_unit_price"})
        if price:
            frappe.db.set_value("Custom Field", price, "precision", "6")

    for child in ("Purchase Order Item", "Purchase Receipt Item", "Purchase Invoice Item"):
        rows = frappe.get_all(
            child,
            filters={"custom_product_category": "Glass", "custom_sheet_size": ["is", "set"]},
            fields=["name", "custom_sheet_size", "custom_sheet_pcs", "custom_rate_per_piece", "custom_unit_price"],
        )
        for row in rows:
            values = {"custom_qty_sqm": round(sheet_size_sqm(row.custom_sheet_size) * (row.custom_sheet_pcs or 0), 4)}
            if not row.custom_unit_price and (row.custom_rate_per_piece or 0) > 0:
                values.update({"custom_price_unit": "Per Sheet", "custom_unit_price": row.custom_rate_per_piece})
            frappe.db.set_value(child, row.name, values, update_modified=False)

    for doctype in (
        "Purchase Order", "Purchase Order Item",
        "Purchase Receipt", "Purchase Receipt Item",
        "Purchase Invoice", "Purchase Invoice Item",
    ):
        frappe.clear_cache(doctype=doctype)
