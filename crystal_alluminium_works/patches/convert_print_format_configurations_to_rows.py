"""Convert CAW Print Format Configuration from fixed fields to editable rows.

Each print format used to store named fields (validity_days, bank_name, ...) that code
assembled into the printed sentences. They are now plain lines staff add, edit and delete on
the Print Format Configurations page. This rewrites every stored configuration as the exact
lines it printed before, so each site keeps its own wording and the printed output doesn't
change.
"""

import json

import frappe
from frappe.utils import cint

from crystal_alluminium_works.print_format_config import (
    CONFIG_DOCTYPE,
    PAYMENT_DETAILS_SECTION,
    PRINT_FORMAT_CONFIGS,
    TERMS_SECTION,
)

# The old per-field defaults, which filled any field a stored configuration lacked.
LEGACY_DEFAULTS = {
    "validity_days": 14,
    "advance_payment_percent": 100,
    "production_timeline": "All glass and aluminium orders will be ready in 2-3 days.",
    "whatsapp_notice": "If not ready, inform on WhatsApp only",
    "whatsapp_number": "0702933965",
    "collection_note": "All customers must count and collect goods prior to collection.",
    "payment_quote_no_note": "All payments must include CORRECT QUOTE NO.",
    "confirm_details_note": "Please confirm the glass sizes, number of pieces, aluminium quality, and the relevant codes before making the payment.",
    "bank_name": "I & M BANK",
    "account_name": "CRYSTAL ALUMINIUM WORKS LTD",
    "branch": "INDUSTRIAL AREA",
    "account_no": "04001484591810",
    "swift_code": "IMBLKENA",
    "paybill_no": "4051271",
    "paybill_account_no": "QUOTE NO",
    "invoice_payment_terms": "Payment is due within the stipulated time frame.",
    "ownership_note": "Goods remain the property of Crystal Aluminium Works until fully paid for.",
    "discrepancy_days": 3,
    "credit_note_purpose": "This credit note reverses the amounts shown against the original invoice.",
    "credit_note_settlement": "The credit will be applied to your account or refunded as agreed.",
}

SALES_ORDER_LEGACY_DEFAULTS = {"advance_payment_percent": 60, "final_payment_percent": 40}


def _text(values, key):
    return str(values.get(key) or "").strip()


def _legacy_terms(print_format, values):
    """The terms the old build_terms_html printed, as plain lines."""
    if print_format == "Crystal Quotation":
        whatsapp_text = _text(values, "whatsapp_notice")
        whatsapp_number = _text(values, "whatsapp_number")
        return [
            {"text": f"Quotation valid for {cint(values.get('validity_days')) or 14} days from date of issue."},
            {"text": f"{cint(values.get('advance_payment_percent')) or 100}% advance payment required to commence production."},
            {"text": _text(values, "production_timeline")},
            {"text": f"{whatsapp_text} on {whatsapp_number}." if whatsapp_number else f"{whatsapp_text}."},
            {"text": _text(values, "collection_note")},
            {"text": _text(values, "payment_quote_no_note")},
            {"text": _text(values, "confirm_details_note"), "bold": 1},
        ]
    if print_format == "Crystal Sales Order":
        return [
            {"text": "Order confirmed and locked."},
            {"text": f"Production begins upon receipt of {cint(values.get('advance_payment_percent')) or 60}% advance payment."},
            {"text": f"Final {cint(values.get('final_payment_percent')) or 40}% due upon delivery."},
        ]
    if print_format == "Crystal Sales Invoice":
        return [
            {"text": _text(values, "invoice_payment_terms")},
            {"text": _text(values, "ownership_note")},
            {"text": f"Any discrepancies must be reported within {cint(values.get('discrepancy_days')) or 3} days of delivery."},
        ]
    if print_format == "Crystal Credit Note":
        return [
            {"text": _text(values, "credit_note_purpose")},
            {"text": _text(values, "credit_note_settlement")},
        ]
    return []


def _legacy_payment_details(values):
    """The PAYMENT DETAILS lines the old build_payment_details_html printed."""
    rows = [
        ("BANK", "bank_name"),
        ("A/C", "account_name"),
        ("BRANCH", "branch"),
        ("ACCOUNT NO", "account_no"),
        ("SWIFT CODE", "swift_code"),
        ("PAYBILL NO", "paybill_no"),
        ("ACCOUNT NO", "paybill_account_no"),
    ]
    return [{"text": f"{label}: {_text(values, key)}"} for label, key in rows if _text(values, key)]


def execute():
    if not frappe.db.exists("DocType", CONFIG_DOCTYPE):
        return

    for name, configuration_json in frappe.get_all(
        CONFIG_DOCTYPE, fields=["name", "configuration_json"], as_list=True
    ):
        meta = PRINT_FORMAT_CONFIGS.get(name)
        stored = json.loads(configuration_json or "{}")
        if not meta or any(isinstance(stored.get(key), list) for key in (TERMS_SECTION, PAYMENT_DETAILS_SECTION)):
            continue  # unknown format, or already converted

        defaults = SALES_ORDER_LEGACY_DEFAULTS if name == "Crystal Sales Order" else LEGACY_DEFAULTS
        values = {**defaults, **stored}
        section_keys = [section["key"] for section in meta["sections"]]

        rows = {}
        if TERMS_SECTION in section_keys:
            rows[TERMS_SECTION] = [row for row in _legacy_terms(name, values) if row["text"]]
        if PAYMENT_DETAILS_SECTION in section_keys:
            rows[PAYMENT_DETAILS_SECTION] = _legacy_payment_details(values)

        frappe.db.set_value(
            CONFIG_DOCTYPE, name, "configuration_json", json.dumps(rows, indent=2), update_modified=False
        )
