from crystal_alluminium_works.create_print_format import setup_formats


def execute():
    """Regenerate the stored Crystal print formats: every Quotation / Sales Invoice item table
    (not only Glass) at 14px."""
    setup_formats()
