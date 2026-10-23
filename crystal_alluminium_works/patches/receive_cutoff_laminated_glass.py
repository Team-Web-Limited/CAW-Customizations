import datetime
import json

import frappe
from frappe.utils import flt

from crystal_alluminium_works.api import (
    _create_cutoff_laminated_receipt,
    _get_default_receiving_warehouse,
    _get_default_stock_company,
    _is_cutoff_sheet,
    _laminated_code_has_sheets,
)


def execute():
    """Receive the laminated glass of codes JC Operations recorded as made only from Cutoffs.

    Those codes got no repack, so nothing put their laminated glass into stock, but releases
    still deducted it, driving the code negative (LG23 at -1,606 sft). Each gets the zero-cost
    receipt save_jc_operations_consumption now posts, backdated to just before the code's first
    deduction on that Job Card. An open Job Card receives the code's full area (the rest is
    still to be released); a Completed or Cancelled one only what was actually deducted, so a
    job closed without releasing never adds glass that is not there."""
    company = _get_default_stock_company()
    warehouse = _get_default_receiving_warehouse(company)
    job_cards = frappe.get_all(
        "CAW Job Card",
        # Older saves wrote compact JSON ("is_cutoff":1), newer ones spaced: match either.
        filters={"custom_sheet_consumption_json": ["like", "%is_cutoff%"], "quotation": ["is", "set"]},
        fields=["name", "status", "quotation", "custom_sheet_consumption_json"],
        order_by="creation asc",
    )
    for job_card in job_cards:
        consumption = json.loads(job_card.custom_sheet_consumption_json or "{}")
        if not any(_is_cutoff_sheet(sheet) for sheets in consumption.values() for sheet in sheets or []):
            continue
        quotation = frappe.get_doc("Quotation", job_card.quotation)
        done = set()
        for row in quotation.items:
            if row.item_code in done or not consumption.get(row.name):
                continue
            if frappe.db.get_value("Item", row.item_code, "custom_glass_type") != "Laminated":
                continue
            done.add(row.item_code)
            if _laminated_code_has_sheets(quotation, row.item_code, consumption):
                continue
            first_at, deducted = _deductions(job_card.name, row.item_code)
            qty = deducted if job_card.status in ("Completed", "Cancelled") else None
            if qty is not None and qty <= 0.0001:
                continue
            _create_cutoff_laminated_receipt(
                job_card.name, quotation, row, consumption, warehouse, company, posting=first_at, qty=qty
            )


def _deductions(job_card_name, item_code):
    """((date, time) one second before this code's first deduction on the Job Card, or None,
    total sft deducted)."""
    rows = frappe.db.sql(
        """
        SELECT sle.posting_date, sle.posting_time, sle.actual_qty
        FROM `tabStock Ledger Entry` sle
        JOIN `tabStock Entry` se ON se.name = sle.voucher_no
        WHERE sle.item_code = %s AND sle.is_cancelled = 0 AND sle.actual_qty < 0
          AND se.remarks LIKE %s
        ORDER BY sle.posting_datetime ASC, sle.creation ASC
        """,
        (item_code, f"%Deducted for CAW Job Card: {job_card_name}%"),
        as_dict=True,
    )
    if not rows:
        return None, 0
    at = datetime.datetime.combine(rows[0].posting_date, datetime.time()) + rows[0].posting_time
    at -= datetime.timedelta(seconds=1)
    return (at.date(), at.time()), -sum(flt(r.actual_qty) for r in rows)
