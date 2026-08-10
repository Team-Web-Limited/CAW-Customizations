"""Add the Foreign Currency FIFO panel to Payment Entry.

The two USD bank accounts are treated as inventories of dollars, costed FIFO
against the KES actually given up to acquire them. The panel is a read-only
view of that ledger from the entry that moved the currency -- see
crystal_alluminium_works/forex_fifo.py for the rules and the reasoning.

Only a Section Break and an HTML field are created; no data is stored on the
document. Which lots a payment consumed depends on every entry before it, so a
stored answer would silently go wrong the moment someone backdates an entry.

add_custom_fields() is idempotent, so this is safe to re-run.
"""

import frappe

from crystal_alluminium_works.create_custom_fields import add_custom_fields


def execute():
	add_custom_fields()
	frappe.clear_cache(doctype="Payment Entry")
