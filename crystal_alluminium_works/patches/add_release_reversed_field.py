import frappe

from crystal_alluminium_works.create_custom_fields import add_custom_fields


def execute():
    """Sales Invoice.custom_release_reversed (undo_partial_release in api.py)."""
    add_custom_fields()
    frappe.clear_cache(doctype="Sales Invoice")

    # 10010089 (JC-2026-00599) was a mistaken partial release reversed by hand on 2026-10-17;
    # its custom_source_quotation was cleared on 2026-10-22 as a stopgap to unfreeze the Job
    # Card. Re-link it and mark it reversed the proper way. Only touches it in exactly that state.
    invoice = frappe.db.get_value(
        "Sales Invoice",
        "10010089",
        ["docstatus", "custom_is_partial", "custom_source_job_card", "custom_source_quotation"],
        as_dict=True,
    )
    if (
        invoice
        and invoice.docstatus == 2
        and invoice.custom_is_partial
        and invoice.custom_source_job_card == "JC-2026-00599"
        and not invoice.custom_source_quotation
        and frappe.db.get_value("CAW Job Card", "JC-2026-00599", "quotation") == "QTN-2026-61009"
    ):
        frappe.db.set_value(
            "Sales Invoice",
            "10010089",
            {"custom_source_quotation": "QTN-2026-61009", "custom_release_reversed": 1},
            update_modified=False,
        )
