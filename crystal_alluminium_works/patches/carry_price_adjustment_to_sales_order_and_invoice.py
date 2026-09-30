import frappe

from crystal_alluminium_works.create_custom_fields import add_custom_fields


def execute():
    """Add the Builder price-adjustment fields to Sales Order / Sales Invoice (and make the
    Quotation ones copyable), then backfill them from each document's source Quotation.

    Their validate hooks re-price glass/ceiling rows from the Item's own rate and now put the
    Builder's +/- % back on, so a draft saved again keeps the quotation's adjusted price.
    Only the two fields are set — nothing is re-saved, so no existing amounts change.
    """
    add_custom_fields()

    frappe.db.sql(
        """
        UPDATE `tabSales Order` AS so
        INNER JOIN (
            SELECT parent, MAX(prevdoc_docname) AS quotation
            FROM `tabSales Order Item`
            WHERE IFNULL(prevdoc_docname, '') != ''
            GROUP BY parent
        ) AS link ON link.parent = so.name
        INNER JOIN `tabQuotation` AS q ON q.name = link.quotation
        SET so.custom_price_adjustment_type = q.custom_price_adjustment_type,
            so.custom_price_adjustment_percent = q.custom_price_adjustment_percent
        WHERE IFNULL(q.custom_price_adjustment_percent, 0) != 0
          AND IFNULL(so.custom_price_adjustment_percent, 0) = 0
        """
    )

    # Invoices made straight from a Quotation (the Job Card flow) record it on the header.
    frappe.db.sql(
        """
        UPDATE `tabSales Invoice` AS si
        INNER JOIN `tabQuotation` AS q ON q.name = si.custom_source_quotation
        SET si.custom_price_adjustment_type = q.custom_price_adjustment_type,
            si.custom_price_adjustment_percent = q.custom_price_adjustment_percent
        WHERE IFNULL(q.custom_price_adjustment_percent, 0) != 0
          AND IFNULL(si.custom_price_adjustment_percent, 0) = 0
        """
    )

    # Invoices made from a Sales Order inherit what the order now carries.
    frappe.db.sql(
        """
        UPDATE `tabSales Invoice` AS si
        INNER JOIN (
            SELECT parent, MAX(sales_order) AS sales_order
            FROM `tabSales Invoice Item`
            WHERE IFNULL(sales_order, '') != ''
            GROUP BY parent
        ) AS link ON link.parent = si.name
        INNER JOIN `tabSales Order` AS so ON so.name = link.sales_order
        SET si.custom_price_adjustment_type = so.custom_price_adjustment_type,
            si.custom_price_adjustment_percent = so.custom_price_adjustment_percent
        WHERE IFNULL(so.custom_price_adjustment_percent, 0) != 0
          AND IFNULL(si.custom_price_adjustment_percent, 0) = 0
        """
    )
