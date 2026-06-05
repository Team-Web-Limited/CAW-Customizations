import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


def execute():
    create_custom_fields({
        "Sales Invoice": [
            {
                "fieldname": "custom_source_job_card",
                "label": "Source Job Card",
                "fieldtype": "Link",
                "options": "CAW Job Card",
                "insert_after": "custom_source_quotation",
                "read_only": 1,
                "no_copy": 1,
                "hidden": 1,
            }
        ],
    })

    invoices = frappe.get_all(
        "Sales Invoice",
        filters={"custom_source_quotation": ["is", "set"]},
        fields=["name", "custom_source_quotation"],
        limit_page_length=0,
    )

    for invoice in invoices:
        job_card_name = frappe.db.get_value(
            "CAW Job Card",
            {"quotation": invoice.custom_source_quotation},
            "name",
            order_by="creation desc",
        )
        if job_card_name:
            frappe.db.set_value(
                "Sales Invoice",
                invoice.name,
                "custom_source_job_card",
                job_card_name,
                update_modified=False,
            )
