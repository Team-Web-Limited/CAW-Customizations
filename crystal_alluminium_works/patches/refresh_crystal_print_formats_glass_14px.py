from crystal_alluminium_works.create_print_format import setup_formats


def execute():
    """Regenerate the stored Crystal print formats: Job Card tables at 14px; Quotation / Sales
    Invoice glass section without Polish Sides / Holes / Notches, at 14px."""
    setup_formats()
