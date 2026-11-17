from crystal_alluminium_works.create_print_format import setup_formats


def execute():
    """Regenerate the stored Crystal print formats: the Holes column and totals now show the holes
    drilled (per-piece holes x pieces) instead of just the per-piece count."""
    setup_formats()
