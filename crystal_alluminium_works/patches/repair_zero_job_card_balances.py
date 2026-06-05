import frappe


def execute():
    rows = frappe.get_all(
        "CAW Job Card",
        fields=["name", "quotation_amount", "payment_amount", "balance_amount"],
        limit_page_length=0,
    )

    for row in rows:
        quotation_amount = frappe.utils.flt(row.quotation_amount or 0)
        payment_amount = frappe.utils.flt(row.payment_amount or 0)
        balance_amount = frappe.utils.flt(row.balance_amount or 0)

        if quotation_amount and balance_amount <= 0 and payment_amount < quotation_amount:
            frappe.db.set_value(
                "CAW Job Card",
                row.name,
                "balance_amount",
                quotation_amount - payment_amount,
                update_modified=False,
            )
