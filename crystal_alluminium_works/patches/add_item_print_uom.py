from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

from crystal_alluminium_works.create_print_format import setup_formats


def execute():
    create_custom_fields({
        "Item": [{
            "fieldname": "custom_print_uom",
            "label": "Print Unit of Measure",
            "fieldtype": "Data",
            "insert_after": "stock_uom",
            "description": "Shown on quotation and invoice printouts only. Does not affect pricing or stock.",
            "module": "Crystal Alluminium Works",
        }]
    })
    setup_formats()
