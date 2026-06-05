from crystal_alluminium_works.create_print_format import setup_formats
from crystal_alluminium_works.print_format_config import ensure_default_print_format_configurations


def execute():
    ensure_default_print_format_configurations()
    setup_formats()
