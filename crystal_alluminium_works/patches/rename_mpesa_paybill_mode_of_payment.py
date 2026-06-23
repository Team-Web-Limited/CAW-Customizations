import frappe
from frappe.model.rename_doc import rename_doc


def execute():
    if frappe.db.exists("Mode of Payment", "Mpesa/paybill") and not frappe.db.exists("Mode of Payment", "Paybill"):
        rename_doc(
            "Mode of Payment",
            "Mpesa/paybill",
            "Paybill",
            force=True,
            ignore_permissions=True,
            show_alert=False,
        )
