from crystal_alluminium_works.create_print_format import setup_formats


def execute():
    """Regenerate the stored Crystal print formats with narrower side margins (6mm page margin,
    no extra content margin), so the content uses the page width."""
    setup_formats()
