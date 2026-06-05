import frappe
from frappe.model.rename_doc import rename_doc


def execute():
    rows = frappe.get_all(
        "CAW Job Card",
        fields=["name", "quotation"],
        filters={"quotation": ["is", "set"]},
        limit_page_length=0,
    )

    for row in rows:
        target_name = f"JOB-CARD-{row.quotation}"
        if row.name == target_name:
            continue
        if frappe.db.exists("CAW Job Card", target_name):
            continue

        rename_doc(
            "CAW Job Card",
            row.name,
            target_name,
            force=True,
            ignore_permissions=True,
            show_alert=False,
        )
