from crystal_alluminium_works.create_print_format import setup_formats


def execute():
    """Regenerate the stored Crystal print formats: an invoice prints its date on the left with the
    customer details, and its Quote No below the Invoice / Sale No."""
    setup_formats()
