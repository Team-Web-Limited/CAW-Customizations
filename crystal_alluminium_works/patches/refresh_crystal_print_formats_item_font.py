from crystal_alluminium_works.create_print_format import setup_formats


def execute():
    """Regenerate the stored Crystal print formats: item tables at 11px, glass charges that wrap
    under their counts, and a minimum width for the glass Item column."""
    setup_formats()
