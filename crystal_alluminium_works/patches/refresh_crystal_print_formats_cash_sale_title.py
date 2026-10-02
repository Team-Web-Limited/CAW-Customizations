from crystal_alluminium_works.create_print_format import setup_formats


def execute():
    """Regenerate the stored Crystal print formats: a cash customer's invoice prints as CASH SALE
    with a Sale No; invoice customers and credit notes unchanged."""
    setup_formats()
