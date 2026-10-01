import re

import frappe
from frappe.model.rename_doc import rename_doc

# Job Cards used to be named after their Quotation (JOB-CARD-QTN-2026-60003). They now have
# their own counter, JC-.YYYY.-.##### (see CAW Job Card autoname). Renumber the existing cards
# oldest-first so the counter continues from them.
#
# rename_doc re-points every Link field (Payments, Payment Job Card Allocation, CAW Job Card
# History/Release, CAW Ceiling Release, Sales Invoice custom_source_job_card). Stock Entry
# remarks ("Deducted for CAW Job Card: <name> Row: ...") are matched with LIKE by the JC
# operations code, so they are rewritten here too, along with their GL Entry copies.
REMARK_TABLES = (("Stock Entry", "remarks"), ("GL Entry", "remarks"), ("Comment", "subject"))


def execute():
    job_cards = frappe.get_all(
        "CAW Job Card",
        filters={"name": ["like", "JOB-CARD-%"]},
        fields=["name", "creation"],
        order_by="creation asc, name asc",
        limit_page_length=0,
    )
    if not job_cards:
        return

    for row in job_cards:
        prefix = f"JC-{row.creation.year}-"
        current = _next_free_number(prefix)
        new_name = f"{prefix}{current:05d}"
        rename_doc(
            "CAW Job Card",
            row.name,
            new_name,
            force=True,
            ignore_permissions=True,
            show_alert=False,
        )
        _set_series(prefix, current)
        _rewrite_text_references(row.name, new_name)


def _next_free_number(prefix):
    current = frappe.db.get_value("Series", prefix, "current", order_by="name") or 0
    current = int(current) + 1
    while frappe.db.exists("CAW Job Card", f"{prefix}{current:05d}"):
        current += 1
    return current


def _set_series(prefix, current):
    if frappe.db.exists("Series", prefix):
        frappe.db.sql("update `tabSeries` set current = %s where name = %s", (current, prefix))
    else:
        frappe.db.sql("insert into `tabSeries` (name, current) values (%s, %s)", (prefix, current))


def _rewrite_text_references(old_name, new_name):
    # Exact-name match only: JOB-CARD-QTN-2026-6000 must not touch JOB-CARD-QTN-2026-60001.
    pattern = re.compile(re.escape(old_name) + r"(?![\w-])")
    for doctype, field in REMARK_TABLES:
        rows = frappe.get_all(
            doctype,
            filters={field: ["like", f"%{old_name}%"]},
            fields=["name", field],
            limit_page_length=0,
        )
        for row in rows:
            updated = pattern.sub(new_name, row[field])
            if updated != row[field]:
                frappe.db.set_value(doctype, row.name, field, updated, update_modified=False)
