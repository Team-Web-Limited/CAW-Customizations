import frappe

from crystal_alluminium_works.create_print_format import get_letterhead_data_uri


def execute():
    if frappe.db.exists("Letter Head", "Company Letterhead"):
        letter_head = frappe.get_doc("Letter Head", "Company Letterhead")
    else:
        letter_head = frappe.new_doc("Letter Head")
        letter_head.letter_head_name = "Company Letterhead"

    # Embed the logo inline as a data URI. wkhtmltopdf cannot fetch the /assets/
    # image URL during PDF generation (ContentNotFoundError), which breaks any PDF
    # rendered with this letter head. A data URI carries the image inline so it
    # renders in the preview and PDF alike. source must be "HTML" so Frappe keeps
    # the content verbatim instead of regenerating it from the image field.
    letter_head.source = "HTML"
    letter_head.content = (
        '<div style="text-align: left;">\n'
        f'<img src="{get_letterhead_data_uri()}" alt="Company Letterhead" '
        'style="max-width: 100%; height: auto;">\n'
        "</div>"
    )
    letter_head.is_default = 1
    letter_head.disabled = 0
    letter_head.save()

    frappe.db.set_value(
        "Letter Head",
        {"name": ["!=", letter_head.name], "is_default": 1},
        "is_default",
        0,
    )
