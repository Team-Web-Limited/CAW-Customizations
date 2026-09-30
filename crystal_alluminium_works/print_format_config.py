import copy
import json

import frappe
from frappe.utils import cint, escape_html


CONFIG_DOCTYPE = "CAW Print Format Configuration"

# Each section is an ordered list of free-text lines, edited row by row on the Print Format
# Configurations page and stored as {"terms": [{"text", "bold"}], "payment_details": [...]}.
# Terms print one numbered <li> per line. Payment lines are written "LABEL: value" and print
# with the label in bold.
TERMS_SECTION = "terms"
PAYMENT_DETAILS_SECTION = "payment_details"

_PAYMENT_DETAILS_ROWS = [
    {"text": "BANK: I & M BANK"},
    {"text": "A/C: CRYSTAL ALUMINIUM WORKS LTD"},
    {"text": "BRANCH: INDUSTRIAL AREA"},
    {"text": "ACCOUNT NO: 04001484591810"},
    {"text": "SWIFT CODE: IMBLKENA"},
    {"text": "PAYBILL NO: 4051271"},
    {"text": "ACCOUNT NO: QUOTE NO"},
]


PRINT_FORMAT_CONFIGS = {
    "Crystal Quotation": {
        "doctype": "Quotation",
        "ref_label": "Quotation Reference",
        "sections": [
            {"key": TERMS_SECTION, "title": "Terms & Conditions"},
            {"key": PAYMENT_DETAILS_SECTION, "title": "Payment Details"},
        ],
        "defaults": {
            TERMS_SECTION: [
                {"text": "Quotation valid for 14 days from date of issue."},
                {"text": "100% advance payment required to commence production."},
                {"text": "All glass and aluminium orders will be ready in 2-3 days."},
                {"text": "If not ready, inform on WhatsApp only on 0702933965."},
                {"text": "All customers must count and collect goods prior to collection."},
                {"text": "All payments must include CORRECT QUOTE NO."},
                {
                    "text": "Please confirm the glass sizes, number of pieces, aluminium quality, and the relevant codes before making the payment.",
                    "bold": 1,
                },
            ],
            PAYMENT_DETAILS_SECTION: _PAYMENT_DETAILS_ROWS,
        },
    },
    "Crystal Sales Order": {
        "doctype": "Sales Order",
        "ref_label": "Order Reference",
        "sections": [
            {"key": TERMS_SECTION, "title": "Terms & Conditions"},
        ],
        "defaults": {
            TERMS_SECTION: [
                {"text": "Order confirmed and locked."},
                {"text": "Production begins upon receipt of 60% advance payment."},
                {"text": "Final 40% due upon delivery."},
            ],
        },
    },
    "Crystal Sales Invoice": {
        "doctype": "Sales Invoice",
        "ref_label": "Invoice Number",
        "sections": [
            {"key": TERMS_SECTION, "title": "Terms & Conditions"},
            {"key": PAYMENT_DETAILS_SECTION, "title": "Payment Details"},
        ],
        "defaults": {
            TERMS_SECTION: [
                {"text": "Payment is due within the stipulated time frame."},
                {"text": "Goods remain the property of Crystal Aluminium Works until fully paid for."},
                {"text": "Any discrepancies must be reported within 3 days of delivery."},
            ],
            PAYMENT_DETAILS_SECTION: _PAYMENT_DETAILS_ROWS,
        },
    },
    # Sales Invoice returns (is_return). Same layout as Crystal Sales Invoice, titled CREDIT NOTE
    # with the invoice it reverses, and no payment block — nobody pays a credit note.
    "Crystal Credit Note": {
        "doctype": "Sales Invoice",
        "ref_label": "Credit Note Number",
        "sections": [
            {"key": TERMS_SECTION, "title": "Notes"},
        ],
        "defaults": {
            TERMS_SECTION: [
                {"text": "This credit note reverses the amounts shown against the original invoice."},
                {"text": "The credit will be applied to your account or refunded as agreed."},
            ],
        },
    },
    "Crystal Job Card": {
        "doctype": "CAW Job Card",
        "ref_label": "Job Card No",
        "sections": [],
        "defaults": {},
    },
}


def _default_values(print_format):
    return copy.deepcopy((PRINT_FORMAT_CONFIGS.get(print_format) or {}).get("defaults", {}))


def _section_keys(print_format):
    return [section["key"] for section in (PRINT_FORMAT_CONFIGS.get(print_format) or {}).get("sections", [])]


def _clean_rows(rows):
    """Normalise one section's rows to [{"text", "bold"}], dropping blank lines."""
    clean = []
    for row in rows or []:
        if not isinstance(row, dict):
            row = {"text": row}
        text = str(row.get("text") or "").strip()
        if text:
            clean.append({"text": text, "bold": 1 if cint(row.get("bold")) else 0})
    return clean


def _configuration_doctype_exists():
    return frappe.db.exists("DocType", CONFIG_DOCTYPE)


def ensure_default_print_format_configurations():
    if not _configuration_doctype_exists():
        return

    for print_format, meta in PRINT_FORMAT_CONFIGS.items():
        if frappe.db.exists(CONFIG_DOCTYPE, print_format):
            continue

        doc = frappe.new_doc(CONFIG_DOCTYPE)
        doc.print_format = print_format
        doc.document_type = meta["doctype"]
        doc.configuration_json = json.dumps(_default_values(print_format), indent=2)
        doc.insert(ignore_permissions=True)


def get_print_format_configuration(print_format):
    """{section key: rows} for this print format — the saved rows where a section has been
    saved, the defaults otherwise."""
    values = _default_values(print_format)
    if _configuration_doctype_exists() and frappe.db.exists(CONFIG_DOCTYPE, print_format):
        stored = json.loads(frappe.db.get_value(CONFIG_DOCTYPE, print_format, "configuration_json") or "{}")
        for key in _section_keys(print_format):
            if isinstance(stored.get(key), list):
                values[key] = stored[key]

    return {key: _clean_rows(values.get(key)) for key in _section_keys(print_format)}


def _escape(value):
    return escape_html(str(value or ""))


def build_terms_html(print_format, values=None):
    values = values or get_print_format_configuration(print_format)
    terms = [
        f"<strong>{_escape(row['text'])}</strong>" if row["bold"] else _escape(row["text"])
        for row in _clean_rows(values.get(TERMS_SECTION))
    ]
    return (
        "<ol style=\"padding-left: 16px; margin: 0; word-wrap: break-word; overflow-wrap: break-word;\">"
        + "".join(f"<li>{term}</li>" for term in terms)
        + "</ol>"
    )


#: Payment-line values that mean "put the document's own reference number here" rather
#: than literal text — e.g. "ACCOUNT NO: QUOTE NO". Configured this way because the paybill
#: account number for these orders is, by policy, the quotation/order/invoice number itself,
#: not a fixed account.
PAYBILL_ACCOUNT_NO_DOC_NAME_PLACEHOLDERS = {
    "QUOTE NO",
    "QUOTATION NO",
    "ORDER NO",
    "INVOICE NO",
    "DOC NO",
}

# Raw Jinja so the built print format substitutes the actual document at render/download
# time. A Quotation prints just its number (SAL-QTN-2026-60057 and its amendments -> 60057):
# that is what customers type as the Paybill account and what mpesa_link._quotation_for_account
# resolves. Other documents keep their full name so an invoice number can never be mistaken
# for a quotation number.
_DOC_NUMBER_JINJA = (
    "{% if doc.doctype == 'Quotation' %}{% set account_parts = doc.name.split('-') %}"
    "{{ (account_parts[3] if account_parts|length > 3 else account_parts[-1])|int }}"
    "{% else %}{{ doc.name }}{% endif %}"
)


def _payment_line_html(text):
    label, colon, value = text.partition(":")
    if not colon:
        return f"<div>{_escape(text)}</div>"

    value = value.strip()
    if value.upper() in PAYBILL_ACCOUNT_NO_DOC_NAME_PLACEHOLDERS:
        value_html = _DOC_NUMBER_JINJA
    else:
        value_html = _escape(value)
    return f"<div><strong>{_escape(label.strip())}:</strong> {value_html}</div>"


def build_payment_details_html(print_format, values=None):
    values = values or get_print_format_configuration(print_format)
    rows = _clean_rows(values.get(PAYMENT_DETAILS_SECTION))
    if not rows:
        return ""

    row_html = "".join(_payment_line_html(row["text"]) for row in rows)
    return f"""
        <div style="font-size: 13px; color: #6c757d; margin: 12px 0 5px 0;">PAYMENT DETAILS</div>
        <div style="font-size: 14px; color: #495057; line-height: 1.5;">{row_html}</div>
    """


def get_print_format_context(print_format):
    meta = PRINT_FORMAT_CONFIGS.get(print_format) or {}
    values = get_print_format_configuration(print_format)
    return {
        "doctype": meta.get("doctype"),
        "ref_label": meta.get("ref_label"),
        "terms": build_terms_html(print_format, values),
        "payment_details": build_payment_details_html(print_format, values),
    }


@frappe.whitelist()
def get_print_format_configuration_schema():
    frappe.only_for(["System Manager", "Sales User"])
    ensure_default_print_format_configurations()
    return [
        {
            "print_format": print_format,
            "document_type": meta["doctype"],
            "sections": meta["sections"],
        }
        for print_format, meta in PRINT_FORMAT_CONFIGS.items()
    ]


@frappe.whitelist()
def get_print_format_configuration_values(print_format):
    frappe.only_for(["System Manager", "Sales User"])
    ensure_default_print_format_configurations()
    return get_print_format_configuration(print_format)


@frappe.whitelist()
def save_print_format_configuration(print_format, values):
    frappe.only_for(["System Manager", "Sales User"])
    if print_format not in PRINT_FORMAT_CONFIGS:
        frappe.throw(f"Unsupported print format: {print_format}")

    if isinstance(values, str):
        values = json.loads(values or "{}")

    clean_values = {key: _clean_rows((values or {}).get(key)) for key in _section_keys(print_format)}

    if frappe.db.exists(CONFIG_DOCTYPE, print_format):
        doc = frappe.get_doc(CONFIG_DOCTYPE, print_format)
    else:
        doc = frappe.new_doc(CONFIG_DOCTYPE)
        doc.print_format = print_format
        doc.document_type = PRINT_FORMAT_CONFIGS[print_format]["doctype"]

    doc.configuration_json = json.dumps(clean_values, indent=2)
    doc.save(ignore_permissions=True)

    from crystal_alluminium_works.create_print_format import create_crystal_print_format

    context = get_print_format_context(print_format)
    create_crystal_print_format(
        doctype=context["doctype"],
        print_format_name=print_format,
        ref_label=context["ref_label"],
        terms=context["terms"],
        payment_details=context["payment_details"],
    )
    return {"message": "Configuration saved", "print_format": print_format}
