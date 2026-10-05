from crystal_alluminium_works.create_custom_fields import add_custom_fields


def execute():
    """Add the category-first Material Issue fields to Stock Entry Detail (Product Category,
    Sheet Size, Sheets, Pieces) — see stock_entry_handler and public/js/stock_entry.js."""
    add_custom_fields()
