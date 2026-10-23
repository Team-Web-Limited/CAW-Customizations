import json
import re

import frappe
from frappe.utils import flt

from crystal_alluminium_works.api import (
    _get_partial_row_native_full,
    _laminated_rows_covered_by,
    _native_release_qty_to_sft,
)


def execute():
    """Add the laminated glass that JC Operations repacks left out.

    Until save_jc_operations_consumption sized a laminated repack from every row of its code,
    the repack produced only the first row's area, while the code's other rows were still
    deducted at release, driving laminated stock negative. Each short repack gets a zero-rate
    Material Receipt for the missing area, posted at the repack's own time: the raw glass cost
    already booked stays put and is spread over the full quantity. Runs once per repack (the
    receipt's remarks name it)."""
    repacks = frappe.get_all(
        "Stock Entry",
        filters={"stock_entry_type": "Repack", "docstatus": 1, "remarks": ["like", "Repacked for CAW Job Card:%Row:%"]},
        fields=["name", "company", "posting_date", "posting_time", "remarks"],
        order_by="posting_date asc, posting_time asc, creation asc",
    )
    for repack in repacks:
        marker = f"Laminated output correction for {repack.name}"
        if frappe.db.exists("Stock Entry", {"remarks": ["like", f"{marker}%"], "docstatus": 1}):
            continue

        match = re.match(r"Repacked for CAW Job Card: (\S+) Row: (\S+)", repack.remarks or "")
        if not match:
            continue
        job_card_name, row_name = match.groups()
        job_card = frappe.db.get_value(
            "CAW Job Card", job_card_name, ["quotation", "custom_sheet_consumption_json"], as_dict=True
        )
        if not job_card or not job_card.quotation:
            continue
        quotation = frappe.get_doc("Quotation", job_card.quotation)
        row = next((item for item in quotation.items if item.name == row_name), None)
        if not row:
            continue

        consumption = json.loads(job_card.custom_sheet_consumption_json or "{}")
        expected = flt(row.custom_area_sqft) * flt(row.qty) + sum(
            _native_release_qty_to_sft(other, _get_partial_row_native_full(other))
            for other in _laminated_rows_covered_by(quotation, row, consumption)
        )
        outputs = frappe.get_all(
            "Stock Entry Detail",
            filters={"parent": repack.name, "item_code": row.item_code, "t_warehouse": ["is", "set"]},
            fields=["t_warehouse", "qty"],
        )
        if not outputs:
            continue
        missing = round(expected - sum(flt(output.qty) for output in outputs), 4)
        if missing <= 0.001:
            continue

        entry = frappe.new_doc("Stock Entry")
        entry.stock_entry_type = "Material Receipt"
        entry.company = repack.company
        entry.set_posting_time = 1
        entry.posting_date = repack.posting_date
        entry.posting_time = repack.posting_time
        entry.remarks = (
            f"{marker} (CAW Job Card: {job_card_name}): the repack made only row {row_name}'s "
            f"laminated glass, not the other rows of {row.item_code}."
        )
        entry.append("items", {
            "item_code": row.item_code,
            "t_warehouse": outputs[0].t_warehouse,
            "qty": missing,
            "basic_rate": 0,
            "allow_zero_valuation_rate": 1,
        })
        entry.flags.ignore_permissions = True
        entry.insert()
        entry.submit()
