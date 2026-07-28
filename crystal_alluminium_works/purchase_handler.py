"""Procurement-side glass/ceiling logic shared by Material Request,
Purchase Order, Purchase Receipt and Purchase Invoice.

Glass is stocked in Square Foot and ceiling boards in Square Meter, but both are
ordered and received as a count of physical pieces (sheets / boards) that the
supplier prices per piece. The buyer enters size + pcs + rate per piece; this
module derives the stock quantity and the per-stock-UOM rate from those, so:

  * the stock ledger stays in the unit sales deduct in (SFT / sqm), and
  * the same numbers come out whether the document was raised from a Material
    Request, a Purchase Order, a Purchase Receipt, or the CAW Stock Entry page.

Because every one of those *Item doctypes carries the same custom fieldnames,
ERPNext's standard MR -> PO -> PR / PI mapping copies them through and this hook
simply re-derives (idempotently) at each step.

A Purchase Invoice with "Update Stock" ticked takes stock in on its own, so it
is a fourth entry point into this flow rather than only a billing document — see
_takes_stock_in for what that changes.
"""

import frappe
from frappe.utils import cint, flt

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


def _takes_stock_in(doc):
    """Whether this document is the point at which goods physically arrive, and
    so the one that owns received / rejected quantities.

    Always true for a Purchase Receipt. True for a Purchase Invoice only when
    "Update Stock" is ticked — that is the flag that makes an invoice take stock
    in without a receipt, and it is also the exact condition under which ERPNext
    enforces received = accepted + rejected (BuyingController.validate) and
    propagates the row's received_qty onto the linked Purchase Order
    (PurchaseInvoice.update_status_updater_args). On a plain billing invoice
    received_qty means nothing, and writing to it would corrupt the receipt
    tracking of whatever Purchase Order the invoice was raised against."""
    if doc.doctype == "Purchase Receipt":
        return True
    return doc.doctype == "Purchase Invoice" and cint(doc.get("update_stock"))


def _apply_rejected_pcs(row, area_per_piece):
    """Derive the stock-UOM rejected_qty from a count of rejected sheets/boards.

    Standard rejected_qty is in stock UOM, so rejecting one 1220x1830 sheet
    would mean typing 24 (SFT) on a row where every other quantity is entered as
    a piece count — an easy place to type 1 and silently under-reject. Entry
    stays piece-denominated here and the conversion happens once, in the same
    place qty is derived from custom_sheet_pcs."""
    if not row.meta.has_field("custom_rejected_pcs"):
        return
    rejected_pcs = flt(row.get("custom_rejected_pcs") or 0)
    if rejected_pcs <= 0:
        return
    row.rejected_qty = flt(area_per_piece * rejected_pcs)


def _sync_received_qty(row, takes_stock_in):
    """`qty` is the accepted quantity and ERPNext requires
    received = accepted + rejected. Without this, receiving fewer sheets than a
    Purchase Order ordered fails validation, because the mapper copies the
    ordered quantity into received_qty.

    Material Request Item and Purchase Order Item have a received_qty too, but
    there it tracks how much of the request/order has already been fulfilled —
    writing to it would make the document look complete and drop it out of the
    downstream mapping."""
    if not takes_stock_in or not row.meta.has_field("received_qty"):
        return
    row.received_qty = flt(row.qty) + flt(row.get("rejected_qty") or 0)


def _sync_stock_qty(row):
    """BuyingController.set_qty_as_per_stock_uom derives stock_qty (and, where
    the doctype has it, received_stock_qty) from the incoming qty during the
    controller's own validate, which runs before this hook — so rewriting qty
    here leaves both holding the pre-derivation numbers.

    The stock ledger itself is safe either way (update_stock_ledger recomputes
    qty * conversion_factor at submit), but stock_qty is what the Material
    Request per_received status updater reads, and what the stock reports show.
    Conversion factor is forced to 1 for piece-driven rows, so stock quantities
    track qty exactly."""
    if row.meta.has_field("stock_qty"):
        row.stock_qty = flt(row.qty)
    if row.meta.has_field("received_stock_qty"):
        row.received_stock_qty = flt(row.get("received_qty") or 0)


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


def _apply_glass_row(row, sheet_map, takes_stock_in):
    sheet_size = (row.get("custom_sheet_size") or "").strip()
    pcs = flt(row.get("custom_sheet_pcs") or 0)
    if not sheet_size and pcs <= 0:
        # Glass bought by area rather than by sheet — leave qty as typed.
        return False

    sft = sheet_map.get(sheet_size, flt(row.get("custom_sheet_sft") or 0))
    if not sheet_size or sft <= 0:
        frappe.throw(f"Row {row.idx}: select a sheet size for glass item {row.item_code}.")
    if pcs <= 0:
        frappe.throw(f"Row {row.idx}: enter the number of sheets for glass item {row.item_code}.")

    _force_stock_uom(row)
    row.custom_glass_sale_mode = "Sheet"
    row.custom_sheet_sft = sft
    row.qty = flt(sft * pcs)
    if takes_stock_in:
        _apply_rejected_pcs(row, sft)
    _sync_received_qty(row, takes_stock_in)
    _sync_stock_qty(row)
    _apply_piece_rate(row, pcs, row.qty)
    return True


def _apply_ceiling_row(row, takes_stock_in):
    from crystal_alluminium_works.api import _get_ceiling_piece_area

    pcs = flt(row.get("custom_ceiling_pcs") or 0)
    if pcs <= 0:
        # Ceiling bought by area rather than by board — leave qty as typed.
        return False

    area_per_piece = flt(_get_ceiling_piece_area(row.item_code))
    if area_per_piece <= 0:
        frappe.throw(
            f"Row {row.idx}: no area per piece is configured for ceiling item {row.item_code}."
        )

    _force_stock_uom(row)
    row.qty = flt(area_per_piece * pcs)
    if takes_stock_in:
        _apply_rejected_pcs(row, area_per_piece)
    _sync_received_qty(row, takes_stock_in)
    _sync_stock_qty(row)
    _apply_piece_rate(row, pcs, row.qty)
    return True


def recompute_sheet_quantities(doc, method=None):
    """validate hook for Material Request / Purchase Order / Purchase Receipt /
    Purchase Invoice."""
    sheet_map = None
    recomputed = False
    takes_stock_in = _takes_stock_in(doc)

    for row in doc.items:
        if not row.item_code:
            continue

        category = _resolve_category(row)
        if row.meta.has_field("custom_product_category"):
            row.custom_product_category = category or None

        if category == "Glass":
            if sheet_map is None:
                sheet_map = _sheet_map()
            recomputed |= _apply_glass_row(row, sheet_map, takes_stock_in)
        elif category == "Ceiling":
            recomputed |= _apply_ceiling_row(row, takes_stock_in)

    # doc_events hooks run *after* the controller's own validate (see
    # Document.hook's compose), so the totals were already calculated from
    # whatever qty/rate came in. Having just rewritten both, recalculate or each
    # row's amount and the document totals keep the pre-derivation numbers —
    # invisible in the desk form, where the client script derives the same
    # values before saving, but wrong for a document built by the API, a data
    # import, or any other non-desk caller.
    #
    # Material Request is skipped: it has no currency and carries no monetary
    # totals (there is no pricing at the request stage, which is also why
    # custom_rate_per_piece is not added to Material Request Item), and
    # calculate_taxes_and_totals would fail on the missing currency field.
    if recomputed and doc.meta.has_field("currency"):
        doc.calculate_taxes_and_totals()
