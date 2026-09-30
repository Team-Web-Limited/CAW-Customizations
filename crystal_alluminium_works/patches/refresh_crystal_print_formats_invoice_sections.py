from crystal_alluminium_works.create_print_format import setup_formats


def execute():
    """Regenerate the stored Crystal print formats: Sales Invoices (credit notes included) print
    items in sections like Quotations, item tables are tighter with wrapping headers, and the PDF
    side margins are 8mm so the Amount column is never cut off."""
    setup_formats()
