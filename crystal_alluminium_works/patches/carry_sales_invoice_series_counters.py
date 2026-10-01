import re

import frappe

# Sales Invoices moved from INV-.YYYY.-1.####### / INV-.YYYY.-8.#### to the bare-number series
# 1.####### / 8.#### (see sales_invoice_handler). Existing invoices keep their INV-<year>- names;
# only the counters carry over, from tabSeries "INV-2026-1" / "INV-2026-8" to "1" / "8", so the
# next invoice continues the numbering instead of restarting at 10000001 / 80001.
OLD_SERIES = re.compile(r"^INV-\d{4}-([18])$")


def execute():
    for series in frappe.db.sql("select name, current from `tabSeries` where name like 'INV-%%'", as_dict=True):
        match = OLD_SERIES.match(series.name)
        if not match:
            continue
        key = match.group(1)
        current = frappe.db.get_value("Series", key, "current", order_by="name")
        if current is None:
            frappe.db.sql("insert into `tabSeries` (name, current) values (%s, %s)", (key, series.current))
        elif int(current) < int(series.current):
            frappe.db.sql("update `tabSeries` set current = %s where name = %s", (series.current, key))
