import json

import frappe
from frappe.utils import cint, escape_html


CONFIG_DOCTYPE = "CAW Print Format Configuration"


PRINT_FORMAT_CONFIGS = {
    "Crystal Quotation": {
        "doctype": "Quotation",
        "ref_label": "Quotation Reference",
        "sections": [
            {
                "title": "Terms & Conditions",
                "fields": [
                    {"fieldname": "validity_days", "label": "Quotation Validity Days", "fieldtype": "Int"},
                    {"fieldname": "advance_payment_percent", "label": "Advance Payment Percent", "fieldtype": "Percent"},
                    {"fieldname": "production_timeline", "label": "Production Timeline", "fieldtype": "Data"},
                    {"fieldname": "whatsapp_notice", "label": "Delay Notice Text", "fieldtype": "Data"},
                    {"fieldname": "whatsapp_number", "label": "WhatsApp Number", "fieldtype": "Data"},
                    {"fieldname": "collection_note", "label": "Collection Note", "fieldtype": "Data"},
                    {"fieldname": "payment_quote_no_note", "label": "Quote Number Payment Note", "fieldtype": "Data"},
                    {"fieldname": "confirm_details_note", "label": "Confirm Details Before Payment Note", "fieldtype": "Data"},
                ],
            },
            {
                "title": "Payment Details",
                "fields": [
                    {"fieldname": "bank_name", "label": "Bank", "fieldtype": "Data"},
                    {"fieldname": "account_name", "label": "Account Name", "fieldtype": "Data"},
                    {"fieldname": "branch", "label": "Branch", "fieldtype": "Data"},
                    {"fieldname": "account_no", "label": "Account No", "fieldtype": "Data"},
                    {"fieldname": "swift_code", "label": "Swift Code", "fieldtype": "Data"},
                    {"fieldname": "paybill_no", "label": "Paybill No", "fieldtype": "Data"},
                    {"fieldname": "paybill_account_no", "label": "Paybill Account No", "fieldtype": "Data"},
                ],
            },
        ],
        "defaults": {
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
        },
    },
    "Crystal Sales Order": {
        "doctype": "Sales Order",
        "ref_label": "Order Reference",
        "sections": [
            {
                "title": "Terms & Conditions",
                "fields": [
                    {"fieldname": "advance_payment_percent", "label": "Advance Payment Percent", "fieldtype": "Percent"},
                    {"fieldname": "final_payment_percent", "label": "Final Payment Percent", "fieldtype": "Percent"},
                ],
            },
        ],
        "defaults": {
            "advance_payment_percent": 60,
            "final_payment_percent": 40,
        },
    },
    "Crystal Sales Invoice": {
        "doctype": "Sales Invoice",
        "ref_label": "Invoice Number",
        "sections": [
            {
                "title": "Terms & Conditions",
                "fields": [
                    {"fieldname": "invoice_payment_terms", "label": "Payment Terms", "fieldtype": "Data"},
                    {"fieldname": "ownership_note", "label": "Ownership Note", "fieldtype": "Data"},
                    {"fieldname": "discrepancy_days", "label": "Discrepancy Report Days", "fieldtype": "Int"},
                ],
            },
            {
                "title": "Payment Details",
                "fields": [
                    {"fieldname": "bank_name", "label": "Bank", "fieldtype": "Data"},
                    {"fieldname": "account_name", "label": "Account Name", "fieldtype": "Data"},
                    {"fieldname": "branch", "label": "Branch", "fieldtype": "Data"},
                    {"fieldname": "account_no", "label": "Account No", "fieldtype": "Data"},
                    {"fieldname": "swift_code", "label": "Swift Code", "fieldtype": "Data"},
                    {"fieldname": "paybill_no", "label": "Paybill No", "fieldtype": "Data"},
                    {"fieldname": "paybill_account_no", "label": "Paybill Account No", "fieldtype": "Data"},
                ],
            },
        ],
        "defaults": {
            "invoice_payment_terms": "Payment is due within the stipulated time frame.",
            "ownership_note": "Goods remain the property of Crystal Aluminium Works until fully paid for.",
            "discrepancy_days": 3,
            "bank_name": "I & M BANK",
            "account_name": "CRYSTAL ALUMINIUM WORKS LTD",
            "branch": "INDUSTRIAL AREA",
            "account_no": "04001484591810",
            "swift_code": "IMBLKENA",
            "paybill_no": "4051271",
            "paybill_account_no": "QUOTE NO",
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
    return (PRINT_FORMAT_CONFIGS.get(print_format) or {}).get("defaults", {}).copy()


def _get_all_fieldnames(print_format):
    fields = []
    for section in (PRINT_FORMAT_CONFIGS.get(print_format) or {}).get("sections", []):
        fields.extend(field["fieldname"] for field in section.get("fields", []))
    return fields


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
    values = _default_values(print_format)
    if _configuration_doctype_exists() and frappe.db.exists(CONFIG_DOCTYPE, print_format):
        doc = frappe.get_doc(CONFIG_DOCTYPE, print_format)
        values.update(json.loads(doc.configuration_json or "{}"))

    return values


def _escape(value):
    return escape_html(str(value or ""))


def _number(value):
    return cint(value or 0)


def build_terms_html(print_format, values=None):
    values = values or get_print_format_configuration(print_format)

    if print_format == "Crystal Quotation":
        validity_days = _number(values.get("validity_days")) or 14
        advance_payment_percent = _number(values.get("advance_payment_percent")) or 100
        whatsapp_text = _escape(values.get("whatsapp_notice"))
        whatsapp_number = _escape(values.get("whatsapp_number"))
        whatsapp_term = f"{whatsapp_text} on {whatsapp_number}." if whatsapp_number else f"{whatsapp_text}."

        terms = [
            f"Quotation valid for {validity_days} days from date of issue.",
            f"{advance_payment_percent}% advance payment required to commence production.",
            _escape(values.get("production_timeline")),
            whatsapp_term,
            _escape(values.get("collection_note")),
            _escape(values.get("payment_quote_no_note")),
            (
                f"<strong>{_escape(values.get('confirm_details_note'))}</strong>"
                if values.get("confirm_details_note")
                else ""
            ),
        ]
    elif print_format == "Crystal Sales Order":
        advance_payment_percent = _number(values.get("advance_payment_percent")) or 60
        final_payment_percent = _number(values.get("final_payment_percent")) or 40
        terms = [
            "Order confirmed and locked.",
            f"Production begins upon receipt of {advance_payment_percent}% advance payment.",
            f"Final {final_payment_percent}% due upon delivery.",
        ]
    elif print_format == "Crystal Sales Invoice":
        discrepancy_days = _number(values.get("discrepancy_days")) or 3
        terms = [
            _escape(values.get("invoice_payment_terms")),
            _escape(values.get("ownership_note")),
            f"Any discrepancies must be reported within {discrepancy_days} days of delivery.",
        ]
    else:
        terms = []

    terms = [term for term in terms if term]
    return "<ol style=\"padding-left: 16px; margin: 0;\">" + "".join(f"<li>{term}</li>" for term in terms) + "</ol>"


#: Values for "paybill_account_no" that mean "put the document's own reference
#: number here" rather than a literal label. Configured this way because the
#: paybill account number for these orders is, by policy, the quotation/order/
#: invoice number itself - not a fixed account.
PAYBILL_ACCOUNT_NO_DOC_NAME_PLACEHOLDERS = {
    "QUOTE NO",
    "QUOTATION NO",
    "ORDER NO",
    "INVOICE NO",
    "DOC NO",
}


def build_payment_details_html(print_format, values=None):
    values = values or get_print_format_configuration(print_format)

    paybill_account_no = values.get("paybill_account_no")
    if (
        paybill_account_no
        and str(paybill_account_no).strip().upper() in PAYBILL_ACCOUNT_NO_DOC_NAME_PLACEHOLDERS
    ):
        # Emit raw Jinja so the built print format substitutes the actual
        # document's name (e.g. SAL-QTN-2026-00021) at render/download time.
        paybill_account_no_html = "{{ doc.name }}"
    else:
        paybill_account_no_html = _escape(paybill_account_no)

    rows = [
        ("BANK", _escape(values.get("bank_name"))),
        ("A/C", _escape(values.get("account_name"))),
        ("BRANCH", _escape(values.get("branch"))),
        ("ACCOUNT NO", _escape(values.get("account_no"))),
        ("SWIFT CODE", _escape(values.get("swift_code"))),
        ("PAYBILL NO", _escape(values.get("paybill_no"))),
        ("ACCOUNT NO", paybill_account_no_html),
    ]
    rows = [(label, value) for label, value in rows if value]
    if not rows:
        return ""

    row_html = "".join(
        f"<div><strong>{_escape(label)}:</strong> {value}</div>"
        for label, value in rows
    )
    return f"""
        <div style="font-size: 13px; color: #6c757d; margin: 12px 0 5px 0;">PAYMENT DETAILS</div>
        <div style="font-size: 12.5px; color: #495057; line-height: 1.5;">{row_html}</div>
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
    frappe.only_for("System Manager")
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
    frappe.only_for("System Manager")
    ensure_default_print_format_configurations()
    return get_print_format_configuration(print_format)


@frappe.whitelist()
def save_print_format_configuration(print_format, values):
    frappe.only_for("System Manager")
    if print_format not in PRINT_FORMAT_CONFIGS:
        frappe.throw(f"Unsupported print format: {print_format}")

    if isinstance(values, str):
        values = json.loads(values or "{}")

    allowed_fields = set(_get_all_fieldnames(print_format))
    clean_values = {
        fieldname: values.get(fieldname)
        for fieldname in allowed_fields
    }

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
