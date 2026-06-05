import frappe


def execute():
    history_rows = frappe.get_all(
        "CAW Job Card History",
        fields=["name", "quotation_amount", "payment_amount", "balance_amount"],
        order_by="creation asc",
        limit_page_length=0,
    )

    for row in history_rows:
        quotation_amount = frappe.utils.flt(row.quotation_amount or 0)
        payment_amount = frappe.utils.flt(row.payment_amount or 0)
        expected_balance = max(quotation_amount - payment_amount, 0)
        current_balance = frappe.utils.flt(row.balance_amount or 0)

        if current_balance != expected_balance:
            frappe.db.set_value(
                "CAW Job Card History",
                row.name,
                "balance_amount",
                expected_balance,
                update_modified=False,
            )
