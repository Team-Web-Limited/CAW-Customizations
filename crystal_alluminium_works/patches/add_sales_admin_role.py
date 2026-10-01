import frappe
from frappe.permissions import add_permission, update_permission_property

ROLE = "Sales Admin"
# The doctypes Manage Items reads and writes directly (its other writes go through api.py
# endpoints gated by ITEM_ADMIN_ROLES, which bypass doctype permissions themselves).
PERMISSIONS = {
    "Item": ["read", "write", "create", "delete", "report", "export"],
    "Item Price": ["read", "write", "create", "delete", "report", "export"],
    "Glass Pricing Settings": ["read", "write"],
}


def execute():
    """Sales Admin: sales staff who may also maintain the item catalogue on Manage Items."""
    if not frappe.db.exists("Role", ROLE):
        frappe.get_doc({"doctype": "Role", "role_name": ROLE, "desk_access": 1}).insert(ignore_permissions=True)
    for doctype, rights in PERMISSIONS.items():
        if not frappe.db.exists("DocType", doctype):
            continue
        add_permission(doctype, ROLE, 0)
        for right in rights:
            update_permission_property(doctype, ROLE, 0, right, 1)
