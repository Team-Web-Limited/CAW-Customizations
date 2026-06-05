import frappe


def _build_sidebar_items():
    return [
        {"label": "Dimension Range", "type": "Link", "link_type": "DocType", "link_to": "Dimension Range", "idx": 1},
        {"label": "Ceiling Composition", "type": "Link", "link_type": "DocType", "link_to": "Ceiling Composition", "idx": 2},
        {"label": "Pages", "type": "Section Break", "idx": 3},
        {"label": "Operations Dashboard", "type": "Link", "link_type": "Page", "link_to": "crystal-aluminium-wo", "icon": "panel-top", "child": 1, "idx": 4},
        {"label": "Quotation Builder", "type": "Link", "link_type": "Page", "link_to": "quotation-builder", "icon": "panel-top", "child": 1, "idx": 5},
        {"label": "Manage Items", "type": "Link", "link_type": "Page", "link_to": "manage-items", "icon": "panel-top", "child": 1, "idx": 6},
        {"label": "Print Format Configurations", "type": "Link", "link_type": "Page", "link_to": "print-format-configurations", "icon": "settings", "child": 1, "idx": 7},
        {"label": "Quotation Manager", "type": "Link", "link_type": "Page", "link_to": "quotation-manager", "icon": "panel-top", "child": 1, "idx": 8},
        {"label": "Quotations", "type": "Link", "link_type": "Page", "link_to": "quotations", "icon": "panel-top", "child": 1, "idx": 9},
        {"label": "Sales Invoices", "type": "Link", "link_type": "Page", "link_to": "sales-invoices", "icon": "receipt", "child": 1, "idx": 10},
        {"label": "Cash Sales", "type": "Link", "link_type": "Page", "link_to": "cash-sales", "icon": "receipt", "child": 1, "idx": 11},
        {"label": "Job Cards", "type": "Link", "link_type": "Page", "link_to": "job-cards", "icon": "clipboard", "child": 1, "idx": 12},
        {"label": "Sales Invoice Manager", "type": "Link", "link_type": "Page", "link_to": "sales-invoice-manager", "icon": "receipt", "child": 1, "idx": 13},
        {"label": "Customer Manager", "type": "Link", "link_type": "Page", "link_to": "customer-manager", "icon": "users", "child": 1, "idx": 14},
        {"label": "Payments Page", "type": "Link", "link_type": "Page", "link_to": "payments-page", "icon": "credit-card", "child": 1, "idx": 15},
    ]


def execute():
    sidebar_name = frappe.db.exists("Workspace Sidebar", "Crystal Alluminium Works")
    if sidebar_name:
        sidebar = frappe.get_doc("Workspace Sidebar", sidebar_name)
    else:
        sidebar = frappe.new_doc("Workspace Sidebar")
        sidebar.title = "Crystal Alluminium Works"

    sidebar.header_icon = "hammer"
    sidebar.module = "Crystal Alluminium Works"
    sidebar.standard = 1
    sidebar.app = "crystal_alluminium_works"
    sidebar.for_user = None
    sidebar.items = []

    for item in _build_sidebar_items():
        sidebar.append("items", item)

    if sidebar.get("__islocal"):
        sidebar.insert(ignore_permissions=True)
    else:
        sidebar.save(ignore_permissions=True)
