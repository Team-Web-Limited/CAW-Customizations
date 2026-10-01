from crystal_alluminium_works.create_print_format import setup_formats


def execute():
    """Regenerate the stored Crystal print formats: the Job Card's Aluminium table shows the
    Builder's Description column (when any row has one)."""
    setup_formats()
