import frappe

from crystal_alluminium_works.create_custom_fields import add_custom_fields


def execute():
    """Add Quotation.custom_customer_tax_id and backfill it for existing quotations.

    fetch_from only populates on save, so without the backfill every quotation raised
    before this patch would print with no PIN until someone re-saved it.
    """
    add_custom_fields()

    frappe.db.sql(
        """
        UPDATE `tabQuotation` AS q
        INNER JOIN `tabCustomer` AS c ON c.name = q.party_name
        SET q.custom_customer_tax_id = c.tax_id
        WHERE IFNULL(q.custom_customer_tax_id, '') = ''
          AND IFNULL(c.tax_id, '') != ''
        """
    )
