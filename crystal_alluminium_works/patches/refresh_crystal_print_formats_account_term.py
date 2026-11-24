from crystal_alluminium_works.create_print_format import setup_formats


def execute():
    """Regenerate the stored Crystal print formats so Quotations, Job Cards and invoice-customer
    invoices print the account term, and invoices given time to pay print their due date."""
    setup_formats()
