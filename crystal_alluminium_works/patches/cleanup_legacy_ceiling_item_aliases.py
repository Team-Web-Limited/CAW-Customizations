import frappe

from crystal_alluminium_works.pricing_engine import cleanup_legacy_ceiling_item_aliases


def execute():
    cleanup_legacy_ceiling_item_aliases()
    frappe.db.commit()
