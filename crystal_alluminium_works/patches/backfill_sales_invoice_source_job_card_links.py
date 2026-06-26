import frappe


def execute():
    if not frappe.db.exists("DocField", {"parent": "Sales Invoice", "fieldname": "custom_source_job_card"}):
        return 0

    invoices = frappe.get_all(
        "Sales Invoice",
        filters={
            "custom_source_quotation": ["is", "set"],
            "custom_source_job_card": ["in", ["", None]],
        },
        fields=["name", "custom_source_quotation"],
        limit_page_length=0,
    )

    updated = 0
    for invoice in invoices:
        job_card_name = frappe.db.get_value(
            "CAW Job Card",
            {"quotation": invoice.custom_source_quotation},
            "name",
            order_by="creation desc",
        )
        if not job_card_name:
            continue

        frappe.db.set_value(
            "Sales Invoice",
            invoice.name,
            "custom_source_job_card",
            job_card_name,
            update_modified=False,
        )
        updated += 1

    return updated
