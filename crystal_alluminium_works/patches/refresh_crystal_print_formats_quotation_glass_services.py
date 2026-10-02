from crystal_alluminium_works.create_print_format import setup_formats


def execute():
    """Regenerate the stored Crystal print formats: the Quotation's glass section shows Polish
    Sides / Holes / Notches again, headed PS / HL / NT. Invoice and Job Card prints unchanged."""
    setup_formats()
