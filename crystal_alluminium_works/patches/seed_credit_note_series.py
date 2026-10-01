import frappe

from crystal_alluminium_works.sales_invoice_handler import CREDIT_NOTE_SERIES_KEY

# Credit notes continue the previous system's numbering: the next one is 8485.
NEXT_CREDIT_NOTE = 8485


def execute():
    current = frappe.db.get_value("Series", CREDIT_NOTE_SERIES_KEY, "current", order_by="name")
    if current is None:
        frappe.db.sql(
            "insert into `tabSeries` (name, current) values (%s, %s)",
            (CREDIT_NOTE_SERIES_KEY, NEXT_CREDIT_NOTE - 1),
        )
    elif int(current) < NEXT_CREDIT_NOTE - 1:
        frappe.db.sql(
            "update `tabSeries` set current = %s where name = %s",
            (NEXT_CREDIT_NOTE - 1, CREDIT_NOTE_SERIES_KEY),
        )
