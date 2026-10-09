from crystal_alluminium_works.create_print_format import setup_formats


def execute():
    """Regenerate the stored Crystal print formats: the Job Card's glass tables group a mix of
    glass types by type, each with its own subtotal, as the Quotation / Sales Invoice do."""
    setup_formats()
