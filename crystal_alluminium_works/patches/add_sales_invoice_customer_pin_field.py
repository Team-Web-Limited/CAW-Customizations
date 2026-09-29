import frappe

from crystal_alluminium_works.create_custom_fields import add_custom_fields


def execute():
    """Add Sales Invoice.custom_customer_pin and backfill it from each invoice's source Quotation.

    Walk-in (Cash) invoices all belong to the shared Cash Customer record, which has no tax_id,
    so the walk-in's PIN only lived on the Quotation and every existing walk-in invoice printed
    "PIN Number: -". Display-only, so filling it on submitted invoices touches no accounting.
    """
    add_custom_fields()

    frappe.db.sql(
        """
        UPDATE `tabSales Invoice` AS si
        INNER JOIN `tabQuotation` AS q ON q.name = si.custom_source_quotation
        SET si.custom_customer_pin = q.custom_customer_pin
        WHERE IFNULL(si.custom_customer_pin, '') = ''
          AND IFNULL(q.custom_customer_pin, '') != ''
        """
    )
