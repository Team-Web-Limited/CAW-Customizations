import frappe

from crystal_alluminium_works.create_custom_fields import add_custom_fields
from crystal_alluminium_works.setup import create_item
from crystal_alluminium_works.setup_laminated_config import run_setup


def execute():
    add_custom_fields()
    run_setup()

    create_item("Glass Notching", "Glass Notching", "Glass", "Nos", 0, 25.0)

    try:
        settings = frappe.get_single("Glass Pricing Settings")
        if not getattr(settings, "notch_rate", None):
            settings.notch_rate = 25.0
            settings.save(ignore_permissions=True)
    except Exception:
        pass
