"""Re-apply the procurement sheet fields to Purchase Receipt Item.

add_procurement_sheet_fields claimed to make the Purchase Receipt Item copies
editable, but on sites that ran it the receipt fields kept their original
read-only shape: Product Category / Sheets / Pcs / Pieces stayed read_only, and
Sheet Size stayed a free-text Data field whose depends_on required
custom_glass_sale_mode == 'Sheet'. Sale mode is only ever set *by* the sheet
computation, so on a receipt started from scratch those fields never appeared at
all — glass could only be received by first raising a Material Request or
Purchase Order. Since that patch is already in Patch Log it will never re-run,
so this one re-applies the definitions.

add_custom_fields() is idempotent and its Purchase Receipt Item definitions
already match Purchase Order Item, so this just brings the site up to what the
code has described all along. reorder_procurement_standard_fields() has to run
too: the field_order / read-only Property Setters it writes are not exported as
fixtures, so a migrate alone would not fix the row layout.
"""

import frappe

from crystal_alluminium_works.create_custom_fields import add_custom_fields


def execute():
    add_custom_fields()

    for doctype in ("Purchase Receipt", "Purchase Receipt Item"):
        frappe.clear_cache(doctype=doctype)
