import frappe

from crystal_alluminium_works.pricing_engine import ensure_ceiling_component_items


def execute():
    ensure_ceiling_component_items()
    frappe.db.commit()
