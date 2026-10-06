from crystal_alluminium_works.create_custom_fields import add_custom_fields


def execute():
    """Add Sales Invoice Item.custom_quotation_row, the link sales_invoice_handler uses to keep a
    quotation's quoted prices on the invoice made from it."""
    add_custom_fields()
