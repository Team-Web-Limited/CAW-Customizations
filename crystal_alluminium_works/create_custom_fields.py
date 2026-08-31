import json

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

PRODUCT_CATEGORY_OPTIONS = "\nAluminium\nGlass\nFittings\nCeiling\nRubber\nSilicone"
GLASS_SALE_MODE_OPTIONS = "Resized\nFull Sheet\nSheet"
ITEM_GLASS_TYPE_OPTIONS = "Ordinary\nLaminated\nReady Laminated\nToughened"
GLASS_POLISH_TYPE_OPTIONS = "\n4-6\n8-10\n14-35"
GLASS_HOLE_TYPE_OPTIONS = "\n5mm\n6mm\n8mm\n10mm\n15mm\n20mm"
GLASS_NOTCH_TYPE_OPTIONS = "\nStandard\nSmall\nMirror Screws\nTimber Box"
CUSTOMER_BILLING_TYPE_OPTIONS = "Invoice Customer\nCash Customer"


def _get_crystal_item_fields(read_only=False):
    """
    Returns the list of Crystal-specific custom field definitions
    for any transaction item child table (Quotation Item, Sales Order Item, etc.).

    When read_only=True every data-entry field is forced read-only
    (used for Sales Order / Sales Invoice where items are frozen).
    """
    ro = 1 if read_only else 0

    return [
        {
            "fieldname": "custom_price_list",
            "label": "Price List",
            "fieldtype": "Select",
            "options": "\nRetail\nWholesale",
            "insert_after": "item_code",
            "read_only": ro,
        },
        {
            "fieldname": "custom_product_category",
            "label": "Product Category",
            "fieldtype": "Select",
            "options": PRODUCT_CATEGORY_OPTIONS,
            "insert_after": "custom_price_list",
            "read_only": ro,
        },
        {
            "fieldname": "custom_aluminium_metres",
            "label": "Metres",
            "fieldtype": "Float",
            "insert_after": "custom_product_category",
            "depends_on": "eval:doc.custom_product_category=='Aluminium'",
            "read_only": ro,
        },
        {
            "fieldname": "custom_aluminium_color",
            "label": "Color",
            "fieldtype": "Link",
            "options": "Aluminium Color",
            "insert_after": "custom_aluminium_metres",
            "depends_on": "eval:doc.custom_product_category=='Aluminium'",
            "read_only": ro,
        },
        {
            "fieldname": "custom_ceiling_sq_m",
            "label": "Square Metres",
            "fieldtype": "Float",
            "insert_after": "custom_aluminium_color",
            "depends_on": "eval:doc.custom_product_category=='Ceiling'",
            "read_only": ro,
        },
        {
            "fieldname": "custom_glass_sale_mode",
            "label": "Glass Sale Mode",
            "fieldtype": "Select",
            "options": GLASS_SALE_MODE_OPTIONS,
            "default": "Resized",
            "insert_after": "custom_ceiling_sq_m",
            "depends_on": "eval:doc.custom_product_category=='Glass'",
            "read_only": ro,
        },
        {
            "fieldname": "custom_glass_dimensions",
            "label": "Glass Dimensions",
            "fieldtype": "Section Break",
            "insert_after": "custom_glass_sale_mode",
            "depends_on": "eval:doc.custom_product_category=='Glass' && doc.custom_glass_sale_mode=='Resized'",
        },
        {
            "fieldname": "custom_width_mm",
            "label": "Width (mm)",
            "fieldtype": "Float",
            "insert_after": "custom_glass_dimensions",
            "depends_on": "eval:doc.custom_product_category=='Glass' && doc.custom_glass_sale_mode=='Resized'",
            "read_only": ro,
        },
        {
            "fieldname": "custom_height_mm",
            "label": "Height (mm)",
            "fieldtype": "Float",
            "insert_after": "custom_width_mm",
            "depends_on": "eval:doc.custom_product_category=='Glass' && doc.custom_glass_sale_mode=='Resized'",
            "read_only": ro,
        },
        {
            "fieldname": "custom_col_break_1",
            "fieldtype": "Column Break",
            "insert_after": "custom_height_mm",
            "depends_on": "eval:doc.custom_product_category=='Glass'",
        },
        {
            "fieldname": "custom_base_width_ft",
            "label": "Base Width (ft)",
            "fieldtype": "Float",
            "read_only": 1,
            "insert_after": "custom_col_break_1",
            "depends_on": "eval:doc.custom_product_category=='Glass' && doc.custom_glass_sale_mode=='Resized'",
        },
        {
            "fieldname": "custom_base_height_ft",
            "label": "Base Height (ft)",
            "fieldtype": "Float",
            "read_only": 1,
            "insert_after": "custom_base_width_ft",
            "depends_on": "eval:doc.custom_product_category=='Glass' && doc.custom_glass_sale_mode=='Resized'",
        },
        {
            "fieldname": "custom_width_ft",
            "label": "Width + W (ft)",
            "fieldtype": "Float",
            "read_only": 1,
            "insert_after": "custom_base_height_ft",
            "depends_on": "eval:doc.custom_product_category=='Glass' && doc.custom_glass_sale_mode=='Resized'",
        },
        {
            "fieldname": "custom_height_ft",
            "label": "Height + H (ft)",
            "fieldtype": "Float",
            "read_only": 1,
            "insert_after": "custom_width_ft",
            "depends_on": "eval:doc.custom_product_category=='Glass' && doc.custom_glass_sale_mode=='Resized'",
        },
        {
            "fieldname": "custom_width_allowance",
            "label": "Width Allowance",
            "fieldtype": "Float",
            "insert_after": "custom_height_ft",
            "depends_on": "eval:doc.custom_product_category=='Glass' && doc.custom_glass_sale_mode=='Resized'",
            "read_only": ro,
        },
        {
            "fieldname": "custom_height_allowance",
            "label": "Height Allowance",
            "fieldtype": "Float",
            "insert_after": "custom_width_allowance",
            "depends_on": "eval:doc.custom_product_category=='Glass' && doc.custom_glass_sale_mode=='Resized'",
            "read_only": ro,
        },
        {
            "fieldname": "custom_area_sqft",
            "label": "Area (sqft)",
            "fieldtype": "Float",
            "read_only": 1,
            "insert_after": "custom_height_allowance",
            "depends_on": "eval:doc.custom_product_category=='Glass' && doc.custom_glass_sale_mode=='Resized'",
        },
        {
            "fieldname": "custom_perimeter_rft",
            "label": "Perimeter (rft)",
            "fieldtype": "Float",
            "read_only": 1,
            "insert_after": "custom_area_sqft",
            "depends_on": "eval:doc.custom_product_category=='Glass' && doc.custom_glass_sale_mode=='Resized'",
        },
        {
            "fieldname": "custom_processing_options",
            "label": "Processing Options",
            "fieldtype": "Section Break",
            "insert_after": "custom_perimeter_rft",
            "depends_on": "eval:doc.custom_product_category=='Glass' && doc.custom_glass_sale_mode=='Resized'",
        },
        {
            "fieldname": "custom_polishing",
            "label": "Polishing",
            "fieldtype": "Check",
            "insert_after": "custom_processing_options",
            "depends_on": "eval:doc.custom_product_category=='Glass' && doc.custom_glass_sale_mode=='Resized'",
            "read_only": ro,
        },
        {
            "fieldname": "custom_holes",
            "label": "Number of Holes",
            "fieldtype": "Int",
            "insert_after": "custom_polishing",
            "depends_on": "eval:doc.custom_product_category=='Glass' && doc.custom_glass_sale_mode=='Resized'",
            "read_only": ro,
        },
        {
            "fieldname": "custom_hole_type",
            "label": "Hole Type",
            "fieldtype": "Select",
            "options": GLASS_HOLE_TYPE_OPTIONS,
            "default": "5mm",
            "insert_after": "custom_holes",
            "depends_on": "eval:doc.custom_product_category=='Glass' && doc.custom_glass_sale_mode=='Resized'",
            "read_only": ro,
        },
        {
            "fieldname": "custom_notches",
            "label": "Number of Notches",
            "fieldtype": "Int",
            "insert_after": "custom_hole_type",
            "depends_on": "eval:doc.custom_product_category=='Glass' && doc.custom_glass_sale_mode=='Resized'",
            "read_only": ro,
        },
        {
            "fieldname": "custom_notch_type",
            "label": "Notch Type",
            "fieldtype": "Select",
            "options": GLASS_NOTCH_TYPE_OPTIONS,
            "default": "Standard",
            "insert_after": "custom_notches",
            "depends_on": "eval:doc.custom_product_category=='Glass' && doc.custom_glass_sale_mode=='Resized'",
            "read_only": ro,
        },
        {
            "fieldname": "custom_polish_width_sides",
            "label": "Polish Width Sides",
            "fieldtype": "Int",
            "insert_after": "custom_notch_type",
            "depends_on": "eval:doc.custom_product_category=='Glass' && doc.custom_glass_sale_mode=='Resized'",
            "read_only": ro,
        },
        {
            "fieldname": "custom_polish_height_sides",
            "label": "Polish Height Sides",
            "fieldtype": "Int",
            "insert_after": "custom_polish_width_sides",
            "depends_on": "eval:doc.custom_product_category=='Glass' && doc.custom_glass_sale_mode=='Resized'",
            "read_only": ro,
        },
        {
            "fieldname": "custom_polish_type",
            "label": "Polish Type",
            "fieldtype": "Select",
            "options": GLASS_POLISH_TYPE_OPTIONS,
            "default": "4-6",
            "insert_after": "custom_polish_height_sides",
            "depends_on": "eval:doc.custom_product_category=='Glass' && doc.custom_glass_sale_mode=='Resized'",
            "read_only": ro,
        },
        {
            "fieldname": "custom_col_break_2",
            "fieldtype": "Column Break",
            "insert_after": "custom_polish_type",
            "depends_on": "eval:doc.custom_product_category=='Glass' && doc.custom_glass_sale_mode=='Resized'",
        },
        {
            "fieldname": "custom_sandblast_type",
            "label": "Sandblast Type",
            "fieldtype": "Select",
            "options": "\nHalf\nFull",
            "insert_after": "custom_col_break_2",
            "depends_on": "eval:doc.custom_product_category=='Glass' && doc.custom_glass_sale_mode=='Resized'",
            "read_only": ro,
        },
        {
            "fieldname": "custom_numbering",
            "label": "Numbering",
            "fieldtype": "Data",
            "insert_after": "custom_sandblast_type",
            "depends_on": "eval:doc.custom_product_category=='Glass' && doc.custom_glass_sale_mode=='Resized'",
            "read_only": ro,
        },
        {
            "fieldname": "custom_sheet_size",
            "label": "Sheet Size",
            "fieldtype": "Data",
            "insert_after": "custom_numbering",
            "depends_on": "eval:doc.custom_product_category=='Glass' && doc.custom_glass_sale_mode=='Sheet'",
            "read_only": ro,
        },
        {
            "fieldname": "custom_sheet_sft",
            "label": "SFT / Sheet",
            "fieldtype": "Float",
            "insert_after": "custom_sheet_size",
            "depends_on": "eval:doc.custom_product_category=='Glass' && doc.custom_glass_sale_mode=='Sheet'",
            "read_only": ro,
        },
        {
            "fieldname": "custom_sheet_pcs",
            "label": "Sheet Pcs",
            "fieldtype": "Float",
            "insert_after": "custom_sheet_sft",
            "depends_on": "eval:doc.custom_product_category=='Glass' && doc.custom_glass_sale_mode=='Sheet'",
            "read_only": ro,
        },
        {
            "fieldname": "custom_auto_generated",
            "label": "Auto Generated Row",
            "fieldtype": "Check",
            "hidden": 1,
            "insert_after": "custom_sheet_pcs",
        },
        {
            "fieldname": "custom_parent_row_idx",
            "label": "Parent Row Idx",
            "fieldtype": "Int",
            "hidden": 1,
            "insert_after": "custom_auto_generated",
        },
    ]


def _get_procurement_item_fields(include_rate=True, include_rejected=False):
    """Sheet/piece based stock-in fields, shared by Material Request Item,
    Purchase Order Item, Purchase Receipt Item and Purchase Invoice Item.

    Glass is stocked in Square Foot and ceiling boards in Square Meter, but both
    are ordered and received as a count of physical pieces (sheets / boards) and
    priced per piece by the supplier. These fields hold what the buyer actually
    enters (size + pcs + rate per piece); qty and rate are derived from them in
    crystal_alluminium_works.purchase_handler so the stock ledger stays in the
    same unit sales deduct in.

    custom_product_category has no insert_after: that puts it at position 0,
    ahead of the standard item_code field. Property setters (see
    reorder_procurement_standard_fields below) then splice item_code and
    item_name in right after it, so the visible order is: category, item code,
    item name, sheet size, sheets/pcs — the buyer picks a category first and
    the item_code lookup can then be filtered to that category (see
    public/js/procurement_sheet_items.js) instead of listing every item.

    custom_glass_sale_mode and custom_sheet_sft are derived, not entered —
    Sale Mode is always "Sheet" here and SFT/sheet comes from the Glass Sheet
    Config lookup for whatever size was picked — so both are hidden rather
    than shown as extra steps in that visible order.

    The same fieldnames are used on every one of those doctypes so ERPNext's
    standard Material Request -> Purchase Order -> Purchase Receipt / Purchase
    Invoice mapping carries them through without any custom mapper. Material
    Request has no pricing at the request stage, so include_rate=False drops
    custom_rate_per_piece there.

    include_rejected adds custom_rejected_pcs, the piece-denominated counterpart
    of the standard rejected_qty. Only Purchase Receipt Item and Purchase Invoice
    Item have rejected_qty at all — nothing can be rejected before it is
    physically received — so the request and order stages leave it off.
    """
    fields = [
        {
            "fieldname": "custom_product_category",
            "label": "Product Category",
            "fieldtype": "Select",
            "options": PRODUCT_CATEGORY_OPTIONS,
            "insert_after": "",
            "read_only": 0,
            "module": "Crystal Alluminium Works",
        },
        {
            "fieldname": "custom_sheet_size",
            "label": "Sheet Size",
            "fieldtype": "Select",
            "options": "",  # filled at runtime from Glass Sheet Config
            "insert_after": "item_name",
            "depends_on": "eval:doc.custom_product_category=='Glass'",
            "read_only": 0,
            "module": "Crystal Alluminium Works",
        },
        {
            "fieldname": "custom_sheet_pcs",
            "label": "Sheets / Pcs",
            "fieldtype": "Float",
            "insert_after": "custom_sheet_size",
            "depends_on": "eval:doc.custom_product_category=='Glass'",
            "read_only": 0,
            "module": "Crystal Alluminium Works",
        },
        {
            # Ceiling boards (AGC/AMC) are ordered per piece, same as glass
            # sheets, but each item has a fixed area/piece (Ceiling
            # Configuration.ratio_4) instead of a selectable sheet size.
            # qty (the Square Meter stock quantity) = ratio_4 * custom_ceiling_pcs.
            "fieldname": "custom_ceiling_pcs",
            "label": "Pieces",
            "fieldtype": "Float",
            "insert_after": "custom_sheet_pcs",
            "depends_on": "eval:doc.custom_product_category=='Ceiling'",
            "read_only": 0,
            "module": "Crystal Alluminium Works",
        },
    ]

    last_fieldname = "custom_ceiling_pcs"
    if include_rejected:
        fields.append({
            # Piece-denominated counterpart of the standard rejected_qty, which
            # is in stock UOM: rejecting one 1220x1830 sheet means typing 24
            # (SFT) there, while every other quantity on the row is entered as a
            # count of sheets/boards. The handler derives rejected_qty from this
            # the same way qty is derived from custom_sheet_pcs, so the whole row
            # stays piece-denominated. Sheets/Pcs remains the *accepted* count,
            # matching ERPNext's received = accepted + rejected model.
            "fieldname": "custom_rejected_pcs",
            "label": "Rejected Sheets / Pcs",
            "fieldtype": "Float",
            "insert_after": last_fieldname,
            "depends_on": "eval:doc.custom_product_category=='Glass' || doc.custom_product_category=='Ceiling'",
            "read_only": 0,
            "module": "Crystal Alluminium Works",
        })
        last_fieldname = "custom_rejected_pcs"

    fields.append({
        "fieldname": "custom_glass_sale_mode",
        "label": "Glass Sale Mode",
        "fieldtype": "Select",
        "options": GLASS_SALE_MODE_OPTIONS,
        "insert_after": last_fieldname,
        "hidden": 1,
        "read_only": 1,
        "module": "Crystal Alluminium Works",
    })
    fields.append({
        "fieldname": "custom_sheet_sft",
        "label": "SFT per Sheet",
        "fieldtype": "Float",
        "insert_after": "custom_glass_sale_mode",
        "hidden": 1,
        "read_only": 1,
        "module": "Crystal Alluminium Works",
    })

    last_fieldname = "custom_sheet_sft"
    if include_rate:
        fields.append({
            # Suppliers quote glass and ceiling per physical piece, not per
            # SFT/sqm. The row's standard `rate` (which ERPNext values stock at,
            # per stock UOM) is back-calculated from this as
            # (pcs * rate_per_piece) / qty so qty * rate == amount stays true.
            "fieldname": "custom_rate_per_piece",
            "label": "Rate per Sheet / Piece",
            "fieldtype": "Currency",
            "insert_after": last_fieldname,
            "depends_on": "eval:doc.custom_product_category=='Glass' || doc.custom_product_category=='Ceiling'",
            "read_only": 0,
            "module": "Crystal Alluminium Works",
        })
        last_fieldname = "custom_rate_per_piece"

    fields.append({
        # Per-item remark (originally entered in the Stock Entry page's Add
        # Item modal; now also enterable from MR/PO and carried downstream).
        "fieldname": "custom_remarks",
        "label": "Remarks",
        "fieldtype": "Small Text",
        "insert_after": last_fieldname,
        "read_only": 0,
        "module": "Crystal Alluminium Works",
    })

    return fields


def _set_property(doctype, fieldname, prop, value, property_type):
    """frappe.make_property_setter() deletes any existing Property Setter for
    the same (doctype, fieldname, property) before inserting — safe to call on
    every add_custom_fields() run without piling up stale records."""
    frappe.make_property_setter(
        {
            "doctype": doctype,
            "fieldname": fieldname,
            "property": prop,
            "value": value,
            "property_type": property_type,
        }
    )


def reorder_procurement_standard_fields():
    """Splice the standard item_code / item_name fields in right after
    custom_product_category, and force item_name read-only.

    A per-field "insert_after" property setter is silently ignored for a
    *standard* field: Frappe's field-order algorithm only consults insert_after
    for custom fields, standard fields keep whatever slot the doctype's base
    field_order already gives them (see frappe.model.meta.Meta.sort_fields).
    So on Purchase Order / Purchase Receipt / Purchase Invoice — where item_code
    and item_name aren't adjacent in the base layout (barcode scan / supplier
    part fields sit between them) — moving them takes a full field_order
    override: read
    the doctype's current effective order, pull item_code/item_name out, and
    reinsert both right after custom_product_category. Every other field's
    relative order is left untouched.
    """
    for doctype in (
        "Material Request Item",
        "Purchase Order Item",
        "Purchase Receipt Item",
        "Purchase Invoice Item",
    ):
        _set_property(doctype, "item_name", "read_only", 1, "Check")

        order = [f.fieldname for f in frappe.get_meta(doctype, cached=False).fields]
        for fieldname in ("item_code", "item_name"):
            if fieldname in order:
                order.remove(fieldname)
        cat_idx = order.index("custom_product_category")
        order[cat_idx + 1 : cat_idx + 1] = ["item_code", "item_name"]

        frappe.make_property_setter(
            {
                "doctype": doctype,
                "doctype_or_field": "DocType",
                "fieldname": None,
                "property": "field_order",
                "value": json.dumps(order),
                "property_type": "Text",
            }
        )
        frappe.clear_cache(doctype=doctype)


def add_custom_fields():
    custom_fields = {
        "Customer": [
            {
                "fieldname": "custom_customer_billing_type",
                "label": "Customer Billing Type",
                "fieldtype": "Select",
                "options": CUSTOMER_BILLING_TYPE_OPTIONS,
                "default": "Cash Customer",
                "insert_after": "customer_type",
                "reqd": 1,
                "in_standard_filter": 1,
                "module": "Crystal Alluminium Works",
            }
        ],
        # Quotation Item — editable fields
        "Quotation Item": _get_crystal_item_fields(read_only=False) + [
            {
                # Cumulative quantity already released across partial invoices,
                # expressed in the row's native driving unit (pieces for glass,
                # metres for aluminium, sq m for ceiling). Remaining to release =
                # full driving qty - custom_collected_qty.
                "fieldname": "custom_collected_qty",
                "label": "Collected Qty",
                "fieldtype": "Float",
                "insert_after": "custom_parent_row_idx",
                "read_only": 1,
                "no_copy": 1,
                "hidden": 1,
            },
            {
                # Frozen full component breakdown for a ceiling bundle row, e.g.
                # {"Board":277,"MainT":25,"Sub Cross 4ft":133,"Sub Cross 2ft":133,"Wall angle":25}.
                # Written once on the first partial-invoice release for the row and used as
                # the canonical reference for remaining-piece calculations across visits.
                "fieldname": "custom_ceiling_snapshot_json",
                "label": "Ceiling Snapshot JSON",
                "fieldtype": "Small Text",
                "insert_after": "custom_collected_qty",
                "read_only": 1,
                "no_copy": 1,
                "hidden": 1,
            },
            {
                # Cumulative quantity released to a CASH customer WITHOUT invoicing,
                # in the row's native driving unit (pieces/metres/sq m). Kept separate
                # from custom_collected_qty (which means "released AND invoiced" on the
                # invoice-customer partial flow) so the final full invoice for a cash
                # customer still bills every item. Remaining = native full - custom_released_qty.
                "fieldname": "custom_released_qty",
                "label": "Released Qty (Uninvoiced)",
                "fieldtype": "Float",
                "insert_after": "custom_ceiling_snapshot_json",
                "read_only": 1,
                "no_copy": 1,
                "hidden": 1,
            }
        ],
        # Sales Order Item — frozen (read-only) copy of the quotation data
        "Sales Order Item": _get_crystal_item_fields(read_only=True),
        # Sales Invoice Item — frozen (read-only) copy for accounting records
        "Sales Invoice Item": _get_crystal_item_fields(read_only=True) + [
            {
                # JSON map {item_code: pcs} of user-specified released pcs per ceiling
                # component (Board/MainT/Sub Cross 4ft/Sub Cross 2ft/Wall angle), set only
                # when a partial invoice's release is created with manual overrides.
                # Falls back to the ratio formula in calculate_ceiling_pricing when absent.
                "fieldname": "custom_ceiling_component_pcs",
                "label": "Ceiling Component Pcs Override",
                "fieldtype": "Small Text",
                "insert_after": "custom_parent_row_idx",
                "hidden": 1,
                "no_copy": 1,
                "read_only": 1,
            },
            {
                # VAT-exclusive amount this invoice bills for a ceiling bundle row
                # (= cash paid toward the ceiling this visit / 1.16). When set, it
                # overrides the sqm×rate amount in calculate_ceiling_pricing so the
                # ceiling row reflects money paid, decoupled from pieces released.
                "fieldname": "custom_ceiling_paid_amount",
                "label": "Ceiling Paid Amount",
                "fieldtype": "Currency",
                "insert_after": "custom_ceiling_component_pcs",
                "hidden": 1,
                "no_copy": 1,
                "read_only": 1,
            }
        ],
        "Sales Invoice": [
            {
                "fieldname": "custom_source_quotation",
                "label": "Source Quotation",
                "fieldtype": "Link",
                "options": "Quotation",
                "insert_after": "customer_name",
                "read_only": 1,
                "no_copy": 1,
                "hidden": 1,
            },
            {
                "fieldname": "custom_source_job_card",
                "label": "Source Job Card",
                "fieldtype": "Link",
                "options": "CAW Job Card",
                "insert_after": "custom_source_quotation",
                "read_only": 1,
                "no_copy": 1,
                "hidden": 1,
            },
            {
                "fieldname": "custom_is_partial",
                "label": "Partial Invoice",
                "fieldtype": "Check",
                "insert_after": "custom_source_job_card",
                "read_only": 1,
                "no_copy": 1,
                "hidden": 1,
            }
        ],
        # Marks a Purchase Receipt as created through the CAW Stock Entry page,
        # so that page's "Recent Stock Entries" panel can find its own receipts
        # without picking up unrelated/manually created Purchase Receipts.
        "Purchase Receipt": [
            {
                "fieldname": "custom_via_caw_stock_entry",
                "label": "Created via CAW Stock Entry",
                "fieldtype": "Check",
                "insert_after": "remarks",
                "hidden": 1,
                "no_copy": 1,
                "module": "Crystal Alluminium Works",
            },
        ],
        # Links a deduction/repack Stock Entry to the Sales Invoice that released it,
        # so the Stock Ledger's "Date / Invoice" column can show the exact invoice per
        # movement instead of guessing the newest invoice on the job card. Populated at
        # creation for invoice-time deductions; for glass deducted early at JC Operations
        # it holds the first releasing invoice (the ledger lists all of them at read time).
        "Stock Entry": [
            {
                "fieldname": "custom_sales_invoice",
                "label": "Sales Invoice (CAW)",
                "fieldtype": "Link",
                "options": "Sales Invoice",
                "insert_after": "remarks",
                "read_only": 1,
                "no_copy": 1,
                "module": "Crystal Alluminium Works",
            },
        ],
        # Procurement item tables — stock-in fields mirroring the sales-side glass
        # sheet model. For sheet-mode glass the buyer/receiver enters sheet size +
        # pcs and qty (the SFT stock quantity) is computed as sheet_sft * sheet_pcs
        # so the stock ledger stays in Square Foot, consistent with how sales
        # deduct. Identical on all three so the standard MR -> PO -> PR mapping
        # carries the values through untouched.
        "Material Request Item": _get_procurement_item_fields(include_rate=False),
        "Purchase Order Item": _get_procurement_item_fields(),
        # Receipt and invoice are the two points where goods physically arrive,
        # so they are also the only two that can reject any of them. A Purchase
        # Invoice with "Update Stock" ticked takes stock in on its own, without
        # a receipt, which is why it carries the same entry fields.
        "Purchase Receipt Item": _get_procurement_item_fields(include_rejected=True),
        "Purchase Invoice Item": _get_procurement_item_fields(include_rejected=True),
        "Quotation": [
            {
                # Quotation Builder's global +/- % adjustment over each row's Inc.Rate.
                # Stored so re-opening the quotation via "Edit in Builder" restores the
                # same mode (discount/markup) and percentage instead of losing it.
                "fieldname": "custom_price_adjustment_type",
                "label": "Builder Price Adjustment Type",
                "fieldtype": "Select",
                "options": "\n-\n+",
                "insert_after": "selling_price_list",
                "hidden": 1,
                "no_copy": 1,
                "module": "Crystal Alluminium Works",
            },
            {
                "fieldname": "custom_price_adjustment_percent",
                "label": "Builder Price Adjustment Percent",
                "fieldtype": "Float",
                "insert_after": "custom_price_adjustment_type",
                "hidden": 1,
                "no_copy": 1,
                "module": "Crystal Alluminium Works",
            },
            {
                # The walk-in's own phone number, captured directly in Quotation
                # Builder's cash-mode step. All cash quotations share the same
                # singleton "Cash Customer" party (see get_or_create_shared_cash_customer
                # in api.py), so the phone number is what actually distinguishes one
                # walk-in's transaction from another's.
                "fieldname": "custom_customer_phone",
                "label": "Customer Phone Number",
                "fieldtype": "Data",
                "options": "Phone",
                "insert_after": "party_name",
                "no_copy": 1,
                "module": "Crystal Alluminium Works",
            },
            {
                # The walk-in's own name, captured alongside the phone number in
                # Quotation Builder's cash-mode step. Same reasoning as
                # custom_customer_phone above — the shared Cash Customer party
                # itself carries no per-walk-in identity.
                "fieldname": "custom_customer_name",
                "label": "Customer Name",
                "fieldtype": "Data",
                "insert_after": "custom_customer_phone",
                "no_copy": 1,
                "module": "Crystal Alluminium Works",
            },
            {
                "fieldname": "custom_customer_pin",
                "label": "Customer KRA PIN",
                "fieldtype": "Data",
                "insert_after": "custom_customer_name",
                "no_copy": 1,
                "module": "Crystal Alluminium Works",
            },
        ],
        # Read-only view of what this entry did to the foreign-currency lot
        # ledger. Nothing is stored on the document — the panel calls
        # forex_fifo.get_payment_entry_detail(), which replays the whole
        # history — so the figures cannot go stale when an earlier, backdated
        # entry changes which lots this one consumed.
        "Payment Entry": [
            {
                "fieldname": "custom_forex_fifo_section",
                "label": "Foreign Currency FIFO",
                "fieldtype": "Section Break",
                "insert_after": "remarks",
                "collapsible": 1,
                # Irrelevant noise on the KES-only entries that are the bulk of
                # the day's work; the panel itself stays empty unless the entry
                # actually touched a tracked account.
                "depends_on": (
                    "eval:doc.docstatus===1 && ("
                    "doc.paid_from_account_currency!==frappe.boot.sysdefaults.currency"
                    " || doc.paid_to_account_currency!==frappe.boot.sysdefaults.currency)"
                ),
                "module": "Crystal Alluminium Works",
            },
            {
                "fieldname": "custom_forex_fifo_html",
                "label": "Forex FIFO",
                "fieldtype": "HTML",
                "insert_after": "custom_forex_fifo_section",
                "module": "Crystal Alluminium Works",
            },
        ],
    }

    create_custom_fields(custom_fields)
    reorder_procurement_standard_fields()
    print("Custom fields added to Customer, Quotation Item, Sales Order Item, Sales Invoice Item, and Sales Invoice")


def add_item_custom_fields():
    create_custom_fields({
        "Item": [
            {
                "fieldname": "custom_glass_type",
                "label": "Glass Type",
                "fieldtype": "Select",
                "options": ITEM_GLASS_TYPE_OPTIONS,
                "insert_after": "item_group",
                "depends_on": "eval:doc.item_group=='Glass'",
            },
            {
                "fieldname": "custom_product_code",
                "label": "Product Code",
                "fieldtype": "Data",
                "insert_after": "custom_glass_type",
                "read_only": 1,
            },
        ]
    })
    frappe.clear_cache(doctype="Item")


if __name__ == "__main__":
    add_custom_fields()
