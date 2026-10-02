from crystal_alluminium_works.create_print_format import setup_formats


def execute():
    """Regenerate the stored Crystal print formats: the Job Card's cut-size glass table shows
    which edges to polish (e.g. "2W + 2H") instead of a bare total."""
    setup_formats()
