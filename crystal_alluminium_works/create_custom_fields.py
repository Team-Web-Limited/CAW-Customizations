import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

PRODUCT_CATEGORY_OPTIONS = "\nAluminium\nGlass\nFittings\nCeiling\nRubber\nSilicone"
GLASS_SALE_MODE_OPTIONS = "Resized\nFull Sheet\nSheet"
ITEM_GLASS_TYPE_OPTIONS = "Ordinary\nLaminated\nReady Laminated\nToughened"
GLASS_POLISH_TYPE_OPTIONS = "\n4-6\n8-10\n14-35"
GLASS_HOLE_TYPE_OPTIONS = "\n5mm\n6mm\n8mm\n10mm\n15mm\n20mm"
GLASS_NOTCH_TYPE_OPTIONS = "\nStandard\nSmall\nMirror Screws\nTimber Box"


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


def add_custom_fields():
    custom_fields = {
        # Quotation Item — editable fields
        "Quotation Item": _get_crystal_item_fields(read_only=False),
        # Sales Order Item — frozen (read-only) copy of the quotation data
        "Sales Order Item": _get_crystal_item_fields(read_only=True),
        # Sales Invoice Item — frozen (read-only) copy for accounting records
        "Sales Invoice Item": _get_crystal_item_fields(read_only=True),
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
            }
        ],
    }

    create_custom_fields(custom_fields)
    print("Custom fields added to Quotation Item, Sales Order Item, Sales Invoice Item, and Sales Invoice")


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
