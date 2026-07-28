"""Procurement-side glass/ceiling logic shared by Material Request,
Purchase Order and Purchase Receipt.

Glass is stocked in Square Foot and ceiling boards in Square Meter, but both are
ordered and received as a count of physical pieces (sheets / boards) that the
supplier prices per piece. The buyer enters size + pcs + rate per piece; this
module derives the stock quantity and the per-stock-UOM rate from those, so:

  * the stock ledger stays in the unit sales deduct in (SFT / sqm), and
  * the same numbers come out whether the document was raised from a Material
    Request, a Purchase Order, a Purchase Receipt, or the CAW Stock Entry page.

Because Material Request Item, Purchase Order Item and Purchase Receipt Item all
carry the same custom fieldnames, ERPNext's standard MR -> PO -> PR mapping
copies them through and this hook simply re-derives (idempotently) at each step.
"""

import frappe
from frappe.utils import flt

PRODUCT_CATEGORIES = ("Aluminium", "Glass", "Fittings", "Ceiling", "Rubber", "Silicone")


def _sheet_map():
    """size -> sft, from the shared Glass Sheet Config."""
    from crystal_alluminium_works.api import get_glass_sheet_configs

    return {
        str(cfg.get("size") or "").strip(): flt(cfg.get("sft") or 0)
        for cfg in get_glass_sheet_configs()
    }


def _resolve_category(row):
    """Category drives which entry mode a row uses. Fall back to the item's
    group so rows added through the plain desk grid (which doesn't set the
    field) still behave like their CAW counterparts."""
    category = (row.get("custom_product_category") or "").strip()
    if not category and row.item_code:
        category = frappe.db.get_value("Item", row.item_code, "item_group") or ""
    return category if category in PRODUCT_CATEGORIES else ""


def _force_stock_uom(row):
    """Piece-driven quantities are computed in the item's stock UOM, so the row
    must not also carry a UOM conversion or the stock qty would be scaled twice."""
    stock_uom = frappe.db.get_value("Item", row.item_code, "stock_uom")
    if not stock_uom:
        return
    if row.get("uom") != stock_uom:
        row.uom = stock_uom
    if row.meta.has_field("conversion_factor"):
        row.conversion_factor = 1


def _sync_received_qty(row):
    """Purchase Receipt only: `qty` is the accepted quantity and ERPNext requires
    received = accepted + rejected. Without this, receiving fewer sheets than a
    Purchase Order ordered fails validation, because the mapper copies the
    ordered quantity into received_qty.

    Material Request Item has a received_qty too, but there it tracks how much of
    the request has already been fulfilled — writing to it would make the request
    look complete and drop it out of the "make Purchase Order" mapping."""
    if row.doctype != "Purchase Receipt Item":
        return
    row.received_qty = flt(row.qty) + flt(row.get("rejected_qty") or 0)


def _apply_piece_rate(row, pcs, qty):
    """Suppliers quote per sheet/piece; ERPNext values stock per stock UOM.
    Back-calculate rate so qty * rate still equals the amount actually agreed."""
    rate_per_piece = flt(row.get("custom_rate_per_piece") or 0)
    if rate_per_piece <= 0 or qty <= 0:
        return
    row.rate = flt(pcs * rate_per_piece) / qty
    # Otherwise ERPNext re-derives the rate from the price list and shows the
    # difference as a margin/discount on the row. (Material Request Item has no
    # margin/discount fields, hence the per-field guard.)
    for fieldname in ("price_list_rate", "margin_rate_or_amount", "discount_percentage", "discount_amount"):
        if row.meta.has_field(fieldname):
            row.set(fieldname, 0)


def _apply_glass_row(row, sheet_map):
    sheet_size = (row.get("custom_sheet_size") or "").strip()
    pcs = flt(row.get("custom_sheet_pcs") or 0)
    if not sheet_size and pcs <= 0:
        # Glass bought by area rather than by sheet — leave qty as typed.
        return

    sft = sheet_map.get(sheet_size, flt(row.get("custom_sheet_sft") or 0))
    if not sheet_size or sft <= 0:
        frappe.throw(f"Row {row.idx}: select a sheet size for glass item {row.item_code}.")
    if pcs <= 0:
        frappe.throw(f"Row {row.idx}: enter the number of sheets for glass item {row.item_code}.")

    _force_stock_uom(row)
    row.custom_glass_sale_mode = "Sheet"
    row.custom_sheet_sft = sft
    row.qty = flt(sft * pcs)
    _sync_received_qty(row)
    _apply_piece_rate(row, pcs, row.qty)


def _apply_ceiling_row(row):
    from crystal_alluminium_works.api import _get_ceiling_piece_area

    pcs = flt(row.get("custom_ceiling_pcs") or 0)
    if pcs <= 0:
        # Ceiling bought by area rather than by board — leave qty as typed.
        return

    area_per_piece = flt(_get_ceiling_piece_area(row.item_code))
    if area_per_piece <= 0:
        frappe.throw(
            f"Row {row.idx}: no area per piece is configured for ceiling item {row.item_code}."
        )

    _force_stock_uom(row)
    row.qty = flt(area_per_piece * pcs)
    _sync_received_qty(row)
    _apply_piece_rate(row, pcs, row.qty)


def recompute_sheet_quantities(doc, method=None):
    """validate hook for Material Request / Purchase Order / Purchase Receipt."""
    sheet_map = None

    for row in doc.items:
        if not row.item_code:
            continue

        category = _resolve_category(row)
        if row.meta.has_field("custom_product_category"):
            row.custom_product_category = category or None

        if category == "Glass":
            if sheet_map is None:
                sheet_map = _sheet_map()
            _apply_glass_row(row, sheet_map)
        elif category == "Ceiling":
            _apply_ceiling_row(row)
