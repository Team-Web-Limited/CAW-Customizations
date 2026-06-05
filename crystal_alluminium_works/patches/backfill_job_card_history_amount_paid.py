import frappe


def execute():
    job_cards = frappe.get_all("CAW Job Card", fields=["name"], limit_page_length=0)

    for job_card in job_cards:
        history_rows = frappe.get_all(
            "CAW Job Card History",
            filters={"job_card": job_card.name},
            fields=["name", "change_type", "payment_amount"],
            order_by="creation asc",
            limit_page_length=0,
        )

        previous_payment_amount = 0
        for row in history_rows:
            current_payment_amount = frappe.utils.flt(row.payment_amount or 0)
            amount_paid = current_payment_amount if row.change_type == "Created" else current_payment_amount - previous_payment_amount
            frappe.db.set_value(
                "CAW Job Card History",
                row.name,
                "amount_paid",
                amount_paid,
                update_modified=False,
            )
            previous_payment_amount = current_payment_amount
