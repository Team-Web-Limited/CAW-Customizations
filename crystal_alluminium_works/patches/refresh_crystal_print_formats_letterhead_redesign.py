from crystal_alluminium_works.create_print_format import setup_formats
from crystal_alluminium_works.patches import set_company_letterhead_image


def execute():
    """Regenerate the stored Crystal print formats (now including the Statement of Accounts)
    for the redesigned full-width letterhead, 5mm top margin and credit note "Approved By",
    and refresh the Company Letterhead's embedded copy of the new letterhead image."""
    setup_formats()
    set_company_letterhead_image.execute()
