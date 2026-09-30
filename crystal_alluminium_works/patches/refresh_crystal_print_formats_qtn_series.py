from crystal_alluminium_works.create_print_format import setup_formats


def execute():
    """Regenerate the stored Crystal print formats so the quotation number is read from
    QTN-2026-60000 (third part) as well as the older SAL-QTN-2026-60000 (fourth part)."""
    setup_formats()
