from crystal_alluminium_works.create_custom_fields import add_custom_fields
from crystal_alluminium_works.create_print_format import setup_formats


def execute():
    """Add Quotation.custom_bill_to_name / custom_bill_to_pin (a cash quotation printed and
    invoiced to an organisation — see api.set_quotation_bill_to) and regenerate the Crystal print
    formats, whose Quotation header now prints the Bill To when set."""
    add_custom_fields()
    setup_formats()
