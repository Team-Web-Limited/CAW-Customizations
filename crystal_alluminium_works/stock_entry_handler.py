"""Material Issue rows entered in the desk Stock Entry form, category-first like the
procurement tables (see purchase_handler and public/js/stock_entry.js).

Sheet glass is issued as sheet size + sheets. Its SFT stock qty is derived here, and the row
is tagged "Sheets Consumed: [...]" — the tag api.get_glass_stock_ledger reads — so the
per-size sheet counts drop along with the SFT balance. A Material Issue without it moves SFT
only and the two drift apart, the same desync block_glass_stock_reconciliation prevents.

Only rows with custom_product_category set are touched. The form sets it when an item is
picked; the app's own deduction entries (Job Card releases, invoice edits, the Stock Adjustment
page) never do, and keep writing their own tags exactly as before.
"""

import json

import frappe
from frappe.utils import flt

from crystal_alluminium_works.purchase_handler import _force_stock_uom, _sheet_map

# Glass sold without a sheet-size ledger: Toughened is cut to order, Laminated is repacked from
# Ordinary sheets (see get_glass_stock_ledger's is_laminated). Issued by SFT as typed.
UNSHEETED_GLASS_TYPES = ("Toughened", "Laminated")


def recompute_material_issue_rows(doc, method=None):
    """before_validate hook for Stock Entry, so the controller's own validate derives
    transfer_qty, valuation and amounts from the qty set here."""
    if doc.stock_entry_type != "Material Issue":
        return

    sheet_map = None
    for row in doc.items:
        category = (row.get("custom_product_category") or "").strip()
        if not row.item_code or not category:
            continue
        if category == "Glass":
            if frappe.db.get_value("Item", row.item_code, "custom_glass_type") in UNSHEETED_GLASS_TYPES:
                continue
            if sheet_map is None:
                sheet_map = _sheet_map()
            _apply_glass_issue_row(row, sheet_map)
        elif category == "Ceiling":
            _apply_ceiling_issue_row(row)


def _apply_glass_issue_row(row, sheet_map):
    size = (row.get("custom_sheet_size") or "").strip()
    pcs = flt(row.get("custom_sheet_pcs") or 0)
    sft = flt(sheet_map.get(size)) if size else 0
    if sft <= 0:
        frappe.throw(f"Row {row.idx}: select the sheet size issued for glass item {row.item_code}.")
    if pcs <= 0:
        frappe.throw(f"Row {row.idx}: enter the number of sheets issued for glass item {row.item_code}.")

    _force_stock_uom(row)
    row.qty = flt(sft * pcs)
    # Replaces the item description: the ledger parses the tag up to the end of its line.
    row.description = f"Sheets Consumed: {json.dumps([{'size': size, 'pcs': pcs}])}"


def _apply_ceiling_issue_row(row):
    from crystal_alluminium_works.api import _get_ceiling_piece_area

    pcs = flt(row.get("custom_ceiling_pcs") or 0)
    if pcs <= 0:
        return  # issued by area as typed
    area_per_piece = flt(_get_ceiling_piece_area(row.item_code))
    if area_per_piece <= 0:
        frappe.throw(f"Row {row.idx}: no area per piece is configured for ceiling item {row.item_code}.")
    _force_stock_uom(row)
    row.qty = flt(area_per_piece * pcs)
