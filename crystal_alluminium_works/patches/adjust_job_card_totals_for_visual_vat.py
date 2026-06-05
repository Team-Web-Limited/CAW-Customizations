import frappe

from crystal_alluminium_works.api import _get_quotation_display_total, _round_job_card_amount


def execute():
    job_cards = frappe.get_all(
        "CAW Job Card",
        fields=["name", "quotation", "quotation_amount", "payment_amount", "balance_amount"],
        limit_page_length=0,
    )

    for row in job_cards:
        if not row.quotation or not frappe.db.exists("Quotation", row.quotation):
            continue

        quotation_doc = frappe.get_doc("Quotation", row.quotation)
        expected_total = _round_job_card_amount(_get_quotation_display_total(quotation_doc) or 0)
        current_total = frappe.utils.flt(row.quotation_amount or 0)
        payment_amount = _round_job_card_amount(row.payment_amount)
        expected_balance = _round_job_card_amount(max(expected_total - payment_amount, 0))
        current_balance = frappe.utils.flt(row.balance_amount or 0)

        updates = {}
        if current_total != expected_total:
            updates["quotation_amount"] = expected_total
        if current_balance != expected_balance:
            updates["balance_amount"] = expected_balance

        if updates:
            frappe.db.set_value("CAW Job Card", row.name, updates, update_modified=False)

        history_rows = frappe.get_all(
            "CAW Job Card History",
            filters={"job_card": row.name},
            fields=["name", "quotation_amount", "payment_amount", "balance_amount"],
            order_by="creation asc",
            limit_page_length=0,
        )

        for history_row in history_rows:
            history_payment_amount = _round_job_card_amount(history_row.payment_amount)
            history_expected_balance = _round_job_card_amount(max(expected_total - history_payment_amount, 0))
            history_updates = {}

            if frappe.utils.flt(history_row.quotation_amount or 0) != expected_total:
                history_updates["quotation_amount"] = expected_total
            if frappe.utils.flt(history_row.balance_amount or 0) != history_expected_balance:
                history_updates["balance_amount"] = history_expected_balance

            if history_updates:
                frappe.db.set_value(
                    "CAW Job Card History",
                    history_row.name,
                    history_updates,
                    update_modified=False,
                )
