import frappe

LETTERHEAD_IMAGE = "/assets/crystal_alluminium_works/images/crystal-alluminium-works-letterhead.jpeg"


def execute():
    if frappe.db.exists("Letter Head", "Company Letterhead"):
        letter_head = frappe.get_doc("Letter Head", "Company Letterhead")
    else:
        letter_head = frappe.new_doc("Letter Head")
        letter_head.letter_head_name = "Company Letterhead"

    letter_head.source = "Image"
    letter_head.image = LETTERHEAD_IMAGE
    letter_head.is_default = 1
    letter_head.disabled = 0
    letter_head.save()

    frappe.db.set_value(
        "Letter Head",
        {"name": ["!=", letter_head.name], "is_default": 1},
        "is_default",
        0,
    )
