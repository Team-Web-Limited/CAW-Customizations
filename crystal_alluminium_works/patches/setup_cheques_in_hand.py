import frappe

from crystal_alluminium_works.cheque_register import ensure_cheques_in_hand_account


def execute():
    """Received cheques post to a Cheques in Hand ledger until they clear (cheque_register.py)."""
    for company in frappe.get_all("Company", pluck="name"):
        ensure_cheques_in_hand_account(company)
