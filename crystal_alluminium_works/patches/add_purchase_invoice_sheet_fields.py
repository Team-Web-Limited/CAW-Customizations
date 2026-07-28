"""Extend the glass sheet / ceiling piece entry fields to Purchase Invoice Item,
and add custom_rejected_pcs to the two doctypes that can reject goods.

A Purchase Invoice with "Update Stock" ticked takes stock in on its own, without
a receipt, so it is a fourth entry point into the procurement flow rather than
only a billing document. Giving Purchase Invoice Item the same fields the other
three carry means glass can be received straight from an invoice, and the values
still carry through the standard mapping when the invoice is raised from a
Purchase Order or Purchase Receipt instead.

custom_rejected_pcs is the piece-denominated counterpart of ERPNext's standard
rejected_qty, which is in stock UOM: rejecting one 1220x1830 sheet meant typing
24 (SFT) on a row where every other quantity is a count of sheets. Only Purchase
Receipt Item and Purchase Invoice Item get it — nothing can be rejected before it
has physically arrived, so neither Material Request Item nor Purchase Order Item
has a rejected_qty to derive.

add_custom_fields() is idempotent, and reorder_procurement_standard_fields() has
to run alongside it because the field_order / read-only Property Setters it
writes are not exported as fixtures.
"""

import frappe

from crystal_alluminium_works.create_custom_fields import add_custom_fields


def execute():
    add_custom_fields()

    for doctype in (
        "Purchase Invoice",
        "Purchase Invoice Item",
        "Purchase Receipt",
        "Purchase Receipt Item",
    ):
        frappe.clear_cache(doctype=doctype)
