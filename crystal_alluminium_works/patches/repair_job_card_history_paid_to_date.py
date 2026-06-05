import frappe


def execute():
    job_cards = frappe.get_all("CAW Job Card", fields=["name"], limit_page_length=0)

    for job_card in job_cards:
        history_rows = frappe.get_all(
            "CAW Job Card History",
            filters={"job_card": job_card.name},
            fields=[
                "name",
                "quotation_amount",
                "payment_amount",
                "amount_paid",
                "balance_amount",
            ],
            order_by="creation asc",
            limit_page_length=0,
        )

        previous_paid_to_date = 0
        for row in history_rows:
            quotation_amount = frappe.utils.flt(row.quotation_amount or 0)
            balance_amount = frappe.utils.flt(row.balance_amount or 0)
            expected_paid_to_date = max(quotation_amount - balance_amount, 0)
            expected_amount_paid = expected_paid_to_date - previous_paid_to_date

            updates = {}

            current_paid_to_date = frappe.utils.flt(row.payment_amount or 0)
            if current_paid_to_date != expected_paid_to_date:
                updates["payment_amount"] = expected_paid_to_date

            current_amount_paid = frappe.utils.flt(row.amount_paid or 0)
            if current_amount_paid != expected_amount_paid:
                updates["amount_paid"] = expected_amount_paid

            if updates:
                frappe.db.set_value(
                    "CAW Job Card History",
                    row.name,
                    updates,
                    update_modified=False,
                )

            previous_paid_to_date = expected_paid_to_date
