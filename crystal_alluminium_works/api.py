import frappe
import json
import os
from frappe.model.rename_doc import rename_doc
from frappe.utils.file_manager import save_file
from frappe.utils import flt
from crystal_alluminium_works.pricing_engine import (
    CEILING_COMPONENTS,
    DEFAULT_GLASS_HOLE_TYPE,
    DEFAULT_GLASS_NOTCH_TYPE,
    DEFAULT_GLASS_POLISH_TYPE,
    GLASS_HOLE_RATE_TYPES,
    GLASS_NOTCH_RATE_TYPES,
    GLASS_POLISH_RATE_TYPES,
    GLASS_SERVICE_ITEM_DEFS,
    ensure_glass_service_items,
    ensure_ceiling_component_items,
    get_glass_service_rate,
    get_ceiling_whole_piece_qty,
    get_item_rate,
)
from crystal_alluminium_works.create_custom_fields import GLASS_SALE_MODE_OPTIONS, ITEM_GLASS_TYPE_OPTIONS
from crystal_alluminium_works.setup_glass_sheet_config import run_setup as setup_glass_sheet_config
from crystal_alluminium_works.setup_ceiling_config import create_doctype as setup_ceiling_configuration_doctype

GLASS_TYPE_OPTIONS = ["Ordinary", "Laminated", "Ready Laminated", "Toughened"]
ALUMINIUM_PRODUCT_CODE = "A01"
GLASS_CATEGORY_TO_TYPE = {
    "Ordinary Glass": "Ordinary",
    "Laminated Glass": "Laminated",
    "Ready Laminated Glass": "Ready Laminated",
    "Toughened Glass": "Toughened",
}
GLASS_TYPE_TO_PRODUCT_CODE = {
    "Ordinary": "OG",
    "Laminated": "LG",
    "Ready Laminated": "RLG",
    "Toughened": "TG",
}
CATEGORY_PRODUCT_CODES = {
    "Fittings": "F01",
    "Ceiling": "C01",
    "Rubber": "R01",
    "Silicone": "S01",
}
PRICE_TYPE_TO_PRICE_LIST = {
    "retail": "Retail",
    "wholesale": "Wholesale",
    "special": "Special",
}
ALUMINIUM_BUILDER_PRICE_LIST_MAP = {
    "Normal Price": "Retail",
    "Mill Finished Price": "Wholesale",
    "Special Price": "Special",
    "Retail": "Retail",
    "Wholesale": "Wholesale",
    "Special": "Special",
}
STANDARD_GLASS_INTERVAL_SET = "Standard Glass"
TOUGHENED_GLASS_INTERVAL_SET = "Toughened Glass"
VAT_RATE = 0.16
ALUMINIUM_PRICE_FACTOR = 1.07
SHARED_GLASS_SHEET_CONFIG_TYPE = "Ordinary"
JOB_CARD_CURRENCY_PRECISION = 2

# A Job Card's payment_option now holds the actual Mode of Payment the customer pays by, so
# the deposit account is derivable from Mode of Payment Account (no separate field). The set
# of methods is constrained by customer type per the business rules:
#   - Cash customers pay by Cash, Mpesa/Paybill, or bank transfer (RTGS/TT, PESALINK).
#   - Invoice customers pay by Cheque only.
CASH_CUSTOMER_PAYMENT_OPTIONS = ["Cash", "Paybill", "Bank Transfer i.e RTGS, TT", "PESALINK"]
INVOICE_CUSTOMER_PAYMENT_OPTIONS = ["Cheque"]


def _get_job_card_name_for_quotation(quotation_name):
    return f"JOB-CARD-{quotation_name}"


def _mark_quotation_as_converted(quotation_name):
    if quotation_name and frappe.db.exists("Quotation", quotation_name):
        frappe.db.set_value("Quotation", quotation_name, "status", "Converted", update_modified=False)


def backfill_converted_quotation_statuses():
    quotation_names = frappe.get_all(
        "CAW Job Card",
        filters={"quotation": ["is", "set"]},
        pluck="quotation",
        limit_page_length=0,
    )

    if not quotation_names:
        return 0

    quotation_names = list(dict.fromkeys(filter(None, quotation_names)))
    updated = 0

    for quotation_name in quotation_names:
        status, docstatus = frappe.db.get_value("Quotation", quotation_name, ["status", "docstatus"]) or (None, None)
        if docstatus != 1 or status != "Open":
            continue

        _mark_quotation_as_converted(quotation_name)
        updated += 1

    return updated


def _round_job_card_amount(value):
    return frappe.utils.flt(value or 0, JOB_CARD_CURRENCY_PRECISION)


# Cash-customer Job Cards require an upfront deposit of at least this share of the quotation.
CASH_JOB_CARD_DEPOSIT_RATIO = 0.5


def _get_required_cash_job_card_deposit(quotation_amount):
    return _round_job_card_amount(_round_job_card_amount(quotation_amount) * CASH_JOB_CARD_DEPOSIT_RATIO)


def _get_job_card_outstanding_balance(job_card, quotation_amount):
    quotation_amount = _round_job_card_amount(quotation_amount)
    if not job_card or job_card.get("__islocal"):
        return quotation_amount

    balance_amount = _round_job_card_amount(
        job_card.balance_amount if job_card.balance_amount is not None else quotation_amount
    )
    payment_amount = _round_job_card_amount(job_card.payment_amount)

    if balance_amount <= 0 and payment_amount < quotation_amount:
        return _round_job_card_amount(quotation_amount - payment_amount)

    return balance_amount


def _get_quotation_display_total(quotation_doc):
    subtotal = _round_job_card_amount(getattr(quotation_doc, "grand_total", 0) or 0)
    explicit_tax = _round_job_card_amount(getattr(quotation_doc, "total_taxes_and_charges", 0) or 0)
    tax_amount = explicit_tax or (subtotal * VAT_RATE)
    return _round_job_card_amount(subtotal + tax_amount)


def _resolve_quotation_chain(quotation_name):
    """Return every Quotation revision name in the amended_from chain, root first.

    Frappe names amendments <original>-1, -2 ... and links each new draft to the
    cancelled doc it came from via amended_from. The Job Card keeps its original name
    but its `quotation` link re-points to the latest revision, so any lookup that used
    to filter on a single quotation name must instead consider the whole chain."""
    if not quotation_name or not frappe.db.exists("Quotation", quotation_name):
        return []

    # Walk up to the root (oldest revision).
    root = quotation_name
    seen = {root}
    while True:
        parent = frappe.db.get_value("Quotation", root, "amended_from")
        if parent and parent not in seen and frappe.db.exists("Quotation", parent):
            seen.add(parent)
            root = parent
        else:
            break

    # Walk down collecting successors (amendments are linear: one per cancelled doc).
    chain = [root]
    cursor = root
    while True:
        successor = frappe.db.get_value("Quotation", {"amended_from": cursor}, "name")
        if not successor or successor in chain:
            break
        chain.append(successor)
        cursor = successor
    return chain


def _resolve_job_card_for_quotation(quotation_name):
    """Find the single owning Job Card across a quotation's amendment chain."""
    chain = _resolve_quotation_chain(quotation_name) or ([quotation_name] if quotation_name else [])
    if not chain:
        return None
    return frappe.db.get_value(
        "CAW Job Card",
        {"quotation": ["in", chain]},
        "name",
        order_by="creation asc",
    )


def _job_card_quotation_amendment_pending(job_card):
    """True while a quotation amendment is mid-flight: the newest revision in the chain
    is not an active (submitted) Quotation — i.e. the original was cancelled and either
    not yet amended, or the amendment draft hasn't been submitted."""
    chain = _resolve_quotation_chain(job_card.quotation if job_card else None)
    if not chain:
        return False
    return frappe.db.get_value("Quotation", chain[-1], "docstatus") != 1


def _job_card_invoice_amendment_pending(job_card):
    """True while a job-card Sales Invoice has been cancelled and has no active
    (submitted) replacement amendment yet."""
    if not job_card:
        return False
    chain = _resolve_quotation_chain(job_card.quotation) or [job_card.quotation]
    cancelled = frappe.get_all(
        "Sales Invoice",
        filters={"custom_source_quotation": ["in", chain], "docstatus": 2},
        pluck="name",
    )
    for name in cancelled:
        successor = frappe.db.get_value(
            "Sales Invoice", {"amended_from": name}, ["name", "docstatus"], as_dict=True
        )
        if not successor or successor.docstatus != 1:
            return True
    return False


def _assert_job_card_not_frozen(job_card):
    """Block money/release/edit actions while a quotation or invoice amendment is pending."""
    if _job_card_quotation_amendment_pending(job_card):
        frappe.throw(
            "This Job Card has a pending Quotation amendment. Submit or discard the amended "
            "Quotation before recording further payments, invoices or releases."
        )
    if _job_card_invoice_amendment_pending(job_card):
        frappe.throw(
            "This Job Card has a cancelled Sales Invoice awaiting amendment. Submit the amended "
            "invoice before recording further payments, invoices or releases."
        )


def _write_job_card_amendment_event(job_card, change_type, amount_paid=0, note=None):
    """Write a CAW Job Card History audit row for an amendment lifecycle event.

    The automatic history in CAWJobCard only logs positive payment deltas, so amendment
    events (which may carry a zero or negative amount) are written explicitly here."""
    if not frappe.db.exists("DocType", "CAW Job Card History"):
        return
    snapshot = {
        "quotation": job_card.quotation,
        "customer": job_card.customer,
        "customer_name": job_card.customer_name,
        "payment_mode": job_card.payment_mode,
        "payment_option": job_card.payment_option,
        "customer_pin": job_card.customer_pin,
        "phone_number": job_card.phone_number,
        "quotation_amount": job_card.quotation_amount,
        "payment_amount": job_card.payment_amount,
        "balance_amount": job_card.balance_amount,
        "status": job_card.status,
    }
    history = frappe.new_doc("CAW Job Card History")
    history.job_card = job_card.name
    history.changed_by = frappe.session.user
    history.change_type = change_type
    history.amount_paid = _round_job_card_amount(amount_paid)
    history.note = note
    history.snapshot_json = json.dumps(snapshot, default=str, indent=2)
    for fieldname, value in snapshot.items():
        history.set(fieldname, value)
    history.flags.ignore_permissions = True
    history.insert(ignore_permissions=True)


def _get_job_card_mode_of_payment(job_card, company=None):
    candidates = []
    payment_option = (job_card.payment_option or "").strip()
    if payment_option:
        # payment_option now holds the actual Mode of Payment name, so it matches directly.
        candidates.append(payment_option)
        if payment_option.lower() == "bank":  # legacy coarse value
            candidates.append("Bank Transfer i.e RTGS, TT")

    payment_mode = (job_card.payment_mode or "").strip().lower()
    candidates.append("Cash" if payment_mode == "cash customer" else "Cheque")

    existing_candidate = None
    for candidate in dict.fromkeys(candidates):
        if not candidate or not frappe.db.exists("Mode of Payment", candidate):
            continue

        if not existing_candidate:
            existing_candidate = candidate

        if company and frappe.db.get_value(
            "Mode of Payment Account",
            {"parent": candidate, "company": company},
            "default_account",
        ):
            return candidate

    if existing_candidate:
        return existing_candidate

    # No Mode of Payment is literally named "Cash"/"Bank"/etc in this company's setup
    # (e.g. only "Petty Cash" exists). Fall back to any enabled Mode of Payment whose
    # own `type` matches the job card's payment option/mode.
    payment_option_lower = payment_option.lower()
    if payment_option_lower == "paybill":
        fallback_type = "Phone"
    elif payment_option_lower == "bank" or payment_mode != "cash customer":
        fallback_type = "Bank"
    else:
        fallback_type = "Cash"

    return frappe.db.get_value("Mode of Payment", {"type": fallback_type, "enabled": 1}, "name", order_by="name asc")


def _get_job_card_payment_account(company, job_card, mode_of_payment=None):
    if mode_of_payment:
        default_account = frappe.db.get_value(
            "Mode of Payment Account",
            {"parent": mode_of_payment, "company": company},
            "default_account",
        )
        if default_account:
            return default_account

    payment_option = (job_card.payment_option or "").strip().lower()
    preferred_types = ["Cash"] if payment_option == "cash" else ["Bank"]
    fallback_types = preferred_types + [account_type for account_type in ["Bank", "Cash"] if account_type not in preferred_types]

    for account_type in fallback_types:
        account = frappe.db.get_value(
            "Account",
            {
                "company": company,
                "is_group": 0,
                "account_type": account_type,
            },
            "name",
            order_by="name asc",
        )
        if account:
            return account

    frappe.throw(f"Please configure a Cash or Bank account for company {company} before creating paid Sales Invoices.")


@frappe.whitelist()
def get_mode_of_payment_account_info(payment_method, company=None):
    if not payment_method or not frappe.db.exists("Mode of Payment", payment_method):
        return {}

    company = company or _get_default_company()
    mode_of_payment_type = frappe.db.get_value("Mode of Payment", payment_method, "type")

    default_account = None
    if company:
        default_account = frappe.db.get_value(
            "Mode of Payment Account",
            {"parent": payment_method, "company": company},
            "default_account",
        )

    account_type = frappe.db.get_value("Account", default_account, "account_type") if default_account else None

    return {
        "mode_of_payment_type": mode_of_payment_type,
        "default_account": default_account,
        "account_type": account_type,
    }


def _apply_job_card_pos_settlement(invoice, job_card):
    """Settle a fully-paid cash Job Card's draft invoice by embedding the payment
    directly on the invoice itself (POS-style), instead of creating a separate
    Payment Entry against it. The cash was already captured against the Job Card
    via the Payments doctype when it was received — no further payment should be
    recorded against the invoice."""
    outstanding_amount = flt(invoice.outstanding_amount or invoice.grand_total or 0, invoice.precision("outstanding_amount"))
    if outstanding_amount <= 0:
        return

    mode_of_payment = _get_job_card_mode_of_payment(job_card, invoice.company)
    payment_account = _get_job_card_payment_account(invoice.company, job_card, mode_of_payment)

    invoice.is_pos = 1
    invoice.set("payments", [])
    invoice.append("payments", {
        "mode_of_payment": mode_of_payment,
        "account": payment_account,
        "amount": outstanding_amount,
    })


def _force_invoice_paid_display(invoice):
    """Force a partial/full job-card invoice's paid/outstanding/status fields to read
    as fully settled, without creating a Payment Entry or POS payment row — so this
    has zero additional GL impact beyond the invoice's own submission entries. The
    Job Card, not this invoice, is the system's real record of what's been collected
    against the released items; this only keeps the invoice's own display fields from
    showing the released value as outstanding."""
    frappe.db.set_value(
        "Sales Invoice",
        invoice.name,
        {
            "paid_amount": invoice.grand_total,
            "outstanding_amount": 0,
            "status": "Paid",
        },
        update_modified=False,
    )


def _submit_and_settle_job_card_sales_invoice(invoice, job_card, preserve_payment=False, skip_payment_settlement=False):
    """preserve_payment=True is for amended invoices: the `payments` row (mode of
    payment + account) was already copied verbatim from the cancelled original via
    frappe.copy_doc, and amendment is administrative-only, so it must NOT be
    re-derived from job_card.payment_option here — that field is a coarse category
    (Cash/Paybill/Cheque/Bank) and can silently swap out the specific Mode of
    Payment that was actually used (e.g. a named bank-transfer mode), which then
    fails ERPNext's own account lookup if that specific mode has no Mode of
    Payment Account configured.

    skip_payment_settlement=True is for partial invoices: the invoice itself is never
    POS-settled (no cash/bank payment embedded, no payment GL posted) — the Job Card
    is the single source of truth for what's actually been paid. The invoice's own
    paid/outstanding fields are then force-displayed as fully settled via
    _force_invoice_paid_display so it doesn't read as an unpaid receivable; that's a
    display-only field write, not a real payment, so it adds no GL entries."""
    invoice.update_stock = 0
    invoice.set_posting_time = 1
    invoice.flags.ignore_permissions = True
    invoice.flags.ignore_mandatory = True

    if invoice.docstatus == 0:
        if not preserve_payment and not skip_payment_settlement:
            _apply_job_card_pos_settlement(invoice, job_card)
        invoice.submit()
        if skip_payment_settlement:
            _force_invoice_paid_display(invoice)

    invoice.reload()
    return invoice


def _download_crystal_pdf(doctype, name, print_format_name, ref_label, terms):
    from bs4 import BeautifulSoup
    from crystal_alluminium_works.create_print_format import (
        build_crystal_job_card_print_format_html,
        build_crystal_payment_receipt_print_format_html,
        build_crystal_print_format_html,
        embed_letterhead_image,
    )
    from crystal_alluminium_works.print_format_config import get_print_format_context
    from frappe.translate import print_language
    from frappe.utils import cstr, strip_html
    from frappe.utils.pdf import get_pdf
    from frappe.utils.jinja_globals import is_rtl
    from frappe.www.printview import get_print_style, validate_print_permission

    doc = frappe.get_doc(doctype, name)
    validate_print_permission(doc)

    pdf_options = {
        "load-error-handling": "ignore",
        "load-media-error-handling": "ignore",
        "zoom": "0.75",
    }
    context = get_print_format_context(print_format_name)
    if print_format_name == "Crystal Job Card":
        template_html = build_crystal_job_card_print_format_html()
    elif print_format_name == "Crystal Payment Receipt":
        template_html = build_crystal_payment_receipt_print_format_html()
    else:
        template_html = build_crystal_print_format_html(
            ref_label=context.get("ref_label") or ref_label,
            terms=context.get("terms") or terms,
            payment_details=context.get("payment_details") or "",
        )

    # Embed the letterhead inline as a data URI. wkhtmltopdf cannot fetch the
    # /assets/ image URL during PDF generation (ContentNotFoundError), which left
    # the logo blank here even though the stored print formats already embed it.
    template_html = embed_letterhead_image(template_html)

    with print_language(doc.get("language") or frappe.local.lang):
        body = frappe.render_template(template_html, {"doc": doc})
        html = frappe.get_template("www/printview.html").render(
            {
                "body": body,
                "print_style": get_print_style(),
                "comment": frappe.session.user,
                "title": strip_html(cstr(doc.get_title() or doc.name)),
                "lang": frappe.local.lang,
                "layout_direction": "rtl" if is_rtl() else "ltr",
                "doctype": doctype,
                "name": name,
                "key": "",
                "print_format": print_format_name,
                "letterhead": "",
                "no_letterhead": 1,
                "pdf_generator": "wkhtmltopdf",
            }
        )

    soup = BeautifulSoup(html, "html5lib")
    for stylesheet in soup.find_all("link", rel=lambda rel: rel and "stylesheet" in rel):
        href = (stylesheet.get("href") or "").split("?", 1)[0]
        if not href.startswith("/assets/"):
            continue

        css_path = os.path.join(frappe.local.sites_path, href.lstrip("/"))
        if not os.path.exists(css_path):
            continue

        style = soup.new_tag("style")
        style.string = frappe.read_file(css_path)
        stylesheet.replace_with(style)

    pdf_file = get_pdf(str(soup), options=pdf_options)

    frappe.local.response.filename = f"{name.replace(' ', '-').replace('/', '-')}.pdf"
    frappe.local.response.filecontent = pdf_file
    frappe.local.response.type = "pdf"


@frappe.whitelist()
def download_crystal_quotation_pdf(name):
    _download_crystal_pdf(
        "Quotation",
        name,
        "Crystal Quotation",
        "Quotation Reference",
        "",
    )


@frappe.whitelist()
def download_crystal_sales_invoice_pdf(name):
    _download_crystal_pdf(
        "Sales Invoice",
        name,
        "Crystal Sales Invoice",
        "Invoice Number",
        "",
    )


@frappe.whitelist()
def download_crystal_job_card_pdf(name):
    _download_crystal_pdf(
        "CAW Job Card",
        name,
        "Crystal Job Card",
        "Job Card No",
        "",
    )


@frappe.whitelist()
def download_crystal_payment_receipt_pdf(name):
    history = frappe.get_doc("CAW Job Card History", name)
    if flt(history.amount_paid) <= 0:
        frappe.throw("This entry has no payment to issue a receipt for.")

    job_card_status = frappe.db.get_value("CAW Job Card", history.job_card, "status")
    if job_card_status == "Cancelled":
        frappe.throw("Cannot print a receipt for a cancelled Job Card.")

    if not history.receipt_no:
        from frappe.model.naming import make_autoname

        # Atomic, gap-free counter via frappe's Series mechanism — first receipt
        # printed gets RCT-00001, next RCT-00002, regardless of insertion order.
        history.db_set("receipt_no", make_autoname("RCT-.#####"), update_modified=False)

    _download_crystal_pdf(
        "CAW Job Card History",
        name,
        "Crystal Payment Receipt",
        "Receipt No",
        "",
    )


def _dimension_range_has_field(fieldname):
    return frappe.db.has_column("Dimension Range", fieldname)


def _doc_has_field(doctype, fieldname):
    return frappe.get_meta(doctype).has_field(fieldname)


def _ensure_aluminium_color_storage():
    _ensure_aluminium_color_doctype()
    if _doc_has_field("Quotation Item", "custom_aluminium_color"):
        return

    from crystal_alluminium_works.create_custom_fields import add_custom_fields
    add_custom_fields()
    for doctype in ("Quotation Item", "Sales Order Item", "Sales Invoice Item"):
        frappe.clear_cache(doctype=doctype)


def _ensure_aluminium_pricing_storage():
    required_fields = (
        "custom_aluminium_rate_per_kg",
        "custom_aluminium_weight_per_length",
    )
    if all(_item_has_field(fieldname) for fieldname in required_fields):
        return

    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    create_custom_fields({
        "Item": [
            {
                "fieldname": "custom_aluminium_rate_per_kg",
                "label": "Aluminium Rate Per Kg",
                "fieldtype": "Currency",
                "default": 0,
                "insert_after": "custom_product_code",
                "depends_on": "eval:doc.item_group=='Aluminium'",
            },
            {
                "fieldname": "custom_aluminium_weight_per_length",
                "label": "Aluminium Weight Per Length",
                "fieldtype": "Float",
                "default": 0,
                "insert_after": "custom_aluminium_rate_per_kg",
                "depends_on": "eval:doc.item_group=='Aluminium'",
            },
        ]
    })
    frappe.clear_cache(doctype="Item")


def _ensure_glass_sheet_config_storage():
    setup_glass_sheet_config()


def _ensure_ceiling_configuration_storage():
    setup_ceiling_configuration_doctype()


def _ensure_glass_sale_mode_options():
    from crystal_alluminium_works.create_custom_fields import add_custom_fields

    for doctype in ("Quotation Item", "Sales Order Item", "Sales Invoice Item"):
        custom_field_name = frappe.db.exists("Custom Field", {"dt": doctype, "fieldname": "custom_glass_sale_mode"})
        if not custom_field_name:
            continue

        current_options = frappe.db.get_value("Custom Field", custom_field_name, "options") or ""
        if current_options == GLASS_SALE_MODE_OPTIONS:
            continue

        custom_field = frappe.get_doc("Custom Field", custom_field_name)
        custom_field.options = GLASS_SALE_MODE_OPTIONS
        custom_field.save(ignore_permissions=True)
        frappe.clear_cache(doctype=doctype)

    required_sheet_fields = ("custom_sheet_size", "custom_sheet_sft", "custom_sheet_pcs")
    if not all(_doc_has_field("Quotation Item", fieldname) for fieldname in required_sheet_fields):
        add_custom_fields()
        for doctype in ("Quotation Item", "Sales Order Item", "Sales Invoice Item"):
            frappe.clear_cache(doctype=doctype)


def _get_shared_glass_sheet_type():
    return SHARED_GLASS_SHEET_CONFIG_TYPE


def _ensure_glass_type_options():
    """Keep the Item custom glass type field aligned with supported values."""
    custom_field_name = frappe.db.exists("Custom Field", {"dt": "Item", "fieldname": "custom_glass_type"})
    if not custom_field_name:
        return

    options = "\n".join(GLASS_TYPE_OPTIONS)
    current_options = frappe.db.get_value("Custom Field", custom_field_name, "options") or ""
    if current_options == options:
        return

    custom_field = frappe.get_doc("Custom Field", custom_field_name)
    custom_field.options = options
    custom_field.save(ignore_permissions=True)
    frappe.clear_cache(doctype="Item")


def _item_has_field(fieldname):
    return frappe.get_meta("Item").has_field(fieldname)


def _ensure_glass_type_storage():
    if not _item_has_field("custom_glass_type"):
        from crystal_alluminium_works.create_custom_fields import add_item_custom_fields
        add_item_custom_fields()

    custom_field_name = frappe.db.exists("Custom Field", {"dt": "Item", "fieldname": "custom_glass_type"})
    if not custom_field_name:
        return

    current_options = frappe.db.get_value("Custom Field", custom_field_name, "options") or ""
    if current_options == ITEM_GLASS_TYPE_OPTIONS:
        return

    custom_field = frappe.get_doc("Custom Field", custom_field_name)
    custom_field.options = ITEM_GLASS_TYPE_OPTIONS
    custom_field.save(ignore_permissions=True)
    frappe.clear_cache(doctype="Item")


def _ensure_product_code_storage():
    if not _item_has_field("custom_product_code"):
        from crystal_alluminium_works.create_custom_fields import add_item_custom_fields
        add_item_custom_fields()


def _infer_glass_type(item_code=None, item_name=None, fallback=None):
    source = f"{item_code or ''} {item_name or ''}".lower()
    if "ready laminated" in source:
        return "Ready Laminated"
    if "toughened" in source:
        return "Toughened"
    if "laminated" in source:
        return "Laminated"
    if fallback in GLASS_TYPE_OPTIONS:
        return fallback
    return "Ordinary"


def _infer_product_code(item_group=None, item_code=None, item_name=None, glass_type=None, fallback=None):
    if fallback:
        return fallback

    item_group = (item_group or "").strip()
    if item_group == "Glass":
        if _is_glass_service_item(item_name):
            return None
        return GLASS_TYPE_TO_PRODUCT_CODE.get(_infer_glass_type(item_code, item_name, glass_type))
    if item_group == "Aluminium":
        return ALUMINIUM_PRODUCT_CODE
    return CATEGORY_PRODUCT_CODES.get(item_group)


def _get_aluminium_price_components(rate_per_kg=0, weight_per_length=0):
    normal_price = flt(rate_per_kg) * flt(weight_per_length)
    mill_finished_price = normal_price / ALUMINIUM_PRICE_FACTOR if ALUMINIUM_PRICE_FACTOR else normal_price
    special_price = normal_price * ALUMINIUM_PRICE_FACTOR
    return {
        "normal_price": flt(normal_price),
        "mill_finished_price": flt(mill_finished_price),
        "special_price": flt(special_price),
    }


def _normalize_aluminium_type(value, fallback=None):
    # Aluminium is no longer split into colored vs non-colored variants.
    return None


def _is_glass_service_item(item_name):
    item_name = (item_name or "").strip().lower()
    return any(keyword in item_name for keyword in (
        "polishing",
        "drilling",
        "sandblasting",
        "hole",
        "notching",
        "notch",
    )) 


def _invoice_uses_visual_vat(doc):
    return flt(getattr(doc, "total_taxes_and_charges", 0) or 0) == 0


def _get_invoice_display_amount(amount, doc):
    amount = flt(amount)
    return amount * (1 + VAT_RATE) if _invoice_uses_visual_vat(doc) else amount


def _get_product_code(category, glass_type=None, aluminium_type=None, item_name=None):
    storage_category = _get_storage_category(category)

    if storage_category == "Glass":
        if _is_glass_service_item(item_name):
            return None
        return GLASS_TYPE_TO_PRODUCT_CODE.get(_get_glass_type_for_category(category, glass_type))

    if storage_category == "Aluminium":
        return ALUMINIUM_PRODUCT_CODE

    return CATEGORY_PRODUCT_CODES.get(storage_category)


def _normalize_price_type(value):
    normalized = (value or "").strip().lower()
    return PRICE_TYPE_TO_PRICE_LIST.get(normalized)


def _get_selling_rate(item_code, price_list):
    item_price = frappe.db.get_value(
        "Item Price",
        {"item_code": item_code, "price_list": price_list, "selling": 1},
        "price_list_rate"
    )
    return frappe.utils.flt(item_price or frappe.get_cached_value("Item", item_code, "standard_rate") or 0.0)


def _get_builder_price_list(category, price_list):
    if category == "Aluminium":
        return ALUMINIUM_BUILDER_PRICE_LIST_MAP.get(price_list or "", "Retail")
    if category == "Ceiling":
        normalized = (price_list or "").strip().lower()
        return "Wholesale" if normalized == "wholesale" else "Retail"
    return price_list or "Retail"


def _get_item_price_rate(item_code, price_list):
    return frappe.utils.flt(
        frappe.db.get_value(
            "Item Price",
            {"item_code": item_code, "price_list": price_list, "selling": 1},
            "price_list_rate"
        ) or 0
    )


def _get_single_config_docname(doctype, item_code, original_item_code=None):
    config_name = frappe.db.get_value(doctype, {"parent_item": item_code}, "name")
    if config_name:
        return config_name

    if original_item_code and original_item_code != item_code and frappe.db.exists(doctype, original_item_code):
        return original_item_code

    return None


def _get_builder_item_by_product_code(product_code, allowed_groups=None):
    product_code = (product_code or "").strip().upper()
    if not product_code:
        frappe.throw("Product code is required for import.")

    allowed_groups = allowed_groups or ["Glass", "Aluminium"]
    has_product_code_field = _item_has_field("custom_product_code")
    filters = {"item_group": ["in", allowed_groups]}
    if has_product_code_field:
        filters["custom_product_code"] = product_code
    item_fields = ["name", "item_code", "item_name", "stock_uom", "item_group"]
    if _item_has_field("custom_glass_type"):
        item_fields.append("custom_glass_type")
    if has_product_code_field:
        item_fields.append("custom_product_code")
    items = frappe.get_all(
        "Item",
        filters=filters,
        fields=item_fields,
    )
    items = [
        item for item in items
        if not (item.get("item_group") == "Glass" and _is_glass_service_item(item.get("item_name")))
    ]
    for item in items:
        item.custom_glass_type = _infer_glass_type(item.item_code, item.item_name, item.get("custom_glass_type"))
        item.custom_product_code = _infer_product_code(
            item.item_group,
            item.item_code,
            item.item_name,
            item.custom_glass_type,
            item.get("custom_product_code"),
        )

    if not has_product_code_field:
        items = [item for item in items if (item.custom_product_code or "").strip().upper() == product_code]

    if not items:
        group_label = " or ".join(allowed_groups)
        frappe.throw(f"No {group_label} item was found for product code {product_code}.")
    if len(items) > 1:
        names = ", ".join(item.item_code for item in items)
        frappe.throw(f"Product code {product_code} matches multiple items: {names}.")

    return items[0]


def _get_builder_item_by_item_code(item_code, product_code=None, allowed_groups=None):
    item_code = (item_code or "").strip()
    if not item_code:
        frappe.throw("Item code is required for this import row.")

    item_fields = ["name", "item_code", "item_name", "stock_uom", "item_group"]
    if _item_has_field("custom_product_code"):
        item_fields.append("custom_product_code")
    if _item_has_field("custom_glass_type"):
        item_fields.append("custom_glass_type")

    item = frappe.db.get_value("Item", item_code, item_fields, as_dict=True)
    if not item:
        frappe.throw(f"No item was found for item code {item_code}.")

    item.custom_glass_type = _infer_glass_type(item.item_code, item.item_name, item.get("custom_glass_type"))
    item.custom_product_code = _infer_product_code(
        item.item_group,
        item.item_code,
        item.item_name,
        item.custom_glass_type,
        item.get("custom_product_code"),
    )

    if allowed_groups and item.item_group not in allowed_groups:
        group_label = ", ".join(allowed_groups)
        frappe.throw(f"Item code {item_code} must belong to one of: {group_label}.")

    expected_product_code = (product_code or "").strip().upper()
    if expected_product_code and (item.custom_product_code or "").strip().upper() != expected_product_code:
        frappe.throw(f"Item code {item_code} does not match product code {expected_product_code}.")

    return item


def _get_builder_aluminium_item(item_code, product_code=None):
    expected_product_code = (product_code or "").strip().upper()
    if expected_product_code and not expected_product_code.startswith("A"):
        frappe.throw(f"Product code {expected_product_code} is not valid for an aluminium row.")

    return _get_builder_item_by_item_code(item_code, expected_product_code, ["Aluminium"])


def _ensure_uom_exists(uom_name):
    """Create the UOM master on demand so item saves don't fail on missing setup."""
    uom_name = (uom_name or "").strip()
    if not uom_name or frappe.db.exists("UOM", uom_name):
        return

    frappe.get_doc({
        "doctype": "UOM",
        "uom_name": uom_name,
    }).insert(ignore_permissions=True)


def _ensure_item_group_exists(group_name):
    """Create catalog item groups on demand for new manage-items tabs."""
    group_name = (group_name or "").strip()
    if not group_name or frappe.db.exists("Item Group", group_name):
        return

    frappe.get_doc({
        "doctype": "Item Group",
        "item_group_name": group_name,
        "parent_item_group": "All Item Groups",
        "is_group": 0,
    }).insert(ignore_permissions=True)


def _ensure_price_list_exists(price_list):
    """Create selling price lists lazily so item price saves do not get skipped."""
    price_list = (price_list or "").strip()
    if not price_list or frappe.db.exists("Price List", price_list):
        return

    frappe.get_doc({
        "doctype": "Price List",
        "price_list_name": price_list,
        "buying": 0,
        "selling": 1,
        "currency": frappe.defaults.get_global_default("currency") or "KES",
    }).insert(ignore_permissions=True)


def _ensure_aluminium_color_doctype():
    if frappe.db.exists("DocType", "Aluminium Color"):
        return

    doc = frappe.get_doc({
        "doctype": "DocType",
        "name": "Aluminium Color",
        "module": "Crystal Alluminium Works",
        "custom": 0,
        "editable_grid": 1,
        "autoname": "field:color_name",
        "fields": [
            {"fieldname": "color_name", "fieldtype": "Data", "label": "Color", "reqd": 1, "in_list_view": 1, "unique": 1}
        ],
        "permissions": [{"role": "System Manager", "read": 1, "write": 1, "create": 1, "delete": 1}]
    })
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    frappe.clear_cache(doctype="Aluminium Color")


def _ensure_item_has_default_uom(item, uom_name):
    """Keep the item's conversion table aligned with its stock UOM."""
    uom_name = (uom_name or "").strip()
    if not uom_name:
        return

    current_uoms = [row.uom for row in item.get("uoms") or []]
    if uom_name not in current_uoms:
        item.append("uoms", {"uom": uom_name, "conversion_factor": 1})


def _get_category_uom(category):
    """Return the canonical UOM name used by ERPNext seed data and transactions."""
    if category == "Aluminium":
        return "Nos"
    if category in GLASS_CATEGORY_TO_TYPE or category == "Glass":
        return "Square Foot"
    if category == "Ceiling":
        return "Square Meter"
    return "Nos"


def _get_storage_category(category):
    """Map UI-facing categories to the stored ERPNext item group."""
    return "Glass" if category in GLASS_CATEGORY_TO_TYPE else category


def _get_glass_type_for_category(category, fallback=None):
    """Resolve the glass type represented by a UI category."""
    if category in GLASS_CATEGORY_TO_TYPE:
        return GLASS_CATEGORY_TO_TYPE[category]
    if fallback in GLASS_TYPE_OPTIONS:
        return fallback
    return "Ordinary"


def _get_default_company():
    """Resolve a usable company for transactions created outside standard forms."""
    company = (
        frappe.defaults.get_user_default("Company")
        or frappe.defaults.get_global_default("company")
        or frappe.db.get_single_value("Global Defaults", "default_company")
    )
    if company:
        return company

    enabled_companies = frappe.get_all("Company", filters={"disabled": 0}, pluck="name", limit=2)
    if len(enabled_companies) == 1:
        return enabled_companies[0]

    frappe.throw("Please specify Company.")


def _get_interval_set_for_glass_type(glass_type):
    glass_type = (glass_type or "").strip()
    if glass_type == "Toughened":
        return TOUGHENED_GLASS_INTERVAL_SET
    return STANDARD_GLASS_INTERVAL_SET


def _normalize_import_header(value):
    header = str(value or "").strip().lower().replace(" ", "_")
    if header == "item_code":
        return "code"
    return header


def _is_empty_import_row(row):
    return not any(str(cell or "").strip() for cell in row)


def _get_import_cell(row, index):
    if index is None or index < 0:
        return None
    return row[index] if index < len(row) else None


def _clean_import_text(value):
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value or "").strip()


def _build_xlsx_file(filename, rows):
    from frappe.utils.xlsxutils import make_xlsx

    xlsx_file = make_xlsx(rows, filename)
    file_doc = save_file(
        f"{filename}.xlsx",
        xlsx_file.getvalue(),
        dt=None,
        dn=None,
        is_private=0,
    )
    return {"file_url": file_doc.file_url, "file_name": file_doc.file_name}


def _normalize_builder_sheet_header(value):
    header = str(value or "").strip().lower().replace("(", "").replace(")", "")
    header = header.replace("/", " ").replace("-", " ").replace(".", " ")
    return "_".join(part for part in header.split() if part)


@frappe.whitelist()
def get_sales_orders_page(search=None, status=None, customer=None, from_date=None, to_date=None, page=1, page_length=20):
    page = max(int(page or 1), 1)
    page_length = min(max(int(page_length or 20), 1), 100)
    start = (page - 1) * page_length

    filters = {}
    if status and status != "All":
        filters["status"] = status
    if customer:
        filters["customer"] = customer
    if from_date:
        filters["transaction_date"] = [">=", from_date]
    if to_date:
        if "transaction_date" in filters and isinstance(filters["transaction_date"], list):
            filters["transaction_date"] = ["between", [from_date, to_date]]
        else:
            filters["transaction_date"] = ["<=", to_date]

    or_filters = None
    if search:
        search = search.strip()
        if search:
            like = f"%{search}%"
            or_filters = [
                ["Sales Order", "name", "like", like],
                ["Sales Order", "customer", "like", like],
                ["Sales Order", "customer_name", "like", like],
                ["Sales Order", "po_no", "like", like],
            ]

    fields = [
        "name",
        "customer",
        "customer_name",
        "transaction_date",
        "delivery_date",
        "grand_total",
        "currency",
        "status",
        "docstatus",
        "creation",
    ]

    rows = frappe.get_list(
        "Sales Order",
        filters=filters,
        or_filters=or_filters,
        fields=fields,
        order_by="creation desc",
        start=start,
        page_length=page_length,
    )

    count_result = frappe.get_all(
        "Sales Order",
        filters=filters,
        or_filters=or_filters,
        fields=[{"COUNT": "name", "as": "total_count"}],
    )
    total_count = (count_result[0].total_count if count_result else 0) or 0

    return {
        "rows": rows,
        "page": page,
        "page_length": page_length,
        "total_count": total_count,
        "has_next": start + len(rows) < total_count,
    }


@frappe.whitelist()
def get_quotations_page(search=None, status=None, customer=None, from_date=None, to_date=None, page=1, page_length=20):
    page = max(int(page or 1), 1)
    page_length = min(max(int(page_length or 20), 1), 100)
    start = (page - 1) * page_length

    filters = {}
    if status and status != "All":
        filters["status"] = status
    if customer:
        filters["party_name"] = customer
    if from_date:
        filters["transaction_date"] = [">=", from_date]
    if to_date:
        if "transaction_date" in filters and isinstance(filters["transaction_date"], list):
            filters["transaction_date"] = ["between", [from_date, to_date]]
        else:
            filters["transaction_date"] = ["<=", to_date]

    or_filters = None
    if search:
        search = search.strip()
        if search:
            like = f"%{search}%"
            or_filters = [
                ["Quotation", "name", "like", like],
                ["Quotation", "party_name", "like", like],
                ["Quotation", "customer_name", "like", like],
                ["Quotation", "order_type", "like", like],
            ]

    fields = [
        "name",
        "party_name",
        "customer_name",
        "transaction_date",
        "valid_till",
        "grand_total",
        "currency",
        "status",
        "docstatus",
        "creation",
    ]

    rows = frappe.get_list(
        "Quotation",
        filters=filters,
        or_filters=or_filters,
        fields=fields,
        order_by="creation desc",
        start=start,
        page_length=page_length,
    )

    count_result = frappe.get_all(
        "Quotation",
        filters=filters,
        or_filters=or_filters,
        fields=[{"COUNT": "name", "as": "total_count"}],
    )
    total_count = (count_result[0].total_count if count_result else 0) or 0

    return {
        "rows": rows,
        "page": page,
        "page_length": page_length,
        "total_count": total_count,
        "has_next": start + len(rows) < total_count,
    }


@frappe.whitelist()
def get_sales_invoices_page(search=None, status=None, customer=None, from_date=None, to_date=None, page=1, page_length=20, payment_mode=None):
    page = max(int(page or 1), 1)
    page_length = min(max(int(page_length or 20), 1), 100)
    start = (page - 1) * page_length

    filters = {}
    if status and status != "All":
        filters["status"] = status
    if customer:
        filters["customer"] = customer
    if from_date:
        filters["posting_date"] = [">=", from_date]
    if to_date:
        if "posting_date" in filters and isinstance(filters["posting_date"], list):
            filters["posting_date"] = ["between", [from_date, to_date]]
        else:
            filters["posting_date"] = ["<=", to_date]

    if payment_mode:
        # Cash vs Cheque is the Job Card's own payment_mode (Cash Customer / Invoice
        # Customer) — not a Payment Entry against the invoice, since payments are
        # recorded against the Job Card, never against the Sales Invoice itself.
        job_card_payment_mode = {"Cash": "Cash Customer", "Cheque": "Invoice Customer"}.get(payment_mode)
        if job_card_payment_mode:
            matching_quotations = frappe.get_all(
                "CAW Job Card",
                filters={"payment_mode": job_card_payment_mode, "quotation": ["is", "set"]},
                pluck="quotation",
            )
            filters["custom_source_quotation"] = ["in", matching_quotations] if matching_quotations else ["=", ""]

    or_filters = None
    if search:
        search = search.strip()
        if search:
            like = f"%{search}%"
            or_filters = [
                ["Sales Invoice", "name", "like", like],
                ["Sales Invoice", "customer", "like", like],
                ["Sales Invoice", "customer_name", "like", like],
                ["Sales Invoice", "custom_source_quotation", "like", like],
                ["Sales Invoice", "remarks", "like", like],
            ]

    fields = [
        "name",
        "customer",
        "customer_name",
        "posting_date",
        "due_date",
        "grand_total",
        "total_taxes_and_charges",
        "outstanding_amount",
        "currency",
        "status",
        "docstatus",
        "custom_source_quotation",
        "update_stock",
        "creation",
        "customer.tax_id as pin",
    ]

    rows = frappe.get_list(
        "Sales Invoice",
        filters=filters,
        or_filters=or_filters,
        fields=fields,
        order_by="creation desc",
        start=start,
        page_length=page_length,
    )

    count_result = frappe.get_all(
        "Sales Invoice",
        filters=filters,
        or_filters=or_filters,
        fields=[{"COUNT": "name", "as": "total_count"}],
    )
    total_count = (count_result[0].total_count if count_result else 0) or 0

    return {
        "rows": rows,
        "page": page,
        "page_length": page_length,
        "total_count": total_count,
        "has_next": start + len(rows) < total_count,
    }


@frappe.whitelist()
def get_customer_manager_customers(search=None, customer_type="all", page=1, page_length=30):
    search = (search or "").strip()
    customer_type = (customer_type or "all").strip().lower()
    page = max(frappe.utils.cint(page or 1), 1)
    page_length = min(max(frappe.utils.cint(page_length or 30), 1), 100)
    offset = (page - 1) * page_length

    conditions = []
    params = {
        "limit": page_length + 1,
        "offset": offset,
    }

    if search:
        params["search"] = f"%{search}%"
        conditions.append("(name LIKE %(search)s OR customer_name LIKE %(search)s OR IFNULL(tax_id, '') LIKE %(search)s)")

    if customer_type == "invoice":
        conditions.append("custom_customer_billing_type = 'Invoice Customer'")
    elif customer_type == "cash":
        conditions.append("custom_customer_billing_type = 'Cash Customer'")

    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    total_count = frappe.db.sql(
        f"""
        SELECT COUNT(*) AS total
        FROM `tabCustomer`
        {where_sql}
        """,
        params,
        as_dict=True,
    )[0].total
    rows = frappe.db.sql(
        f"""
        SELECT
            name,
            customer_name,
            tax_id,
            COALESCE(NULLIF(TRIM(mobile_no), ''), '') AS phone_number,
            custom_customer_billing_type AS customer_type
        FROM `tabCustomer`
        {where_sql}
        ORDER BY creation DESC
        LIMIT %(limit)s OFFSET %(offset)s
        """,
        params,
        as_dict=True,
    )

    return {
        "rows": rows[:page_length],
        "has_more": len(rows) > page_length,
        "page": page,
        "page_length": page_length,
        "total_count": total_count,
    }


def _get_customer_registration_default(doctype, preferred_name):
    if preferred_name and frappe.db.exists(doctype, preferred_name):
        is_group = frappe.db.get_value(doctype, preferred_name, "is_group")
        if not is_group:
            return preferred_name

    return frappe.db.get_value(doctype, {"is_group": 0}, "name", order_by="creation asc")


@frappe.whitelist()
def get_customer_registration_defaults():
    return {
        "customer_group": _get_customer_registration_default(
            "Customer Group",
            frappe.db.get_single_value("Selling Settings", "customer_group") or "Commercial",
        ),
        "territory": _get_customer_registration_default(
            "Territory",
            frappe.db.get_single_value("Selling Settings", "territory") or "Kenya",
        ),
        "country": frappe.defaults.get_global_default("country") or "Kenya",
    }


@frappe.whitelist()
def register_customer(
    customer_name,
    customer_billing_type,
    customer_type="Company",
    customer_group=None,
    territory=None,
    tax_id=None,
    mobile_no=None,
    email_id=None,
    first_name=None,
    last_name=None,
    address_line1=None,
    address_line2=None,
    city=None,
    state=None,
    pincode=None,
    country=None,
    customer_details=None,
):
    if not frappe.has_permission("Customer", "create"):
        frappe.throw("You do not have permission to create Customers.", frappe.PermissionError)

    customer_name = (customer_name or "").strip()
    if not customer_name:
        frappe.throw("Customer Name is required.")

    customer_billing_type = (customer_billing_type or "").strip()
    if customer_billing_type not in {"Invoice Customer", "Cash Customer"}:
        frappe.throw("Customer Type must be Invoice Customer or Cash Customer.")

    customer_type = (customer_type or "Company").strip()
    if customer_type not in {"Company", "Individual", "Partnership"}:
        frappe.throw("Entity Type must be Company, Individual, or Partnership.")

    defaults = get_customer_registration_defaults()
    customer_group = (customer_group or defaults.get("customer_group") or "").strip()
    territory = (territory or defaults.get("territory") or "").strip()
    if not customer_group or not frappe.db.exists("Customer Group", {"name": customer_group, "is_group": 0}):
        frappe.throw("Please select a valid Customer Group.")
    if not territory or not frappe.db.exists("Territory", {"name": territory, "is_group": 0}):
        frappe.throw("Please select a valid Territory.")

    # Country is pre-filled in the dialog, so it must not by itself mean that
    # the user intended to create an Address record.
    address_values = [address_line1, address_line2, city, state, pincode]
    if any((value or "").strip() for value in address_values):
        if not (address_line1 or "").strip():
            frappe.throw("Address Line 1 is required when capturing an address.")
        if not (city or "").strip():
            frappe.throw("City is required when capturing an address.")
        if not (country or "").strip():
            frappe.throw("Country is required when capturing an address.")

    doc = frappe.get_doc(
        {
            "doctype": "Customer",
            "customer_name": customer_name,
            "customer_type": customer_type,
            "custom_customer_billing_type": customer_billing_type,
            "customer_group": customer_group,
            "territory": territory,
            "tax_id": (tax_id or "").strip(),
            "mobile_no": (mobile_no or "").strip(),
            "email_id": (email_id or "").strip(),
            "first_name": (first_name or "").strip(),
            "last_name": (last_name or "").strip(),
            "address_line1": (address_line1 or "").strip(),
            "address_line2": (address_line2 or "").strip(),
            "city": (city or "").strip(),
            "state": (state or "").strip(),
            "pincode": (pincode or "").strip(),
            "country": (country or "").strip(),
            "customer_details": (customer_details or "").strip(),
        }
    )
    doc.insert()

    return {
        "name": doc.name,
        "customer_name": doc.customer_name,
        "customer_billing_type": doc.custom_customer_billing_type,
    }


@frappe.whitelist()
def search_builder_customers(doctype, txt, searchfield, start, page_len, filters):
    txt = (txt or "").strip()
    filters = frappe.parse_json(filters) if isinstance(filters, str) else (filters or {})
    payment_mode = (filters.get("payment_mode") or "invoice").strip().lower()
    page_len = max(frappe.utils.cint(page_len or 20), 1)
    start = max(frappe.utils.cint(start or 0), 0)

    conditions = []
    params = {
        "start": start,
        "page_len": page_len,
    }

    if txt:
        params["txt"] = f"%{txt}%"
        conditions.append("(name LIKE %(txt)s OR customer_name LIKE %(txt)s OR IFNULL(tax_id, '') LIKE %(txt)s)")

    if payment_mode == "cash":
        conditions.append("IFNULL(TRIM(tax_id), '') = ''")
    else:
        conditions.append("IFNULL(TRIM(tax_id), '') != ''")

    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    return frappe.db.sql(
        f"""
        SELECT
            name,
            customer_name
        FROM `tabCustomer`
        {where_sql}
        ORDER BY
            CASE
                WHEN name = %(txt_exact)s THEN 0
                WHEN customer_name = %(txt_exact)s THEN 1
                ELSE 2
            END,
            creation DESC
        LIMIT %(start)s, %(page_len)s
        """,
        {
            **params,
            "txt_exact": txt,
        },
    )


@frappe.whitelist()
def create_job_card_from_quotation(quotation, customer, customer_name=None, payment_mode=None,
                                   payment_option=None, customer_pin=None, phone_number=None, quotation_amount=0,
                                   payment_amount=0, balance_amount=None):
    if not quotation or not frappe.db.exists("Quotation", quotation):
        frappe.throw("Please select a valid Quotation.")
    if not customer or not frappe.db.exists("Customer", customer):
        frappe.throw("Please select a valid Customer.")

    quotation_doc = frappe.get_doc("Quotation", quotation)
    customer_doc = frappe.get_doc("Customer", customer)
    payment_mode = "Cash Customer" if (payment_mode or "").strip().lower() in ("cash", "cash customer") else "Invoice Customer"
    payment_option = (payment_option or "").strip()
    if payment_option.lower() == "bank":  # legacy coarse value → real Mode of Payment
        payment_option = "Bank Transfer i.e RTGS, TT"
    valid_payment_options = (
        CASH_CUSTOMER_PAYMENT_OPTIONS if payment_mode == "Cash Customer" else INVOICE_CUSTOMER_PAYMENT_OPTIONS
    )
    if payment_option not in valid_payment_options:
        payment_option = valid_payment_options[0]
    quotation_amount = _round_job_card_amount(quotation_amount or _get_quotation_display_total(quotation_doc) or 0)
    payment_amount = _round_job_card_amount(payment_amount)
    target_job_card_name = _get_job_card_name_for_quotation(quotation_doc.name)

    # Resolve across the amendment chain so an amended quotation still finds and reuses
    # the original Job Card (its name stays stable; only its `quotation` link re-points).
    existing_job_card = _resolve_job_card_for_quotation(quotation_doc.name)

    if existing_job_card:
        job_card = frappe.get_doc("CAW Job Card", existing_job_card)
        target_job_card_name = job_card.name  # keep the original, stable Job Card number
    elif frappe.db.exists("CAW Job Card", target_job_card_name):
        job_card = frappe.get_doc("CAW Job Card", target_job_card_name)
    else:
        job_card = frappe.new_doc("CAW Job Card")
        job_card.quotation = quotation_doc.name
        job_card.status = "Draft"

    if not job_card.get("__islocal"):
        _assert_job_card_not_frozen(job_card)

    # Create/Edit Job Card is the only place a Cash Customer's payment_amount/balance_amount
    # (and Payment History) ever changes. Invoices — partial or full — only ever track
    # released items, never payments, for either customer type, so this must stay open for
    # further deposits even after a Sales Invoice already exists; otherwise a cash customer
    # who hadn't fully paid before their first release could never reach a zero balance.
    #
    # Invoice customers' money is recorded through the Payments page instead (see
    # record_customer_payment / _sync_job_card_balance_from_payments) — never through this
    # endpoint, and never through an invoice.
    if not job_card.get("__islocal") and payment_amount > 0 and payment_mode != "Cash Customer":
        frappe.throw("Payments for invoice customers are recorded on the Payments page, not the Job Card.")

    payment_limit = _get_job_card_outstanding_balance(job_card, quotation_amount)
    paid_to_date = 0 if job_card.get("__islocal") else _round_job_card_amount(quotation_amount - payment_limit)

    if payment_amount < 0:
        frappe.throw("Payment amount cannot be less than zero.")
    if job_card.get("__islocal") and payment_mode == "Cash Customer":
        if payment_amount <= 0:
            frappe.throw("Please enter a payment amount to create a job card for a cash customer.")
        required_deposit = _get_required_cash_job_card_deposit(quotation_amount)
        if required_deposit - payment_amount > 0.009:
            frappe.throw(
                f"Cash customer Job Cards require an initial payment of at least 50% of the "
                f"quotation amount ({frappe.utils.fmt_money(required_deposit)})."
            )
    if payment_amount > payment_limit:
        frappe.throw(f"Payment amount cannot exceed the current balance amount of {frappe.utils.fmt_money(payment_limit)}.")

    balance_amount = _round_job_card_amount(payment_limit - payment_amount)
    paid_amount = _round_job_card_amount(paid_to_date + payment_amount)

    job_card.quotation = quotation_doc.name
    job_card.customer = customer_doc.name
    job_card.customer_name = customer_name or customer_doc.customer_name or customer_doc.name
    job_card.payment_mode = payment_mode
    job_card.payment_option = payment_option
    job_card.customer_pin = customer_pin if customer_pin is not None else (customer_doc.get("tax_id") or "")
    job_card.phone_number = phone_number if phone_number is not None else (customer_doc.get("mobile_no") or customer_doc.get("phone") or customer_doc.get("primary_mobile_no") or "")
    job_card.quotation_amount = quotation_amount
    job_card.payment_amount = paid_amount
    job_card.balance_amount = balance_amount

    is_new_job_card = bool(job_card.get("__islocal"))

    if is_new_job_card:
        job_card.insert(ignore_permissions=True, set_name=target_job_card_name)
    else:
        job_card.save(ignore_permissions=True)
        if job_card.name != target_job_card_name and not frappe.db.exists("CAW Job Card", target_job_card_name):
            job_card.name = rename_doc(
                "CAW Job Card",
                job_card.name,
                target_job_card_name,
                force=True,
                ignore_permissions=True,
                show_alert=False,
            )

    _mark_quotation_as_converted(quotation_doc.name)

    return job_card.name


@frappe.whitelist()
def get_job_cards_page(search=None, status=None, page=1, page_length=30):
    page = max(frappe.utils.cint(page or 1), 1)
    page_length = min(max(frappe.utils.cint(page_length or 30), 1), 100)
    start = (page - 1) * page_length

    filters = {}
    if status and status != "All":
        filters["status"] = status

    or_filters = None
    search = (search or "").strip()
    if search:
        like = f"%{search}%"
        or_filters = [
            ["CAW Job Card", "name", "like", like],
            ["CAW Job Card", "quotation", "like", like],
            ["CAW Job Card", "customer", "like", like],
            ["CAW Job Card", "customer_name", "like", like],
        ]

    rows = frappe.get_list(
        "CAW Job Card",
        filters=filters,
        or_filters=or_filters,
        fields=[
            "name",
            "quotation",
            "customer",
            "customer_name",
            "payment_mode",
            "payment_option",
            "quotation_amount",
            "payment_amount",
            "balance_amount",
            "status",
            "creation",
        ],
        order_by="creation desc",
        start=start,
        page_length=page_length,
    )

    count_result = frappe.get_all(
        "CAW Job Card",
        filters=filters,
        or_filters=or_filters,
        fields=[{"COUNT": "name", "as": "total_count"}],
    )
    total_count = (count_result[0].total_count if count_result else 0) or 0

    return {
        "rows": rows,
        "page": page,
        "page_length": page_length,
        "total_count": total_count,
        "has_next": start + len(rows) < total_count,
    }


@frappe.whitelist()
def get_job_card_detail(name):
    if not name or not frappe.db.exists("CAW Job Card", name):
        frappe.throw("Please select a valid Job Card.")

    job_card = frappe.get_doc("CAW Job Card", name)
    quotation = None
    if job_card.quotation and frappe.db.exists("Quotation", job_card.quotation):
        quotation = frappe.get_doc("Quotation", job_card.quotation)

    # Show payment events (amount_paid > 0) plus amendment lifecycle events, which may
    # carry a zero or negative amount.
    history = frappe.get_all(
        "CAW Job Card History",
        filters={"job_card": job_card.name},
        or_filters=[
            ["amount_paid", ">", 0],
            ["change_type", "in", ["Quotation Amended", "Invoice Cancelled", "Invoice Amended", "Refunded", "Cancelled"]],
        ],
        fields=[
            "name",
            "change_type",
            "changed_by",
            "creation",
            "payment_mode",
            "payment_option",
            "amount_paid",
            "payment_amount",
            "balance_amount",
            "status",
            "note",
        ],
        order_by="creation desc",
        limit_page_length=0,
    )

    sales_invoices = []
    if job_card.quotation:
        quotation_chain = _resolve_quotation_chain(job_card.quotation) or [job_card.quotation]
        sales_invoices = frappe.get_all(
            "Sales Invoice",
            filters={"custom_source_quotation": ["in", quotation_chain]},
            fields=["name", "status", "docstatus", "amended_from", "custom_is_partial"],
            order_by="creation desc",
            limit_page_length=0,
        )

    released_items = frappe.get_all(
        "CAW Job Card Release",
        filters={"job_card": job_card.name},
        fields=[
            "name",
            "sales_invoice",
            "quotation_item",
            "item_code",
            "item_name",
            "category",
            "qty_released",
            "uom",
            "amount",
            "is_partial",
            "changed_by",
            "creation",
        ],
        order_by="creation desc",
        limit_page_length=0,
    )

    if released_items and quotation:
        full_qty_by_row = {
            row.name: _get_partial_row_native_full(row) for row in quotation.items
        }
        # Running balance per item: full qty minus cumulative qty released so far,
        # walked oldest-to-newest since `qty_released` on each entry is per-event, not cumulative.
        cumulative_by_row = {}
        for entry in sorted(released_items, key=lambda e: e.creation):
            row_name = entry.quotation_item
            full_qty = full_qty_by_row.get(row_name)
            if full_qty is None:
                entry["balance_qty"] = None
                continue
            cumulative_by_row[row_name] = cumulative_by_row.get(row_name, 0) + flt(entry.qty_released)
            entry["balance_qty"] = full_qty - cumulative_by_row[row_name]

    stock_deductions = []
    import json

    # 1. Fetch "Saved" (planned but not yet deducted) sheets from job_card.custom_sheet_consumption_json
    if job_card.custom_sheet_consumption_json:
        try:
            saved_data = json.loads(job_card.custom_sheet_consumption_json)
            # Map quotation_item to item_code/uom
            item_map = {item.name: item for item in quotation.items} if quotation else {}
            for row_name, sheets in saved_data.items():
                item = item_map.get(row_name)
                if not item:
                    continue
                
                is_laminated = frappe.db.get_value("Item", item.item_code, "custom_glass_type") == "Laminated"
                repack_entry_name = ""
                repack_posting_date = ""
                repack_posting_time = ""
                
                if is_laminated:
                    se_doc = frappe.db.get_value(
                        "Stock Entry",
                        {"remarks": ["like", f"%Repacked for CAW Job Card: {job_card.name} Row: {row_name}%"], "docstatus": 1},
                        ["name", "posting_date", "posting_time"], as_dict=True
                    )
                else:
                    se_doc = frappe.db.get_value(
                        "Stock Entry",
                        {"remarks": ["like", f"%Deducted for CAW Job Card: {job_card.name} Row: {row_name}%"], "docstatus": 1},
                        ["name", "posting_date", "posting_time"], as_dict=True
                    )
                
                if se_doc:
                    repack_entry_name = se_doc.name
                    repack_posting_date = str(se_doc.posting_date)
                    repack_posting_time = str(se_doc.posting_time)

                # Group sheets by item_consumed
                sheets_by_item = {}
                for sheet in sheets:
                    itm = sheet.get("item_consumed") or item.item_code
                    if itm not in sheets_by_item:
                        sheets_by_item[itm] = []
                    sheets_by_item[itm].append(sheet)

                configs = frappe.cache().get_value("glass_sheet_configs") or []
                if not configs:
                    configs = get_glass_sheet_configs()

                for itm, itm_sheets in sheets_by_item.items():
                    sft_release_qty = 0
                    sheets_str = ", ".join([f"{s.get('size')} ({frappe.utils.flt(s.get('pcs')):.0f} pcs)" for s in itm_sheets])
                    for sheet in itm_sheets:
                        size = sheet.get("size")
                        pcs = frappe.utils.flt(sheet.get("pcs"))
                        sft_per_sheet = next((frappe.utils.flt(c.get("sft")) for c in configs if c.get("size") == size), 0)
                        sft_release_qty += sft_per_sheet * pcs
                    
                    stock_deductions.append({
                        "name": repack_entry_name,
                        "posting_date": repack_posting_date,
                        "posting_time": repack_posting_time,
                        "saved_on": str(job_card.modified),
                        "quotation_item_code": item.item_code,
                        "quotation_item_name": item.item_name or item.item_code,
                        "item_code": itm,
                        "qty": sft_release_qty,
                        "uom": "SFT",
                        "sheets_consumed": sheets_str,
                        "status": "Deducted" if repack_entry_name else "Saved",
                        "category": "Glass",
                    })
        except Exception:
            pass

    # 2. Fetch "Deducted" items from Stock Entries, across every product category
    # Build a lookup: deducted item_code → quotation item_code/name/category via CAW Job Card Release
    job_card_releases = frappe.get_all(
        "CAW Job Card Release",
        filters={"job_card": job_card.name},
        fields=["item_code", "item_name", "category"],
        limit_page_length=0,
    )
    # Map deducted item_code → quotation item (first match wins)
    release_map = {}
    for rel_row in job_card_releases:
        if rel_row.item_code and rel_row.item_code not in release_map:
            release_map[rel_row.item_code] = {
                "quotation_item_code": rel_row.item_code,
                "quotation_item_name": rel_row.item_name or rel_row.item_code,
                "category": rel_row.category or "",
            }
    entries = frappe.get_all(
        "Stock Entry",
        filters=[
            ["remarks", "like", f"%Deducted for CAW Job Card: {name}%"],
            ["remarks", "not like", "%Row:%"],
            ["docstatus", "=", 1]
        ],
        fields=["name", "posting_date", "posting_time"]
    )
    for entry in entries:
        st_items = frappe.get_all(
            "Stock Entry Detail",
            filters={"parent": entry.name},
            fields=["item_code", "qty", "uom", "description"]
        )
        for item in st_items:
            sheets_str = ""
            if item.description and "Sheets Consumed: " in item.description:
                idx = item.description.find("Sheets Consumed: ") + len("Sheets Consumed: ")
                raw_json = item.description[idx:].strip()
                if "\n" in raw_json:
                    raw_json = raw_json.split("\n")[0].strip()
                try:
                    sheets_data = json.loads(raw_json)
                    if isinstance(sheets_data, list):
                        sheets_str = ", ".join([f"{s.get('size')} ({frappe.utils.flt(s.get('pcs')):.0f} pcs)" for s in sheets_data])
                    else:
                        sheets_str = raw_json
                except Exception:
                    sheets_str = raw_json

            rel = release_map.get(item.item_code, {})
            stock_deductions.append({
                "name": entry.name,
                "posting_date": str(entry.posting_date),
                "posting_time": str(entry.posting_time),
                "saved_on": "",
                "quotation_item_code": rel.get("quotation_item_code", item.item_code),
                "quotation_item_name": rel.get("quotation_item_name", ""),
                "item_code": item.item_code,
                "qty": frappe.utils.flt(item.qty),
                "uom": item.uom or "",
                "sheets_consumed": sheets_str,
                "status": "Deducted",
                "category": rel.get("category", ""),
            })

    return {
        "job_card": {
            "name": job_card.name,
            "quotation": job_card.quotation,
            "customer": job_card.customer,
            "customer_name": job_card.customer_name,
            "payment_mode": job_card.payment_mode,
            "payment_option": job_card.payment_option,
            "customer_pin": job_card.customer_pin,
            "phone_number": job_card.phone_number,
            "quotation_amount": job_card.quotation_amount,
            "payment_amount": job_card.payment_amount,
            "balance_amount": job_card.balance_amount,
            "status": job_card.status,
            "creation": job_card.creation,
            "modified": job_card.modified,
            "custom_sheet_consumption_json": job_card.custom_sheet_consumption_json,
        },
        "quotation": {
            "name": quotation.name,
            "transaction_date": quotation.transaction_date,
            "valid_till": quotation.valid_till,
            "status": quotation.status,
            "currency": quotation.currency,
            "grand_total": quotation.grand_total,
            "rounded_total": quotation.rounded_total,
            "has_releasable_items": _quotation_has_releasable_items(quotation),
            "items": [
                {
                    "name": item.name,
                    "item_code": item.item_code,
                    "item_name": item.item_name,
                    "qty": item.qty,
                    "uom": item.uom,
                    "custom_product_category": item.custom_product_category,
                    "custom_glass_sale_mode": item.custom_glass_sale_mode,
                    "custom_numbering": item.custom_numbering,
                    "custom_glass_type": frappe.db.get_value("Item", item.item_code, "custom_glass_type")
                }
                for item in quotation.items
            ]
        } if quotation else None,
        "history": history,
        "sales_invoices": sales_invoices,
        "released_items": released_items,
        "stock_deductions": stock_deductions,
        "quotation_amendment_pending": _job_card_quotation_amendment_pending(job_card),
        "invoice_amendment_pending": _job_card_invoice_amendment_pending(job_card),
    }


@frappe.whitelist()
def get_job_card_cancel_eligibility(job_card_name):
    if not job_card_name or not frappe.db.exists("CAW Job Card", job_card_name):
        return {"can_cancel": False, "reasons": ["Job Card not found."], "needs_refund": False, "refund_amount": 0}

    job_card = frappe.get_doc("CAW Job Card", job_card_name)
    reasons = []

    if job_card.status == "Cancelled":
        reasons.append("This Job Card is already cancelled.")

    if job_card.quotation:
        quotation_chain = _resolve_quotation_chain(job_card.quotation) or [job_card.quotation]
        if frappe.db.exists(
            "Sales Invoice", {"custom_source_quotation": ["in", quotation_chain], "docstatus": 1}
        ):
            reasons.append("A Sales Invoice has already been raised from this Job Card.")

    if frappe.db.exists("CAW Job Card Release", {"job_card": job_card.name}):
        reasons.append("Items have already been released against this Job Card.")

    if frappe.db.exists(
        "Stock Entry",
        [["remarks", "like", f"%for CAW Job Card: {job_card.name}%"], ["docstatus", "=", 1]],
    ):
        reasons.append("Stock has already been deducted for this Job Card.")

    reasons = list(dict.fromkeys(reasons))
    refund_amount = _round_job_card_amount(job_card.payment_amount)
    needs_refund = refund_amount > 0
    return {
        "can_cancel": not reasons and not needs_refund,
        "reasons": reasons,
        "needs_refund": needs_refund,
        "refund_amount": refund_amount,
    }


@frappe.whitelist()
def cancel_job_card(job_card_name):
    eligibility = get_job_card_cancel_eligibility(job_card_name)
    if eligibility["reasons"]:
        frappe.throw("Cannot cancel this Job Card: " + " ".join(eligibility["reasons"]))
    if eligibility["needs_refund"]:
        frappe.throw("Refund the recorded payment before cancelling this Job Card.")

    job_card = frappe.get_doc("CAW Job Card", job_card_name)
    job_card.status = "Cancelled"
    job_card.flags.ignore_permissions = True
    job_card.save(ignore_permissions=True)
    _write_job_card_amendment_event(job_card, "Cancelled")
    return job_card.name


@frappe.whitelist()
def create_quotation_from_builder(
    customer,
    items,
    quotation_name=None,
    price_adjustment_type=None,
    price_adjustment_percent=None,
):
    """
    Creates or updates a Draft Quotation from the Quotation Builder payload.
    Items is a JSON string of the builder's item list.
    Each item carries its own price_list for per-item pricing.
    The standard on_validate hook in quotation_handler.py will
    auto-generate glass service rows when the quotation is saved.

    If quotation_name is provided, the existing quotation is updated
    instead of creating a new one (used by the "Edit in Builder" flow).

    price_adjustment_type/percent record the Builder's global +/- % rate
    adjustment so re-opening the quotation via "Edit in Builder" restores
    the same mode and percentage instead of losing it.
    """
    items = json.loads(items) if isinstance(items, str) else items
    
    if not items:
        frappe.throw("Please add at least one item.")

    if any(item.get("category") == "Aluminium" for item in items):
        _ensure_aluminium_color_storage()
    if any(item.get("category") == "Glass" for item in items):
        _ensure_glass_sale_mode_options()
    
    # Use the first item's selected selling price as the quotation-level default.
    default_price_list = _get_builder_price_list(
        items[0].get("category", ""),
        items[0].get("price_list", "Retail"),
    ) if items else "Retail"
    company = _get_default_company()

    if quotation_name:
        # ── Update existing quotation ──
        quo = frappe.get_doc("Quotation", quotation_name)
        if quo.docstatus != 0:
            frappe.throw("Only Draft quotations can be edited via the Builder.")
        quo.party_name = customer
        quo.company = quo.company or company
        quo.selling_price_list = default_price_list
        quo.items = []  # Clear existing items — they'll be rebuilt below
    else:
        # ── Create new quotation ──
        quo = frappe.get_doc({
            "doctype": "Quotation",
            "quotation_to": "Customer",
            "party_name": customer,
            "company": company,
            "selling_price_list": default_price_list,
            "items": []
        })

    quo.custom_price_adjustment_type = price_adjustment_type or ""
    quo.custom_price_adjustment_percent = frappe.utils.flt(price_adjustment_percent or 0)

    for item in items:
        category = item.get("category", "")
        if category == "Ceiling":
            enforced_price_list = "Wholesale" if item.get("ceiling_mode") == "bundle" else "Retail"
            row_price_list = _get_builder_price_list(category, enforced_price_list)
        else:
            row_price_list = _get_builder_price_list(category, item.get("price_list"))
        row_data = {
            "item_code": item.get("item_code"),
            "qty": item.get("qty", 1),
            "rate": frappe.utils.flt(item.get("rate", 0)) / 1.16,
            "custom_price_list": row_price_list,
            "custom_product_category": category,
        }

        if item.get("description"):
            row_data["description"] = item.get("description")
        
        # Glass-specific custom fields
        if item.get("category") == "Glass":
            sale_mode = item.get("sale_mode", "Resized")
            sandblast = item.get("sandblast_type", "")
            polish_width_sides = frappe.utils.cint(item.get("polish_width_sides", 0))
            polish_height_sides = frappe.utils.cint(item.get("polish_height_sides", 0))
            
            row_data.update({
                "custom_product_category": "Glass",
                "custom_glass_sale_mode": sale_mode,
                "custom_width_mm": item.get("width_mm", 0),
                "custom_height_mm": item.get("height_mm", 0),
                "custom_base_width_ft": item.get("base_width_ft", 0),
                "custom_base_height_ft": item.get("base_height_ft", 0),
                "custom_width_ft": item.get("width_ft", 0),
                "custom_height_ft": item.get("height_ft", 0),
                "custom_width_allowance": item.get("width_allowance", 0),
                "custom_height_allowance": item.get("height_allowance", 0),
                "custom_area_sqft": 0 if sale_mode == "Sheet" else item.get("area_sqft", 0),
                "custom_perimeter_rft": item.get("perimeter_rft", 0),
                "custom_polishing": 1 if (
                    item.get("polishing") in [1, True, "1", "Yes"] or
                    polish_width_sides > 0 or polish_height_sides > 0
                ) else 0,
                "custom_polish_width_sides": polish_width_sides,
                "custom_polish_height_sides": polish_height_sides,
                "custom_polish_type": item.get("polish_type") or DEFAULT_GLASS_POLISH_TYPE,
                "custom_holes": frappe.utils.cint(item.get("holes", 0)),
                "custom_hole_type": item.get("hole_type") or DEFAULT_GLASS_HOLE_TYPE,
                "custom_notches": frappe.utils.cint(item.get("notches", 0)),
                "custom_notch_type": item.get("notch_type") or DEFAULT_GLASS_NOTCH_TYPE,
                "custom_sandblast_type": "" if sandblast == "None" else sandblast,
                "custom_numbering": item.get("numbering", ""),
                "custom_sheet_size": item.get("sheet_size", "") if sale_mode == "Sheet" else "",
                "custom_sheet_sft": frappe.utils.flt(item.get("sheet_sft", 0)) if sale_mode == "Sheet" else 0,
                "custom_sheet_pcs": frappe.utils.flt(item.get("pcs", 0)) if sale_mode == "Sheet" else 0,
            })
            row_data["qty"] = item.get("qty", 1.0)
        elif category == "Aluminium":
            # Aluminium is sold per whole piece (stock_uom Nos). qty (pieces) is the
            # single source of truth; mirror it into custom_aluminium_metres for any
            # external consumer (no longer used for pricing/display math).
            row_data["custom_aluminium_metres"] = frappe.utils.flt(row_data.get("qty") or 0)
            row_data["custom_aluminium_color"] = item.get("aluminium_color") or None
        elif category == "Ceiling":
            if item.get("ceiling_mode") == "bundle":
                square_metres = frappe.utils.flt(item.get("quantity", item.get("square_metres", 100)) or 100)
                row_data.update({
                    "qty": 1,
                    "rate": square_metres * frappe.utils.flt(item.get("rate", 0)),
                    "custom_ceiling_sq_m": square_metres,
                })
            else:
                row_data.update({
                    "qty": item.get("qty", 1),
                    "custom_ceiling_sq_m": 0,
                })

        quo.append("items", row_data)
    
    quo.flags.ignore_mandatory = True
    quo.set_missing_values()

    if quotation_name:
        quo.save(ignore_permissions=True)
    else:
        quo.insert(ignore_permissions=True)
    
    # Return the name so the frontend can redirect
    return quo.name

@frappe.whitelist()
def submit_quotation(name):
    ensure_glass_service_items()
    quotation = frappe.get_doc("Quotation", name)
    quotation.submit()
    return quotation.name


@frappe.whitelist()
def make_sales_order_from_quotation(source_name):
    from erpnext.selling.doctype.quotation.quotation import _make_sales_order
    ensure_glass_service_items()
    source_doc = frappe.get_doc("Quotation", source_name)
    so = _make_sales_order(source_name, ignore_permissions=True)
    
    if not so.items:
        frappe.throw("A Sales Order has already been fully created for this Quotation.")

    _copy_aluminium_color_between_rows(source_doc.items, so.items)
        
    so.skip_delivery_note = 1
    so.flags.ignore_permissions = True
    so.flags.ignore_mandatory = True
    so.insert()
    so.submit()
    return so.name


def _get_partial_row_native_full(row):
    """Return a quotation/invoice row's quantity in the unit the user releases it
    in: pieces for piece-based items, metres/sq-m/sheet-pcs for qty-based items.
    Mirrors the JS get_job_card_row_quantities logic so the modal and server agree."""
    category = getattr(row, "custom_product_category", "") or ""
    if category == "Aluminium":
        # Sold per whole piece; qty is the releasable unit.
        return flt(row.qty)
    if category == "Glass" and getattr(row, "custom_glass_sale_mode", "") == "Sheet":
        return flt(getattr(row, "custom_sheet_pcs", 0)) or flt(row.qty)
    if category == "Ceiling" and flt(getattr(row, "custom_ceiling_sq_m", 0)) > 0:
        return flt(getattr(row, "custom_ceiling_sq_m", 0))
    return flt(row.qty)


def _get_glass_row_sft_qty(row):
    """True Square Foot quantity for a Glass quotation/invoice row, regardless of
    sale mode. Unlike _get_partial_row_native_full (which returns the *piece* count
    for Sheet mode, since that's the unit the user releases in), this always returns
    the SFT total, which is what stock (Repack/Material Issue) must move in."""
    if getattr(row, "custom_glass_sale_mode", "") == "Sheet":
        return flt(getattr(row, "custom_sheet_sft", 0)) * flt(getattr(row, "custom_sheet_pcs", 0))
    return flt(row.qty)


def _native_release_qty_to_sft(row, native_qty):
    """Convert a release-event quantity (in the native unit _record_job_card_item_releases
    receives, e.g. sheet pieces for Sheet-mode Glass) into SFT for stock deduction."""
    sale_mode = getattr(row, "custom_glass_sale_mode", "")
    if sale_mode == "Sheet":
        return flt(native_qty) * flt(getattr(row, "custom_sheet_sft", 0))
    elif sale_mode in ("Custom", "Resized"):
        return flt(native_qty) * flt(getattr(row, "custom_area_sqft", 0))
    return flt(native_qty)


def _create_glass_deduction_stock_entry(glass_item, sft_qty, warehouse, company, job_card_name, sheet_remarks=None, invoice_sft=None, sales_invoice=None):
    """Deduct Glass stock (via Material Issue) for one Job Card release event."""
    entry = frappe.new_doc("Stock Entry")
    entry.stock_entry_type = "Material Issue"
    entry.company = company
    entry.remarks = f"Deducted for CAW Job Card: {job_card_name}"
    if sales_invoice:
        entry.custom_sales_invoice = sales_invoice
    item_dict = {
        "item_code": glass_item,
        "s_warehouse": warehouse,
        "qty": round(flt(sft_qty), 4),
    }
    
    desc_lines = []
    if sheet_remarks:
        desc_lines.append(f"Sheets Consumed: {sheet_remarks}")
    if invoice_sft is not None:
        desc_lines.append(f"Invoice SFT: {round(flt(invoice_sft), 4)}")
        
    if desc_lines:
        item_dict["description"] = "\n".join(desc_lines)
        
    entry.append("items", item_dict)
    entry.flags.ignore_permissions = True
    entry.insert()
    entry.submit()
    return entry.name


def _create_glass_deduction_stock_entry_for_row(glass_item, sft_qty, warehouse, company, job_card_name, row_name, sheet_remarks=None, invoice_sft=None):
    """Deduct Glass stock (via Material Issue) immediately for a specific Job Card row."""
    entry = frappe.new_doc("Stock Entry")
    entry.stock_entry_type = "Material Issue"
    entry.company = company
    entry.remarks = f"Deducted for CAW Job Card: {job_card_name} Row: {row_name}"
    item_dict = {
        "item_code": glass_item,
        "s_warehouse": warehouse,
        "qty": round(flt(sft_qty), 4),
    }
    
    desc_lines = []
    if sheet_remarks:
        desc_lines.append(f"Sheets Consumed: {sheet_remarks}")
    if invoice_sft is not None:
        desc_lines.append(f"Invoice SFT: {round(flt(invoice_sft), 4)}")
        
    if desc_lines:
        item_dict["description"] = "\n".join(desc_lines)
        
    entry.append("items", item_dict)
    entry.flags.ignore_permissions = True
    entry.insert()
    entry.submit()
    return entry.name


def _create_multi_item_deduction_stock_entry(items_to_deduct, company, job_card_name, sales_invoice=None):
    """Deduct multiple stock items (via a single Material Issue Stock Entry) for a Job Card release event."""
    entry = frappe.new_doc("Stock Entry")
    entry.stock_entry_type = "Material Issue"
    entry.company = company
    entry.remarks = f"Deducted for CAW Job Card: {job_card_name}"
    if sales_invoice:
        entry.custom_sales_invoice = sales_invoice
    for item in items_to_deduct:
        entry.append("items", {
            "item_code": item["item_code"],
            "s_warehouse": item["s_warehouse"],
            "qty": round(flt(item["qty"]), 4),
        })
    entry.flags.ignore_permissions = True
    entry.insert()
    entry.submit()
    return entry.name


def _create_non_glass_deduction_stock_entry(item_code, qty, warehouse, company, job_card_name, sales_invoice=None):
    """Deduct stock (via Material Issue) for non-glass items (Aluminium, Fittings, Rubber, Silicone)."""
    return _create_multi_item_deduction_stock_entry(
        [{"item_code": item_code, "s_warehouse": warehouse, "qty": qty}],
        company,
        job_card_name,
        sales_invoice=sales_invoice,
    )


def _quotation_has_releasable_items(quotation):
    """True if any parent row still has something to release on a partial invoice
    (native-unit remaining qty, including ceiling bundle rows via their sq m)."""
    for row in quotation.items:
        if getattr(row, "custom_auto_generated", 0):
            continue
        remaining = _get_partial_row_native_full(row) - flt(getattr(row, "custom_collected_qty", 0))
        if remaining > 0.0001:
            return True
    return False


def _is_full_remaining_release(rows_by_name, releases):
    """True when the request releases every still-releasable row up to its current
    remaining quantity."""
    has_remaining = False
    for name, row in rows_by_name.items():
        remaining = _get_partial_row_native_full(row) - flt(getattr(row, "custom_collected_qty", 0))
        if remaining <= 0.0001:
            continue
        has_remaining = True
        if abs(flt(releases.get(name, 0)) - remaining) > 0.0001:
            return False
    return has_remaining


def _scale_partial_invoice_row(row, ratio):
    """Scale a row's driving quantities by ratio so its amount, generated service
    rows and printed table all reflect the released portion. rate is left intact —
    amount = qty * rate then scales linearly, and on_validate rebuilds services."""
    row.qty = flt(row.qty) * ratio
    for field in ("custom_aluminium_metres", "custom_ceiling_sq_m", "custom_sheet_pcs"):
        if flt(getattr(row, field, 0)):
            setattr(row, field, flt(getattr(row, field)) * ratio)


def _parse_releases(releases):
    """Normalise the releases payload into {quotation_item_name: release_qty_or_dict}."""
    if not releases:
        return {}
    if isinstance(releases, str):
        releases = json.loads(releases)
    parsed = {}
    if isinstance(releases, dict):
        items = releases.items()
    else:
        items = ((entry.get("row"), entry.get("qty")) for entry in releases)
    for name, value in items:
        if isinstance(value, dict):
            qty = flt(value.get("qty"))
            if name and qty > 0:
                parsed[name] = value
        else:
            qty = flt(value)
            if name and qty > 0:
                parsed[name] = qty
    return parsed


def _is_ceiling_bundle_row(row):
    return (getattr(row, "custom_product_category", "") or "") == "Ceiling" and flt(getattr(row, "custom_ceiling_sq_m", 0)) > 0


def _get_ceiling_snapshot(quotation_item_row):
    """Full per-component piece breakdown for a ceiling bundle row. Uses the frozen
    custom_ceiling_snapshot_json if already set (so it never drifts once releasing has
    started), otherwise derives it from the row's sq m via the standard ratios."""
    frozen = getattr(quotation_item_row, "custom_ceiling_snapshot_json", None)
    if frozen:
        try:
            data = frappe.parse_json(frozen)
            if data:
                return {k: frappe.utils.cint(v) for k, v in data.items()}
        except Exception:
            pass
    sqm = flt(getattr(quotation_item_row, "custom_ceiling_sq_m", 0))
    return {c["item_code"]: get_ceiling_whole_piece_qty(sqm, c["ratio"], c["mode"]) for c in CEILING_COMPONENTS}


@frappe.whitelist()
def make_sales_invoice_from_quotation(source_name, releases=None):
    from erpnext.selling.doctype.quotation.quotation import _make_sales_invoice
    ensure_glass_service_items()
    source_doc = frappe.get_doc("Quotation", source_name)

    releases = _parse_releases(releases)
    if releases:
        invoice = _make_sales_invoice(
            source_name,
            ignore_permissions=True,
            args={"filtered_children": list(releases.keys())},
        )
    else:
        invoice = _make_sales_invoice(source_name, ignore_permissions=True)

    if not invoice.items:
        frappe.throw("A Sales Invoice has already been fully created for this Quotation.")

    if hasattr(invoice, "custom_source_quotation"):
        invoice.custom_source_quotation = source_name

    _copy_aluminium_color_between_rows(source_doc.items, invoice.items)

    if releases:
        invoice.custom_is_partial = 1
        # get_mapped_doc copies the selected rows in source order and the invoice
        # has no auto-generated rows yet, so the kept source rows line up 1:1 with
        # the invoice rows by position (Sales Invoice Item carries no reliable
        # back-link to the Quotation Item row).
        selected_source = [
            r for r in source_doc.items
            if not getattr(r, "custom_auto_generated", 0) and r.name in releases
        ]
        target_rows = [r for r in invoice.items if not getattr(r, "custom_auto_generated", 0)]
        if len(selected_source) != len(target_rows):
            frappe.throw("Could not map the released items onto the Sales Invoice rows.")
        for src, row in zip(selected_source, target_rows):
            native_full = _get_partial_row_native_full(src)
            if native_full <= 0:
                continue
            ratio = min(releases[src.name] / native_full, 1.0)
            _scale_partial_invoice_row(row, ratio)

    invoice.update_stock = 0
    invoice.set_posting_time = 1
    invoice.set_missing_values()
    invoice.set_missing_item_details(for_validate=True)
    from crystal_alluminium_works.sales_invoice_handler import _reset_auto_generated_ceiling_component_pricing
    _reset_auto_generated_ceiling_component_pricing(invoice)
    invoice.flags.ignore_permissions = True
    invoice.flags.ignore_mandatory = True
    invoice.insert()
    return invoice.name

def _validate_glass_consumption(job_card):
    if not job_card.quotation:
        return
    import json
    quotation = frappe.get_doc("Quotation", job_card.quotation)
    consumption = json.loads(job_card.custom_sheet_consumption_json or "{}")
    
    missing = []
    for row in quotation.items:
        if getattr(row, "custom_product_category", "") == "Glass":
            glass_type = frappe.db.get_value("Item", row.item_code, "custom_glass_type")
            sale_mode = getattr(row, "custom_glass_sale_mode", "")
            
            if glass_type == "Laminated" or sale_mode in ("Resized", "Custom"):
                row_consumption = consumption.get(row.name, [])
                valid = False
                for sheet in row_consumption:
                    if sheet.get("item_consumed") and sheet.get("size") and frappe.utils.flt(sheet.get("pcs")) > 0:
                        valid = True
                        break
                if not valid:
                    missing.append(row.item_code)
                    
    if missing:
        frappe.throw(f"Cannot release materials. Please configure Glass Sheet Consumption via JC Operations for: {', '.join(missing)}.")

@frappe.whitelist()
def make_sales_invoice_from_job_card(job_card_name):
    if not job_card_name or not frappe.db.exists("CAW Job Card", job_card_name):
        frappe.throw("Please select a valid Job Card.")

    job_card = frappe.get_doc("CAW Job Card", job_card_name)
    _validate_glass_consumption(job_card)

    if not job_card.quotation or not frappe.db.exists("Quotation", job_card.quotation):
        frappe.throw("The selected Job Card is not linked to a valid Quotation.")

    quotation_amount = _round_job_card_amount(job_card.quotation_amount)
    payment_amount = _round_job_card_amount(job_card.payment_amount)
    if quotation_amount <= 0 or payment_amount < quotation_amount:
        frappe.throw("The Job Card must be fully paid before creating a Sales Invoice.")

    # Earlier partial invoices may already have billed part of this quotation
    # (tracked via custom_collected_qty). If so, only release what's left so
    # this invoice doesn't re-bill the whole quotation on top of them.
    quotation = frappe.get_doc("Quotation", job_card.quotation)
    rows_by_name = {row.name: row for row in quotation.items if not getattr(row, "custom_auto_generated", 0)}
    had_prior_partial = any(flt(getattr(row, "custom_collected_qty", 0)) > 0 for row in rows_by_name.values())

    remaining_releases = {}
    if had_prior_partial:
        for name, row in rows_by_name.items():
            remaining = _get_partial_row_native_full(row) - flt(getattr(row, "custom_collected_qty", 0))
            if remaining > 0.0001:
                remaining_releases[name] = remaining

        if not remaining_releases:
            frappe.throw("This Quotation has already been fully invoiced.")
        invoice_releases = remaining_releases
    else:
        # Nothing collected yet — this single invoice releases every row in full.
        invoice_releases = {
            name: _get_partial_row_native_full(row)
            for name, row in rows_by_name.items()
            if _get_partial_row_native_full(row) > 0.0001
        }

    invoice_name = make_sales_invoice_from_quotation(
        job_card.quotation,
        releases=remaining_releases or None,
    )
    invoice = frappe.get_doc("Sales Invoice", invoice_name)
    if frappe.get_meta("Sales Invoice").has_field("custom_source_job_card"):
        invoice.custom_source_job_card = job_card.name
        invoice.save(ignore_permissions=True)

    paid_invoice = _submit_and_settle_job_card_sales_invoice(invoice, job_card)

    # Stamp collected qty for every row this invoice actually billed. On the pure
    # full-invoice path (no prior partials) remaining_releases is empty, so iterating
    # it here would leave custom_collected_qty at 0 and keep the Partial Invoice button
    # alive forever — use invoice_releases, which equals remaining_releases when partials
    # came first and holds the full per-row qty otherwise.
    for name, release_qty in invoice_releases.items():
        row = rows_by_name[name]
        new_collected = flt(getattr(row, "custom_collected_qty", 0)) + release_qty
        frappe.db.set_value("Quotation Item", name, "custom_collected_qty", new_collected)

    # Ceiling bundle rows: previously this audit log was only written on the partial
    # path, so a ceiling job card paid in full upfront (no partial invoices first) got
    # no piece breakdown. Log it here too, on every successful full/final invoice.
    _record_ceiling_releases(job_card, paid_invoice, rows_by_name, invoice_releases)

    # Generic per-item release log across every category — the invoice has been created
    # and submitted successfully by this point.
    _record_job_card_item_releases(job_card, paid_invoice, rows_by_name, invoice_releases, is_partial=False, quotation_items=quotation.items)

    return paid_invoice.name


def _record_ceiling_releases(job_card, invoice, rows_by_name, released_qtys):
    """Log this visit's auto-derived piece release for each Ceiling bundle row, so the
    component-piece breakdown (CAW Ceiling Release) is captured on every successful
    invoice generation — partial or full/final — not just partial releases.

    released_qtys: {quotation_item_name: qty_released_in_native_unit (sq m) this visit}."""
    for name, release_qty in (released_qtys or {}).items():
        row = rows_by_name.get(name)
        if not row or not _is_ceiling_bundle_row(row):
            continue
        full_sqm = flt(getattr(row, "custom_ceiling_sq_m", 0))
        ratio = min(flt(release_qty) / full_sqm, 1.0) if full_sqm else 0
        pieces = {
            c["item_code"]: get_ceiling_whole_piece_qty(release_qty, c["ratio"], c["mode"])
            for c in CEILING_COMPONENTS
            if not c.get("uses_parent_item")
        }
        frappe.get_doc({
            "doctype": "CAW Ceiling Release",
            "job_card": job_card.name,
            "quotation": job_card.quotation,
            "sales_invoice": invoice.name,
            "quotation_item": name,
            "item_code": row.item_code,
            "item_name": row.item_name or row.item_code,
            "snapshot_json": json.dumps(_get_ceiling_snapshot(row)),
            "released_json": json.dumps(pieces),
            "amount_paid": flt(_round_job_card_amount(ratio * flt(row.amount) * 1.16)),
            "changed_by": frappe.session.user,
        }).insert(ignore_permissions=True)

        # Wire stock deduction for Ceiling items
        company = _get_default_stock_company()
        warehouse = _get_default_receiving_warehouse(company)
        items_to_deduct = []

        # 1. Parent board item (uses_parent_item = True)
        if release_qty > 0.0001:
            items_to_deduct.append({
                "item_code": row.item_code,
                "s_warehouse": warehouse,
                "qty": round(flt(release_qty), 4)
            })

        # 2. Components
        for comp_item, comp_qty in pieces.items():
            if comp_qty > 0.0001:
                items_to_deduct.append({
                    "item_code": comp_item,
                    "s_warehouse": warehouse,
                    "qty": round(flt(comp_qty), 4)
                })

        if items_to_deduct:
            _create_multi_item_deduction_stock_entry(items_to_deduct, company, job_card.name, sales_invoice=invoice.name)



def _record_job_card_item_releases(job_card, invoice, rows_by_name, released_qtys, is_partial, quotation_items=None):
    """Log one CAW Job Card Release row per item released on this visit, across every
    product category (not just Ceiling) — only called once the invoice has actually been
    created and submitted, so a release is only ever logged on successful invoice generation.

    released_qtys: {quotation_item_name: qty_released_in_native_unit} for exactly what this
    invoice releases this visit (not the cumulative total).

    quotation_items: full unfiltered quotation.items (including auto-generated processing
    rows), used to fold each material row's Polishing/Drilling/Sandblasting/Notching charges
    into its release amount so the logged total reconciles with what the invoice actually
    bills for that row."""
    processing_by_parent_idx = {}
    for r in (quotation_items or []):
        if getattr(r, "custom_auto_generated", 0):
            processing_by_parent_idx.setdefault(r.custom_parent_row_idx, []).append(r)

    visual_vat = _invoice_uses_visual_vat(invoice)
    lamination_company = None
    lamination_warehouse = None
    import json
    
    # Fetch sheets saved in JC Operations modal
    jc_sheets = {}
    try:
        jc_sheet_json = frappe.db.get_value("CAW Job Card", job_card.name, "custom_sheet_consumption_json")
        if jc_sheet_json:
            jc_sheets = json.loads(jc_sheet_json)

    except Exception:
        pass

    for name, release_data in (released_qtys or {}).items():
        if isinstance(release_data, dict):
            qty = flt(release_data.get("qty"))
        else:
            qty = flt(release_data)
            
        sheets = jc_sheets.get(name, [])

        row = rows_by_name.get(name)
        if not row or qty <= 0:
            continue
        native_full = _get_partial_row_native_full(row)
        ratio = min(flt(qty) / native_full, 1.0) if native_full else 0
        processing_amount = sum(flt(p.amount) for p in processing_by_parent_idx.get(row.idx, []))
        row_amount = (flt(row.amount) + processing_amount) * ratio
        amount = _round_job_card_amount(row_amount * (1 + VAT_RATE)) if visual_vat else _round_job_card_amount(row_amount)

        import json
        frappe.get_doc({
            "doctype": "CAW Job Card Release",
            "job_card": job_card.name,
            "quotation": job_card.quotation,
            "sales_invoice": invoice.name,
            "quotation_item": name,
            "item_code": row.item_code,
            "item_name": row.item_name or row.item_code,
            "category": getattr(row, "custom_product_category", "") or "",
            "qty_released": flt(qty),
            "uom": row.uom or "",
            "amount": amount,
            "is_partial": 1 if is_partial else 0,
            "custom_sheet_consumption_json": json.dumps(sheets) if sheets else None,
            "changed_by": frappe.session.user,
        }).insert(ignore_permissions=True)

        category = getattr(row, "custom_product_category", "")
        if category in ("Aluminium", "Fittings", "Rubber", "Silicone"):
            if qty > 0.0001:
                company = _get_default_stock_company()
                warehouse = _get_default_receiving_warehouse(company)
                _create_non_glass_deduction_stock_entry(
                    row.item_code, qty, warehouse, company, job_card.name, sales_invoice=invoice.name
                )

        if getattr(row, "custom_product_category", "") == "Glass":
            # Cut/custom & laminated glass is deducted up-front at JC Operations time
            # (remark carries "Row: {quotation_item}"), before any invoice existed. Those
            # entries can't be stamped at creation, so the FIRST invoice to release the row
            # claims them here as the canonical value; the ledger lists every releasing
            # invoice at read time from the CAW Job Card Release rows.
            early_entries = frappe.get_all(
                "Stock Entry",
                filters={
                    "remarks": ["like", f"%Deducted for CAW Job Card: {job_card.name} Row: {row.name}%"],
                    "docstatus": 1,
                },
                fields=["name", "custom_sales_invoice"],
            )
            if early_entries:
                for se in early_entries:
                    if not se.custom_sales_invoice:
                        frappe.db.set_value(
                            "Stock Entry", se.name, "custom_sales_invoice", invoice.name,
                            update_modified=False,
                        )
                continue

            invoice_sft = _native_release_qty_to_sft(row, qty)
            glass_type = frappe.db.get_value("Item", row.item_code, "custom_glass_type")
            if glass_type == "Laminated":
                sft_release_qty = invoice_sft
                if sft_release_qty > 0.0001:
                    company = _get_default_stock_company()
                    warehouse = _get_default_receiving_warehouse(company)
                    sheet_remarks = json.dumps(sheets) if sheets else None
                    _create_glass_deduction_stock_entry(
                        row.item_code, sft_release_qty, warehouse, company, job_card.name, sheet_remarks, invoice_sft, sales_invoice=invoice.name
                    )
                continue
                
            if sheets:
                configs = frappe.cache().get_value("glass_sheet_configs") or []
                if not configs:
                    configs = get_glass_sheet_configs()

                # Group sheets by item_consumed
                sheets_by_item = {}
                for sheet in sheets:
                    itm = sheet.get("item_consumed") or row.item_code
                    if itm not in sheets_by_item:
                        sheets_by_item[itm] = []
                    sheets_by_item[itm].append(sheet)

                company = _get_default_stock_company()
                warehouse = _get_default_receiving_warehouse(company)

                for itm, itm_sheets in sheets_by_item.items():
                    sft_release_qty = 0
                    for sheet in itm_sheets:
                        size = sheet.get("size")
                        pcs = flt(sheet.get("pcs"))
                        sft_per_sheet = next((flt(c.get("sft")) for c in configs if c.get("size") == size), 0)
                        sft_release_qty += sft_per_sheet * pcs

                    if sft_release_qty > 0.0001:
                        _create_glass_deduction_stock_entry(
                            itm, sft_release_qty, warehouse, company, job_card.name, json.dumps(itm_sheets) if itm_sheets else None, invoice_sft, sales_invoice=invoice.name
                        )
            else:
                sft_release_qty = invoice_sft
                if sft_release_qty > 0.0001:
                    company = _get_default_stock_company()
                    warehouse = _get_default_receiving_warehouse(company)
                    sheet_remarks = None
                    if getattr(row, "custom_glass_sale_mode", "") == "Sheet" and getattr(row, "custom_sheet_size", ""):
                        sheet_remarks = json.dumps([{"size": row.custom_sheet_size, "pcs": qty}])
                    _create_glass_deduction_stock_entry(
                        row.item_code, sft_release_qty, warehouse, company, job_card.name, sheet_remarks, invoice_sft, sales_invoice=invoice.name
                    )



@frappe.whitelist()
def make_partial_sales_invoice_from_job_card(job_card_name, releases=None):
    if not job_card_name or not frappe.db.exists("CAW Job Card", job_card_name):
        frappe.throw("Please select a valid Job Card.")

    job_card = frappe.get_doc("CAW Job Card", job_card_name)
    _validate_glass_consumption(job_card)

    if not job_card.quotation or not frappe.db.exists("Quotation", job_card.quotation):
        frappe.throw("The selected Job Card is not linked to a valid Quotation.")
    _assert_job_card_not_frozen(job_card)

    releases = _parse_releases(releases)

    quotation = frappe.get_doc("Quotation", job_card.quotation)
    rows_by_name = {row.name: row for row in quotation.items if not getattr(row, "custom_auto_generated", 0)}

    # Cap each requested release (ceiling bundles included) at the row's remaining
    # (full - already collected) so a piece/sq-m can't be over-collected.
    capped = {}
    for name, qty in releases.items():
        row = rows_by_name.get(name)
        if not row:
            continue
        remaining = _get_partial_row_native_full(row) - flt(getattr(row, "custom_collected_qty", 0))
        release_qty = min(qty, remaining)
        if release_qty > 0:
            capped[name] = release_qty

    if not capped:
        frappe.throw("Enter a quantity to release.")

    if flt(job_card.balance_amount or 0) > 0.0001 and _is_full_remaining_release(rows_by_name, capped):
        frappe.throw("You cannot release all remaining items while this Job Card still has an outstanding balance. Reduce the release quantity or clear the balance first.")

    invoice_name = make_sales_invoice_from_quotation(job_card.quotation, releases=capped)
    invoice = frappe.get_doc("Sales Invoice", invoice_name)
    if frappe.get_meta("Sales Invoice").has_field("custom_source_job_card"):
        invoice.custom_source_job_card = job_card.name
        invoice.save(ignore_permissions=True)

    # Partial invoices never embed a payment / touch GL — the Job Card is the single
    # source of truth for what's been paid and what's outstanding, for every customer.
    paid_invoice = _submit_and_settle_job_card_sales_invoice(invoice, job_card, skip_payment_settlement=True)

    # Record released qty against the source row for remaining-qty calc.
    for name, release_qty in capped.items():
        row = rows_by_name[name]
        new_collected = flt(getattr(row, "custom_collected_qty", 0)) + release_qty
        frappe.db.set_value("Quotation Item", name, "custom_collected_qty", new_collected)

    # Ceiling bundle rows: log this visit's auto-derived piece release for history.
    # No overrides, no balance guard — pieces and cash both flow from the same
    # released sq m ratio, same as quotation/sales order/full invoice.
    _record_ceiling_releases(job_card, paid_invoice, rows_by_name, capped)

    # Generic per-item release log across every category, for this visit only — the
    # invoice has been created and submitted successfully by this point.
    #
    # Invoices (partial or full) only ever track released items here — never payments,
    # for either customer type. Cash Customers' money is driven solely by Create/Edit Job
    # Card; Invoice Customers' money is driven solely by the Payments page (see
    # _sync_job_card_balance_from_payments). The release guard above already read
    # job_card.balance_amount before any of this ran, so it reflects real money, not what's
    # being invoiced this visit.
    _record_job_card_item_releases(job_card, paid_invoice, rows_by_name, capped, is_partial=True, quotation_items=quotation.items)

    return paid_invoice.name


@frappe.whitelist()
def get_sales_invoice_source_job_card(invoice_name):
    if not invoice_name or not frappe.db.exists("Sales Invoice", invoice_name):
        frappe.throw("Please select a valid Sales Invoice.")

    invoice = frappe.get_doc("Sales Invoice", invoice_name)
    job_card_name = invoice.get("custom_source_job_card")

    if not job_card_name and invoice.get("custom_source_quotation"):
        job_card_name = _resolve_job_card_for_quotation(invoice.custom_source_quotation)

    if not job_card_name or not frappe.db.exists("CAW Job Card", job_card_name):
        return None

    job_card = frappe.get_doc("CAW Job Card", job_card_name)
    payment_method_rows = frappe.get_all(
        "Payments",
        filters={"job_card": job_card.name},
        fields=["payment_method"],
        order_by="creation asc",
        limit_page_length=0,
    )
    payment_methods = []
    for row in payment_method_rows:
        payment_method = (row.payment_method or "").strip()
        if payment_method and payment_method not in payment_methods:
            payment_methods.append(payment_method)

    return {
        "name": job_card.name,
        "quotation": job_card.quotation,
        "payment_mode": job_card.payment_mode,
        "payment_option": job_card.payment_option,
        "payment_methods": payment_methods,
        "quotation_amount": job_card.quotation_amount,
        "payment_amount": job_card.payment_amount,
        "balance_amount": job_card.balance_amount,
        "status": job_card.status,
    }


@frappe.whitelist()
def settle_sales_invoice_from_job_card(invoice_name):
    if not invoice_name or not frappe.db.exists("Sales Invoice", invoice_name):
        frappe.throw("Please select a valid Sales Invoice.")

    invoice = frappe.get_doc("Sales Invoice", invoice_name)
    job_card_name = invoice.get("custom_source_job_card")

    if not job_card_name and invoice.get("custom_source_quotation"):
        job_card_name = _resolve_job_card_for_quotation(invoice.custom_source_quotation)

    if not job_card_name or not frappe.db.exists("CAW Job Card", job_card_name):
        frappe.throw("No linked Job Card was found for this Sales Invoice.")

    job_card = frappe.get_doc("CAW Job Card", job_card_name)
    quotation_amount = _round_job_card_amount(job_card.quotation_amount)
    payment_amount = _round_job_card_amount(job_card.payment_amount)
    if quotation_amount <= 0 or payment_amount < quotation_amount:
        frappe.throw("The linked Job Card must be fully paid before settling this Sales Invoice.")

    if invoice.docstatus == 0:
        invoice = _submit_and_settle_job_card_sales_invoice(invoice, job_card)
    elif invoice.docstatus == 1:
        frappe.throw(
            "This Sales Invoice was already submitted without being settled at creation. "
            "Payments are recorded against the Job Card, not against the invoice — "
            "cancel and recreate the Sales Invoice from the Job Card instead."
        )
    else:
        frappe.throw("Cancelled Sales Invoices cannot be settled from a Job Card.")

    return {
        "sales_invoice": invoice.name,
        "status": invoice.status,
        "outstanding_amount": invoice.outstanding_amount,
    }


@frappe.whitelist()
def make_sales_invoice_from_sales_order(source_name):
    from erpnext.selling.doctype.sales_order.sales_order import make_sales_invoice
    ensure_glass_service_items()
    source_doc = frappe.get_doc("Sales Order", source_name)

    invoice = make_sales_invoice(source_name, ignore_permissions=True)

    if not invoice.items:
        frappe.throw("A Sales Invoice has already been fully created for this Sales Order.")

    quotation_name = frappe.db.get_value(
        "Sales Order Item",
        {"parent": source_name, "prevdoc_docname": ["is", "set"]},
        "prevdoc_docname",
    )
    if quotation_name and hasattr(invoice, "custom_source_quotation"):
        invoice.custom_source_quotation = quotation_name

    _copy_aluminium_color_between_rows(source_doc.items, invoice.items)

    invoice.update_stock = 0
    invoice.set_posting_time = 1
    invoice.set_missing_values()
    invoice.set_missing_item_details(for_validate=True)
    from crystal_alluminium_works.sales_invoice_handler import _reset_auto_generated_ceiling_component_pricing
    _reset_auto_generated_ceiling_component_pricing(invoice)
    invoice.flags.ignore_permissions = True
    invoice.flags.ignore_mandatory = True
    invoice.insert()
    return invoice.name


@frappe.whitelist()
def submit_sales_invoice(name):
    ensure_glass_service_items()
    invoice = frappe.get_doc("Sales Invoice", name)
    source_job_card_name = invoice.get("custom_source_job_card")
    if source_job_card_name and frappe.db.exists("CAW Job Card", source_job_card_name):
        job_card = frappe.get_doc("CAW Job Card", source_job_card_name)
        if invoice.get("amended_from") and invoice.get("custom_is_partial"):
            # Administratively-amended partial: settle and re-apply impact without the
            # fully-paid gate (a partial never makes the Job Card fully paid).
            invoice = _submit_amended_partial_invoice(invoice, job_card)
        else:
            quotation_amount = _round_job_card_amount(job_card.quotation_amount)
            payment_amount = _round_job_card_amount(job_card.payment_amount)
            if quotation_amount > 0 and payment_amount >= quotation_amount:
                invoice = _submit_and_settle_job_card_sales_invoice(
                    invoice, job_card, preserve_payment=bool(invoice.get("amended_from"))
                )
                if invoice.get("amended_from"):
                    _relink_ceiling_releases(invoice)
                    _write_job_card_amendment_event(
                        job_card, "Invoice Amended", note=f"Re-submitted as {invoice.name}"
                    )
            else:
                frappe.throw("The linked Job Card must be fully paid before submitting this Sales Invoice.")
    else:
        invoice.update_stock = 0
        invoice.set_posting_time = 1
        invoice.submit()
    return invoice.name


@frappe.whitelist()
def cancel_sales_invoice(name):
    invoice = frappe.get_doc("Sales Invoice", name)
    job_card = _get_invoice_job_card(invoice)
    invoice.flags.ignore_permissions = True
    invoice.cancel()
    # Reverse the money a partial invoice contributed to its Job Card, but preserve the
    # physical release records (custom_collected_qty, CAW Ceiling Release) — cancelling an
    # invoice is an accounting correction, not a goods return.
    if job_card and invoice.get("custom_is_partial"):
        _reverse_partial_invoice_payment(job_card, invoice)
    return invoice.name


# ── Amendment lifecycle ──────────────────────────────────────────────────────────

def _get_invoice_job_card(invoice):
    name = invoice.get("custom_source_job_card")
    if not name and invoice.get("custom_source_quotation"):
        name = _resolve_job_card_for_quotation(invoice.custom_source_quotation)
    if name and frappe.db.exists("CAW Job Card", name):
        return frappe.get_doc("CAW Job Card", name)
    return None


def _reverse_partial_invoice_payment(job_card, invoice):
    impact = _round_job_card_amount(_get_invoice_display_amount(invoice.grand_total, invoice))
    if impact <= 0:
        return
    job_card.reload()
    quotation_amount = _round_job_card_amount(job_card.quotation_amount)
    new_payment = _round_job_card_amount(max(flt(job_card.payment_amount) - impact, 0))
    job_card.payment_amount = new_payment
    job_card.balance_amount = _round_job_card_amount(max(quotation_amount - new_payment, 0))
    job_card.flags.ignore_permissions = True
    job_card.save(ignore_permissions=True)
    _write_job_card_amendment_event(
        job_card, "Invoice Cancelled", amount_paid=-impact, note=f"Cancelled {invoice.name}"
    )


@frappe.whitelist()
def get_quotation_amendment_eligibility(quotation):
    if not quotation or not frappe.db.exists("Quotation", quotation):
        return {"can_amend": False, "reasons": ["Quotation not found."], "job_card": None}

    doc = frappe.get_doc("Quotation", quotation)
    chain = _resolve_quotation_chain(quotation) or [quotation]
    reasons = []

    if doc.docstatus == 0:
        reasons.append("Draft quotations are edited directly in the Builder, not amended.")
    if chain[-1] != quotation:
        reasons.append("A newer revision of this Quotation already exists.")
    if frappe.db.exists("Quotation", {"amended_from": quotation}):
        reasons.append("This Quotation has already been amended.")
    if frappe.db.exists("Sales Order Item", {"prevdoc_docname": ["in", chain], "docstatus": ["<", 2]}):
        reasons.append("A Sales Order exists for this Quotation.")
    if frappe.db.exists("Sales Invoice", {"custom_source_quotation": ["in", chain]}):
        reasons.append("A Sales Invoice exists for this Quotation — amend the invoice instead.")
    if frappe.db.exists("CAW Ceiling Release", {"quotation": ["in", chain]}):
        reasons.append("Goods have already been released for this Quotation.")
    if any(
        flt(getattr(r, "custom_collected_qty", 0)) > 0 or flt(getattr(r, "custom_released_qty", 0)) > 0
        for r in doc.items
    ):
        reasons.append("Goods have already been released for this Quotation.")

    # De-duplicate while keeping order.
    reasons = list(dict.fromkeys(reasons))
    return {
        "can_amend": not reasons,
        "reasons": reasons,
        "job_card": _resolve_job_card_for_quotation(quotation),
    }


@frappe.whitelist()
def cancel_quotation(quotation):
    eligibility = get_quotation_amendment_eligibility(quotation)
    if not eligibility["can_amend"]:
        frappe.throw("Cannot amend this Quotation: " + " ".join(eligibility["reasons"]))
    doc = frappe.get_doc("Quotation", quotation)
    if doc.docstatus == 1:
        doc.flags.ignore_permissions = True
        doc.cancel()
    return doc.name


@frappe.whitelist()
def amend_quotation(quotation):
    if not quotation or not frappe.db.exists("Quotation", quotation):
        frappe.throw("Please select a valid Quotation.")
    doc = frappe.get_doc("Quotation", quotation)
    if doc.docstatus != 2:
        frappe.throw("Cancel the Quotation before amending it.")
    if frappe.db.exists("Quotation", {"amended_from": quotation}):
        frappe.throw("This Quotation has already been amended.")

    amended = frappe.copy_doc(doc)
    amended.amended_from = quotation
    amended.docstatus = 0
    amended.status = "Draft"
    amended.flags.ignore_permissions = True
    amended.insert(ignore_permissions=True)
    return amended.name


def _on_quotation_amendment_submitted(quotation_doc):
    """Re-point the existing Job Card to a freshly-submitted amended Quotation, keeping
    its name/number stable. Rejects a new total below the amount already paid."""
    job_card_name = _resolve_job_card_for_quotation(quotation_doc.name)
    if not job_card_name:
        return  # this quotation chain never had a Job Card; nothing to re-point

    job_card = frappe.get_doc("CAW Job Card", job_card_name)
    new_total = _get_quotation_display_total(quotation_doc)
    paid_to_date = _round_job_card_amount(job_card.payment_amount)
    if new_total < paid_to_date:
        frappe.throw(
            f"The amended Quotation total ({frappe.utils.fmt_money(new_total)}) is below the "
            f"amount already paid ({frappe.utils.fmt_money(paid_to_date)})."
        )

    job_card.quotation = quotation_doc.name
    job_card.quotation_amount = new_total
    job_card.balance_amount = _round_job_card_amount(max(new_total - paid_to_date, 0))
    job_card.flags.ignore_permissions = True
    job_card.save(ignore_permissions=True)
    _write_job_card_amendment_event(
        job_card, "Quotation Amended", note=f"Quotation amended to {quotation_doc.name}"
    )


@frappe.whitelist()
def get_invoice_amendment_eligibility(name):
    if not name or not frappe.db.exists("Sales Invoice", name):
        return {"can_amend": False, "reasons": ["Sales Invoice not found."]}
    invoice = frappe.get_doc("Sales Invoice", name)
    reasons = []
    if invoice.docstatus == 0:
        reasons.append("Draft invoices are edited directly.")
    if invoice.get("is_return"):
        reasons.append("Credit notes and returns are not amended here.")
    if frappe.db.exists("Sales Invoice", {"amended_from": name}):
        reasons.append("This invoice has already been amended.")
    return {"can_amend": not reasons, "reasons": reasons}


@frappe.whitelist()
def amend_sales_invoice(name):
    if not name or not frappe.db.exists("Sales Invoice", name):
        frappe.throw("Please select a valid Sales Invoice.")
    invoice = frappe.get_doc("Sales Invoice", name)
    if invoice.docstatus != 2:
        frappe.throw("Cancel the Sales Invoice before amending it.")
    if frappe.db.exists("Sales Invoice", {"amended_from": name}):
        frappe.throw("This invoice has already been amended.")

    amended = frappe.copy_doc(invoice)
    amended.amended_from = name
    amended.docstatus = 0
    amended.update_stock = 0
    amended.set_posting_time = 1
    amended.flags.ignore_permissions = True
    amended.insert(ignore_permissions=True)
    return amended.name


@frappe.whitelist()
def update_and_submit_amended_invoice(name, posting_date=None, due_date=None, po_no=None,
                                      remarks=None, terms=None, select_print_heading=None):
    """Apply the only fields an amended invoice may change (administrative), then submit it
    through the job-card settlement path. Commercial edits are rejected by the validate lock."""
    invoice = frappe.get_doc("Sales Invoice", name)
    if invoice.docstatus != 0 or not invoice.get("amended_from"):
        frappe.throw("This is not an amendable draft invoice.")

    if posting_date:
        invoice.posting_date = posting_date
    if due_date:
        invoice.due_date = due_date
    invoice.po_no = po_no
    invoice.remarks = remarks
    if terms is not None:
        invoice.terms = terms
    if select_print_heading is not None:
        invoice.select_print_heading = select_print_heading

    invoice.set_posting_time = 1
    invoice.flags.ignore_permissions = True
    invoice.save(ignore_permissions=True)  # triggers the administrative-only validation lock
    return submit_sales_invoice(name)


# Item-level fields a submitted-invoice edit may set. Header fields are never
# accepted — the payload is applied row-by-row through this whitelist only.
INVOICE_EDIT_ITEM_FIELDS = (
    "item_code", "item_name", "qty", "rate", "uom",
    "custom_price_list", "custom_product_category", "custom_aluminium_metres",
    "custom_aluminium_color", "custom_ceiling_sq_m", "custom_glass_sale_mode",
    "custom_width_mm", "custom_height_mm", "custom_base_width_ft", "custom_base_height_ft",
    "custom_width_ft", "custom_height_ft", "custom_width_allowance", "custom_height_allowance",
    "custom_area_sqft", "custom_perimeter_rft", "custom_polishing", "custom_holes",
    "custom_hole_type", "custom_notches", "custom_notch_type", "custom_polish_width_sides",
    "custom_polish_height_sides", "custom_polish_type", "custom_sandblast_type",
    "custom_numbering", "custom_sheet_size", "custom_sheet_sft", "custom_sheet_pcs",
)


def _invoice_edit_block_reasons(invoice):
    reasons = []
    if "System Manager" not in frappe.get_roles():
        reasons.append("Only a System Manager can edit a submitted invoice.")
    if invoice.docstatus != 1:
        reasons.append("Only submitted invoices can be edited this way.")
    if invoice.get("is_return"):
        reasons.append("Credit notes and returns cannot be edited here.")
    if invoice.get("amended_from"):
        reasons.append("Amended invoices are administrative-only and cannot be edited here.")
    if frappe.db.exists("Sales Invoice", {"amended_from": invoice.name}):
        reasons.append("This invoice has already been amended.")
    if frappe.db.exists("Sales Invoice", {"return_against": invoice.name, "docstatus": 1}):
        reasons.append("A credit note / return exists against this invoice.")
    return reasons


@frappe.whitelist()
def get_invoice_edit_eligibility(name):
    if not name or not frappe.db.exists("Sales Invoice", name):
        return {"can_edit": False, "reasons": ["Sales Invoice not found."]}
    invoice = frappe.get_doc("Sales Invoice", name)
    reasons = _invoice_edit_block_reasons(invoice)
    return {"can_edit": not reasons, "reasons": reasons}


def _invoice_income_map(invoice):
    """{income_account: total base_net_amount} across all rows, 2dp."""
    income = {}
    for row in invoice.items:
        acc = row.income_account or ""
        income[acc] = flt(income.get(acc, 0)) + flt(row.base_net_amount, 2)
    return {acc: flt(amt, 2) for acc, amt in income.items()}


def _invoice_edit_stock_map(rows, jc_has_sheet_consumption):
    """Aggregate what invoice-time stock deduction the given manual rows imply:
    {item_code: {"qty": ledger_uom_qty, "sheets": {size: pcs}}} — mirroring the
    category logic of _record_ceiling_releases / _record_job_card_item_releases.
    Rows whose stock moved at JC Operations time (laminated glass, and resized/custom
    glass when the job card carries sheet-consumption JSON) are returned separately
    as `excluded` so callers can warn instead of adjusting them."""
    stock_map = {}
    excluded = {}

    def _add(item_code, qty, sheets=None):
        slot = stock_map.setdefault(item_code, {"qty": 0.0, "sheets": {}})
        slot["qty"] += flt(qty)
        for size, pcs in (sheets or {}).items():
            slot["sheets"][size] = flt(slot["sheets"].get(size, 0)) + flt(pcs)

    for row in rows:
        category = getattr(row, "custom_product_category", "") or ""
        native_qty = _get_partial_row_native_full(row)

        if category in ("Aluminium", "Fittings", "Rubber", "Silicone"):
            if native_qty > 0.0001:
                _add(row.item_code, native_qty)

        elif _is_ceiling_bundle_row(row):
            sqm = flt(getattr(row, "custom_ceiling_sq_m", 0))
            if sqm > 0.0001:
                _add(row.item_code, sqm)
                for comp in CEILING_COMPONENTS:
                    if comp.get("uses_parent_item"):
                        continue
                    comp_qty = get_ceiling_whole_piece_qty(sqm, comp["ratio"], comp["mode"])
                    if comp_qty > 0.0001:
                        _add(comp["item_code"], comp_qty)

        elif category == "Glass":
            glass_type = frappe.get_cached_value("Item", row.item_code, "custom_glass_type")
            sale_mode = getattr(row, "custom_glass_sale_mode", "") or ""
            if glass_type == "Laminated" or (
                jc_has_sheet_consumption and sale_mode in ("Resized", "Custom")
            ):
                # Deducted via JC Operations (sheet consumption), keyed to quotation
                # rows — not safely adjustable from invoice rows.
                excluded[row.item_code] = flt(excluded.get(row.item_code, 0)) + native_qty
                continue
            sft = _native_release_qty_to_sft(row, native_qty)
            if sft > 0.0001:
                sheets = None
                if sale_mode == "Sheet" and getattr(row, "custom_sheet_size", ""):
                    sheets = {row.custom_sheet_size: native_qty}
                _add(row.item_code, sft, sheets)

    return stock_map, excluded


def _create_invoice_edit_stock_entry(entry_type, rows, company, job_card_name, invoice_name):
    """One corrective Stock Entry for an invoice edit. Material Issue keeps the
    'Deducted for CAW Job Card:' remark convention so deduction reports still match;
    Material Receipt deliberately uses 'Returned for...' so they don't double-count."""
    entry = frappe.new_doc("Stock Entry")
    entry.stock_entry_type = entry_type
    entry.company = company
    if entry_type == "Material Issue":
        entry.remarks = f"Deducted for CAW Job Card: {job_card_name}\nInvoice Edit: {invoice_name}"
    else:
        entry.remarks = f"Returned for CAW Job Card: {job_card_name} (Invoice Edit: {invoice_name})"
    if invoice_name:
        entry.custom_sales_invoice = invoice_name
    for r in rows:
        item_dict = {"item_code": r["item_code"], "qty": round(flt(r["qty"]), 4)}
        if entry_type == "Material Issue":
            item_dict["s_warehouse"] = r["warehouse"]
        else:
            item_dict["t_warehouse"] = r["warehouse"]
        if r.get("description"):
            item_dict["description"] = r["description"]
        entry.append("items", item_dict)
    entry.flags.ignore_permissions = True
    entry.insert()
    entry.submit()
    return entry.name


def _apply_invoice_edit_stock_deltas(old_rows, invoice, job_card_name, warnings):
    """Create corrective Stock Entries covering the difference between the old and
    new manual rows (invoice-time-deducted categories only). Returns entry names."""
    jc_sheet_json = None
    if job_card_name:
        jc_sheet_json = frappe.db.get_value("CAW Job Card", job_card_name, "custom_sheet_consumption_json")
    jc_has_sheets = bool(jc_sheet_json and json.loads(jc_sheet_json or "{}"))

    new_rows = [r for r in invoice.items if not getattr(r, "custom_auto_generated", 0)]
    old_map, old_excluded = _invoice_edit_stock_map(old_rows, jc_has_sheets)
    new_map, new_excluded = _invoice_edit_stock_map(new_rows, jc_has_sheets)

    for item_code in set(old_excluded) | set(new_excluded):
        if abs(flt(old_excluded.get(item_code, 0)) - flt(new_excluded.get(item_code, 0))) > 0.0001:
            warnings.append(
                f"Stock for {item_code} was deducted via JC Operations and was NOT "
                "auto-adjusted — correct it from the Job Card's JC Operations."
            )

    company = _get_default_stock_company()
    warehouse = _get_default_receiving_warehouse(company)
    issues, receipts = [], []

    for item_code in sorted(set(old_map) | set(new_map)):
        old_slot = old_map.get(item_code, {"qty": 0, "sheets": {}})
        new_slot = new_map.get(item_code, {"qty": 0, "sheets": {}})
        delta = flt(new_slot["qty"]) - flt(old_slot["qty"])

        sheet_deltas = {}
        for size in set(old_slot["sheets"]) | set(new_slot["sheets"]):
            d = flt(new_slot["sheets"].get(size, 0)) - flt(old_slot["sheets"].get(size, 0))
            if abs(d) > 0.0001:
                sheet_deltas[size] = d

        if abs(delta) <= 0.0001:
            if sheet_deltas:
                warnings.append(
                    f"Sheet size mix for {item_code} changed without a net SFT change — "
                    "the derived sheet-count ledger may drift; review it manually."
                )
            continue

        consumed = [{"size": s, "pcs": d} for s, d in sheet_deltas.items() if d > 0]
        returned = [{"size": s, "pcs": -d} for s, d in sheet_deltas.items() if d < 0]
        if delta > 0:
            issues.append({
                "item_code": item_code, "qty": delta, "warehouse": warehouse,
                "description": f"Sheets Consumed: {json.dumps(consumed)}" if consumed else None,
            })
        else:
            receipts.append({
                "item_code": item_code, "qty": -delta, "warehouse": warehouse,
                "description": f"Sheets Returned: {json.dumps(returned)}" if returned else None,
            })

    entries = []
    if issues:
        entries.append(_create_invoice_edit_stock_entry("Material Issue", issues, company, job_card_name, invoice.name))
    if receipts:
        entries.append(_create_invoice_edit_stock_entry("Material Receipt", receipts, company, job_card_name, invoice.name))
    return entries


def _sync_invoice_edit_release_records(invoice, job_card_name, warnings):
    """Bring CAW Job Card Release / CAW Ceiling Release rows and Quotation Item
    collected quantities in line with the invoice's new manual rows. Matching is by
    item_code within this invoice; ambiguous duplicates are skipped with a warning."""
    visual_vat = _invoice_uses_visual_vat(invoice)

    def _release_amount(row):
        amt = flt(row.amount)
        return _round_job_card_amount(amt * (1 + VAT_RATE)) if visual_vat else _round_job_card_amount(amt)

    new_rows = [r for r in invoice.items if not getattr(r, "custom_auto_generated", 0)]
    new_by_item = {}
    for r in new_rows:
        new_by_item.setdefault(r.item_code, []).append(r)

    quotation_name = invoice.get("custom_source_quotation")
    quotation_rows_by_item = {}
    if quotation_name and frappe.db.exists("Quotation", quotation_name):
        for qrow in frappe.get_doc("Quotation", quotation_name).items:
            if not getattr(qrow, "custom_auto_generated", 0):
                quotation_rows_by_item.setdefault(qrow.item_code, []).append(qrow)

    def _shift_collected_qty(quotation_item_name, delta_native):
        if not quotation_item_name or abs(delta_native) <= 0.0001:
            return
        qrow = frappe.db.get_value(
            "Quotation Item", quotation_item_name,
            ["name", "custom_collected_qty"], as_dict=True,
        )
        if not qrow:
            return
        full = _get_partial_row_native_full(frappe.get_doc("Quotation Item", quotation_item_name))
        new_val = min(max(flt(qrow.custom_collected_qty) + delta_native, 0), full or flt(qrow.custom_collected_qty) + delta_native)
        frappe.db.set_value("Quotation Item", quotation_item_name, "custom_collected_qty", new_val)

    release_rows = frappe.get_all(
        "CAW Job Card Release",
        filters={"sales_invoice": invoice.name},
        fields=["name", "item_code", "qty_released", "quotation_item"],
    )
    releases_by_item = {}
    for rel in release_rows:
        releases_by_item.setdefault(rel.item_code, []).append(rel)

    for item_code in set(releases_by_item) | set(new_by_item):
        rels = releases_by_item.get(item_code, [])
        rows = new_by_item.get(item_code, [])

        if len(rels) > 1 or len(rows) > 1:
            warnings.append(
                f"Release records for {item_code} are ambiguous (duplicate rows) and were not updated."
            )
            continue

        if rels and rows:
            rel, row = rels[0], rows[0]
            new_native = _get_partial_row_native_full(row)
            delta = new_native - flt(rel.qty_released)
            if abs(delta) > 0.0001:
                frappe.db.set_value("CAW Job Card Release", rel.name, {
                    "qty_released": flt(new_native),
                    "amount": _release_amount(row),
                })
                _shift_collected_qty(rel.quotation_item, delta)
        elif rels:
            rel = rels[0]
            _shift_collected_qty(rel.quotation_item, -flt(rel.qty_released))
            frappe.delete_doc("CAW Job Card Release", rel.name, ignore_permissions=True, force=True)
        else:
            row = rows[0]
            new_native = _get_partial_row_native_full(row)
            qrows = quotation_rows_by_item.get(item_code, [])
            quotation_item = qrows[0].name if len(qrows) == 1 else None
            frappe.get_doc({
                "doctype": "CAW Job Card Release",
                "job_card": job_card_name,
                "quotation": quotation_name,
                "sales_invoice": invoice.name,
                "quotation_item": quotation_item,
                "item_code": row.item_code,
                "item_name": row.item_name or row.item_code,
                "category": getattr(row, "custom_product_category", "") or "",
                "qty_released": flt(new_native),
                "uom": row.uom or "",
                "amount": _release_amount(row),
                "is_partial": 1 if invoice.get("custom_is_partial") else 0,
                "changed_by": frappe.session.user,
            }).insert(ignore_permissions=True)
            _shift_collected_qty(quotation_item, new_native)
            if not quotation_item:
                warnings.append(
                    f"Added item {item_code} could not be traced to a quotation row — "
                    "remaining-to-release tracking was not updated for it."
                )

    # Ceiling piece-breakdown audit rows.
    ceiling_rows = frappe.get_all(
        "CAW Ceiling Release",
        filters={"sales_invoice": invoice.name},
        fields=["name", "item_code"],
    )
    ceiling_by_item = {}
    for rel in ceiling_rows:
        ceiling_by_item.setdefault(rel.item_code, []).append(rel)
    new_ceiling_by_item = {}
    for r in new_rows:
        if _is_ceiling_bundle_row(r):
            new_ceiling_by_item.setdefault(r.item_code, []).append(r)

    for item_code in set(ceiling_by_item) | set(new_ceiling_by_item):
        rels = ceiling_by_item.get(item_code, [])
        rows = new_ceiling_by_item.get(item_code, [])
        if len(rels) > 1 or len(rows) > 1:
            warnings.append(
                f"Ceiling release records for {item_code} are ambiguous and were not updated."
            )
            continue
        if rows:
            row = rows[0]
            sqm = flt(getattr(row, "custom_ceiling_sq_m", 0))
            pieces = {
                c["item_code"]: get_ceiling_whole_piece_qty(sqm, c["ratio"], c["mode"])
                for c in CEILING_COMPONENTS
                if not c.get("uses_parent_item")
            }
            values = {
                "released_json": json.dumps(pieces),
                "amount_paid": _release_amount(row),
                "changed_by": frappe.session.user,
            }
            if rels:
                frappe.db.set_value("CAW Ceiling Release", rels[0].name, values)
            else:
                qrows = quotation_rows_by_item.get(item_code, [])
                frappe.get_doc({
                    "doctype": "CAW Ceiling Release",
                    "job_card": job_card_name,
                    "quotation": quotation_name,
                    "sales_invoice": invoice.name,
                    "quotation_item": qrows[0].name if len(qrows) == 1 else None,
                    "item_code": row.item_code,
                    "item_name": row.item_name or row.item_code,
                    "snapshot_json": json.dumps(_get_ceiling_snapshot(qrows[0])) if len(qrows) == 1 else "{}",
                    **values,
                }).insert(ignore_permissions=True)
        elif rels:
            frappe.delete_doc("CAW Ceiling Release", rels[0].name, ignore_permissions=True, force=True)


def _repost_invoice_income_gl(invoice, old_income_map):
    """If the edit shifted amounts between income accounts, rebuild just those GL
    rows. Debtors/tax rows are untouched — the grand total is unchanged by design."""
    new_income_map = _invoice_income_map(invoice)
    if new_income_map == old_income_map:
        return False

    accounts = [a for a in set(old_income_map) | set(new_income_map) if a]
    frappe.db.delete("GL Entry", {
        "voucher_type": "Sales Invoice",
        "voucher_no": invoice.name,
        "account": ["in", accounts],
    })
    from erpnext.accounts.general_ledger import make_entry
    for gl in invoice.get_gl_entries():
        if gl.get("account") in accounts:
            make_entry(gl, adv_adj=False, update_outstanding="No", from_repost=True)
    return True


@frappe.whitelist()
def edit_submitted_invoice_items(name, items):
    """Edit a SUBMITTED Sales Invoice's manual item rows in place (no cancel/amend).
    The grand total must remain exactly the same; stock and release bookkeeping are
    auto-corrected for categories deducted at invoice time. System Manager only."""
    frappe.only_for("System Manager")
    if not name or not frappe.db.exists("Sales Invoice", name):
        frappe.throw("Please select a valid Sales Invoice.")

    invoice = frappe.get_doc("Sales Invoice", name)
    reasons = _invoice_edit_block_reasons(invoice)
    if reasons:
        frappe.throw("<br>".join(reasons))

    if isinstance(items, str):
        items = json.loads(items)
    if not items:
        frappe.throw("The invoice must keep at least one item row.")

    # ── Snapshot the old state before touching anything ──────────────
    old_grand_total = flt(invoice.grand_total, 2)
    old_income_map = _invoice_income_map(invoice)
    old_manual_rows = [r.as_dict() for r in invoice.items if not getattr(r, "custom_auto_generated", 0)]
    old_rows_by_name = {r.name: r for r in invoice.items}

    # ── Rebuild the manual rows from the payload ──────────────────────
    kept_rows = []
    for payload in items:
        row_name = payload.get("row_name")
        if row_name:
            row = old_rows_by_name.get(row_name)
            if not row or getattr(row, "custom_auto_generated", 0):
                frappe.throw(f"Row {row_name} does not belong to this invoice.")
        else:
            row = invoice.append("items", {})
        for field in INVOICE_EDIT_ITEM_FIELDS:
            if field in payload:
                row.set(field, payload.get(field))
        if not row.item_code:
            frappe.throw("Every row must have an Item Code.")
        kept_rows.append(row)
    invoice.items = kept_rows
    for idx, row in enumerate(invoice.items, start=1):
        row.idx = idx

    # ── Re-run the pricing engine (regenerates auto service rows) ─────
    from crystal_alluminium_works import sales_invoice_handler
    sales_invoice_handler.on_validate(invoice, None)
    # on_validate only recalculates when it generated auto rows — always recalc.
    invoice.calculate_taxes_and_totals()

    # ── Total lock (±2 tolerance for rounding/cents drift) ─────────────
    INVOICE_EDIT_TOTAL_TOLERANCE = 2
    if abs(flt(invoice.grand_total, 2) - old_grand_total) > INVOICE_EDIT_TOTAL_TOLERANCE:
        frappe.throw(
            f"The grand total must stay within {frappe.utils.fmt_money(INVOICE_EDIT_TOTAL_TOLERANCE, currency=invoice.currency)} "
            f"of the original. Original: {frappe.utils.fmt_money(old_grand_total, currency=invoice.currency)}, "
            f"after edit: {frappe.utils.fmt_money(flt(invoice.grand_total, 2), currency=invoice.currency)}. "
            "Adjust quantities/rates so the totals match."
        )

    # ── Persist in place (update-after-submit path) ────────────────────
    invoice.flags.ignore_permissions = True
    invoice.flags.ignore_validate_update_after_submit = True
    invoice.save()

    gl_reposted = _repost_invoice_income_gl(invoice, old_income_map)

    # ── Stock + release bookkeeping ────────────────────────────────────
    warnings = []
    job_card_name = invoice.get("custom_source_job_card")
    if not job_card_name and invoice.get("custom_source_quotation"):
        job_card_name = _resolve_job_card_for_quotation(invoice.custom_source_quotation)

    stock_entries = []
    if job_card_name:
        old_row_objs = [frappe._dict(r) for r in old_manual_rows]
        stock_entries = _apply_invoice_edit_stock_deltas(old_row_objs, invoice, job_card_name, warnings)
        _sync_invoice_edit_release_records(invoice, job_card_name, warnings)
    else:
        warnings.append("No source job card found — stock and release records were not adjusted.")

    # ── Audit comment ──────────────────────────────────────────────────
    def _row_desc(r):
        return f"{r.get('item_code')} × {flt(r.get('qty'))} @ {flt(r.get('rate'))} = {flt(r.get('amount'))}"
    new_manual = [r.as_dict() for r in invoice.items if not getattr(r, "custom_auto_generated", 0)]
    comment_lines = ["<b>Invoice items edited (submitted, total locked)</b>", "Before:"]
    comment_lines += [f"• {_row_desc(r)}" for r in old_manual_rows]
    comment_lines.append("After:")
    comment_lines += [f"• {_row_desc(r)}" for r in new_manual]
    if stock_entries:
        comment_lines.append("Stock corrections: " + ", ".join(stock_entries))
    if gl_reposted:
        comment_lines.append("Income GL rows reposted.")
    invoice.add_comment("Comment", "<br>".join(comment_lines))

    return {
        "name": invoice.name,
        "grand_total": invoice.grand_total,
        "stock_entries": stock_entries,
        "warnings": warnings,
    }


def _relink_ceiling_releases(invoice):
    """Move CAW Ceiling Release audit rows from the cancelled invoice to its amendment so a
    physical release stays a single event across invoice revisions."""
    if not invoice.get("amended_from"):
        return
    frappe.db.set_value(
        "CAW Ceiling Release",
        {"sales_invoice": invoice.amended_from},
        "sales_invoice",
        invoice.name,
        update_modified=False,
    )


def _submit_amended_partial_invoice(invoice, job_card):
    """Submit an administratively-amended partial invoice: settle it, re-apply the same
    payment impact exactly once (the amount cannot have changed), and re-link releases."""
    paid_invoice = _submit_and_settle_job_card_sales_invoice(invoice, job_card, preserve_payment=True)

    impact = _round_job_card_amount(_get_invoice_display_amount(paid_invoice.grand_total, paid_invoice))
    job_card.reload()
    quotation_amount = _round_job_card_amount(job_card.quotation_amount)
    new_payment = _round_job_card_amount(flt(job_card.payment_amount) + impact)
    if quotation_amount > 0:
        new_payment = min(new_payment, quotation_amount)
    job_card.payment_amount = new_payment
    job_card.balance_amount = _round_job_card_amount(max(quotation_amount - new_payment, 0))
    job_card.flags.ignore_permissions = True
    job_card.save(ignore_permissions=True)

    _relink_ceiling_releases(paid_invoice)
    _write_job_card_amendment_event(
        job_card, "Invoice Amended", amount_paid=impact, note=f"Re-submitted as {paid_invoice.name}"
    )
    return paid_invoice


def on_sales_invoice_submit(doc, method):
    """When a Sales Return (qty-reversing credit note) is submitted against a job-card
    invoice, give back the returned quantity on custom_collected_qty so 'remaining to
    invoice' stays correct. Price-only credit notes and non-job-card invoices are ignored,
    and ambiguous row mappings are skipped (the counter stays conservatively low, which can
    never cause over-billing)."""
    if not doc.get("is_return") or not doc.get("return_against"):
        return
    original = frappe.db.get_value(
        "Sales Invoice", doc.return_against, ["custom_source_quotation"], as_dict=True
    )
    if not original or not original.custom_source_quotation:
        return
    job_card_name = _resolve_job_card_for_quotation(original.custom_source_quotation)
    if not job_card_name:
        return
    quotation_name = frappe.db.get_value("CAW Job Card", job_card_name, "quotation")
    if not quotation_name or not frappe.db.exists("Quotation", quotation_name):
        return
    quotation = frappe.get_doc("Quotation", quotation_name)

    rows_by_item = {}
    for row in quotation.items:
        if getattr(row, "custom_auto_generated", 0):
            continue
        rows_by_item.setdefault(row.item_code, []).append(row)

    for ret in doc.items:
        if getattr(ret, "custom_auto_generated", 0):
            continue
        candidates = rows_by_item.get(ret.item_code)
        if not candidates or len(candidates) != 1:
            continue  # ambiguous mapping — leave the counter untouched (safe direction)
        qrow = candidates[0]
        if _is_ceiling_bundle_row(qrow):
            continue  # ceiling native unit is sq m, not row qty — skip to stay safe
        current = flt(getattr(qrow, "custom_collected_qty", 0))
        if current <= 0:
            continue
        returned_native = abs(flt(ret.qty))
        frappe.db.set_value(
            "Quotation Item", qrow.name, "custom_collected_qty", max(current - returned_native, 0)
        )


@frappe.whitelist()
def delete_all_sales_orders():
    def clear_missing_quotation_links(sales_order):
        for row in sales_order.items:
            quotation_name = row.get("prevdoc_docname")
            if quotation_name and not frappe.db.exists("Quotation", quotation_name):
                frappe.db.set_value(
                    "Sales Order Item",
                    row.name,
                    {
                        "prevdoc_docname": None,
                        "quotation_item": None,
                    },
                    update_modified=False,
                )
                row.prevdoc_docname = None
                row.quotation_item = None

    sales_order_names = frappe.get_all(
        "Sales Order",
        filters={"docstatus": ["<", 2]},
        pluck="name",
        order_by="creation desc",
    )

    deleted = []
    for sales_order_name in sales_order_names:
        sales_order = frappe.get_doc("Sales Order", sales_order_name)
        if sales_order.docstatus == 1:
            clear_missing_quotation_links(sales_order)
            sales_order.cancel()

        frappe.delete_doc("Sales Order", sales_order_name, ignore_permissions=True, force=1)
        deleted.append(sales_order_name)

    cancelled_only = frappe.get_all(
        "Sales Order",
        filters={"docstatus": 2},
        pluck="name",
        order_by="creation desc",
    )
    for sales_order_name in cancelled_only:
        frappe.delete_doc("Sales Order", sales_order_name, ignore_permissions=True, force=1)
        deleted.append(sales_order_name)

    return {"deleted_count": len(deleted), "deleted_sales_orders": deleted}


@frappe.whitelist()
def delete_all_quotations():
    quotation_names = frappe.get_all(
        "Quotation",
        filters={"docstatus": ["<", 2]},
        pluck="name",
        order_by="creation desc",
    )

    deleted = []
    for quotation_name in quotation_names:
        quotation = frappe.get_doc("Quotation", quotation_name)
        if quotation.docstatus == 1:
            quotation.cancel()

        frappe.delete_doc("Quotation", quotation_name, ignore_permissions=True, force=1)
        deleted.append(quotation_name)

    cancelled_only = frappe.get_all(
        "Quotation",
        filters={"docstatus": 2},
        pluck="name",
        order_by="creation desc",
    )
    for quotation_name in cancelled_only:
        frappe.delete_doc("Quotation", quotation_name, ignore_permissions=True, force=1)
        deleted.append(quotation_name)

    return {"deleted_count": len(deleted), "deleted_quotations": deleted}

@frappe.whitelist()
def calculate_glass_total(item_code, price_list, qty, sale_mode, width_mm, height_mm,
                          polishing=None, holes=0, sandblast_type=None,
                          polish_width_sides=0, polish_height_sides=0, notches=0,
                          width_allowance=0, height_allowance=0,
                          polish_type=None, hole_type=None, notch_type=None):
    """
    Calculates the full composite total for a Glass item in the Quotation Builder,
    including glass base cost and all applicable service costs (polishing, drilling, sandblasting).
    Returns a breakdown so the frontend can display and store the correct total.
    """
    from crystal_alluminium_works.pricing_engine import mm_to_ft, mm_to_piece_rft, get_polishing_rft

    width_mm = float(width_mm or 0)
    height_mm = float(height_mm or 0)
    width_allowance = frappe.utils.flt(width_allowance or 0)
    height_allowance = frappe.utils.flt(height_allowance or 0)
    qty = frappe.utils.flt(qty or 1)
    holes = int(holes or 0)
    notches = int(notches or 0)
    polish_width_sides = frappe.utils.cint(polish_width_sides or 0)
    polish_height_sides = frappe.utils.cint(polish_height_sides or 0)
    polishing = int(polishing or 0)
    sandblast_type = sandblast_type or "None"

    # --- Base glass rate (from selected selling price, fallback to hidden retail-backed standard_rate) ---
    item_price = frappe.db.get_value(
        "Item Price",
        {"item_code": item_code, "price_list": price_list, "selling": 1},
        "price_list_rate"
    )
    base_rate = float(item_price or frappe.get_cached_value("Item", item_code, "standard_rate") or 0.0) / 1.16

    breakdown = []
    total = 0.0

    if sale_mode in ("Full Sheet", "Sheet"):
        amount = qty * float(base_rate)
        label = "Glass (Sheet)" if sale_mode == "Sheet" else "Glass (Full Sheet)"
        breakdown.append({"label": label, "qty": qty, "rate": base_rate, "amount": amount})
        total = amount
        return {"total": total, "breakdown": breakdown}

    # --- Dimensions ---
    glass_type = frappe.db.get_value("Item", item_code, "custom_glass_type") or "Ordinary"
    base_width_ft = mm_to_ft(width_mm, glass_type=glass_type) if width_mm else 0.0
    base_height_ft = mm_to_ft(height_mm, glass_type=glass_type) if height_mm else 0.0
    width_ft = base_width_ft + width_allowance
    height_ft = base_height_ft + height_allowance
    area_sqft = width_ft * height_ft
    perimeter_rft = get_polishing_rft(
        mm_to_piece_rft(width_mm),
        mm_to_piece_rft(height_mm),
        qty,
        polish_width_sides,
        polish_height_sides,
        polishing,
    )

    glass_qty = qty * area_sqft
    glass_amount = glass_qty * float(base_rate)
    breakdown.append({"label": "Glass", "qty": round(glass_qty, 4), "rate": base_rate, "amount": glass_amount})
    total += glass_amount

    # --- Service rates: uses global Glass Pricing Settings ---
    try:
        settings = frappe.get_single("Glass Pricing Settings")
    except Exception:
        settings = frappe._dict(polishing_rate=0, hole_rate=0, notch_rate=0, sandblast_rate=0)

    # Polishing
    if not polish_width_sides and not polish_height_sides and polishing:
        polish_width_sides = 2
        polish_height_sides = 2

    if polish_width_sides or polish_height_sides:
        polish_type, pol_rate = get_glass_service_rate(
            settings,
            GLASS_POLISH_RATE_TYPES,
            polish_type,
            DEFAULT_GLASS_POLISH_TYPE,
            "polishing_rate",
        )
        pol_qty = get_polishing_rft(
            mm_to_piece_rft(width_mm),
            mm_to_piece_rft(height_mm),
            qty,
            polish_width_sides,
            polish_height_sides,
            polishing,
        )
        pol_amount = pol_qty * pol_rate
        breakdown.append({"label": f"Polishing ({polish_type})", "qty": round(pol_qty, 4), "rate": pol_rate, "amount": pol_amount})
        total += pol_amount

    # Holes
    if holes > 0:
        hole_type, hole_rate = get_glass_service_rate(
            settings,
            GLASS_HOLE_RATE_TYPES,
            hole_type,
            DEFAULT_GLASS_HOLE_TYPE,
            "hole_rate",
        )
        hole_qty = qty * holes
        hole_amount = hole_qty * hole_rate
        breakdown.append({"label": f"Hole Drilling ({hole_type})", "qty": hole_qty, "rate": hole_rate, "amount": hole_amount})
        total += hole_amount

    # Notches
    if notches > 0:
        notch_type, notch_rate = get_glass_service_rate(
            settings,
            GLASS_NOTCH_RATE_TYPES,
            notch_type,
            DEFAULT_GLASS_NOTCH_TYPE,
            "notch_rate",
        )
        notch_qty = qty * notches
        notch_amount = notch_qty * notch_rate
        breakdown.append({"label": f"Notching ({notch_type})", "qty": notch_qty, "rate": notch_rate, "amount": notch_amount})
        total += notch_amount

    # Sandblasting
    if sandblast_type in ["Half", "Full"]:
        sb_rate = float(settings.sandblast_rate or 0) / 1.16
        sb_qty = glass_qty / 2.0 if sandblast_type == "Half" else glass_qty
        sb_amount = sb_qty * sb_rate
        breakdown.append({"label": f"Sandblasting ({sandblast_type})", "qty": round(sb_qty, 4), "rate": sb_rate, "amount": sb_amount})
        total += sb_amount

    return {
        "total": total,
        "base_width_ft": base_width_ft,
        "base_height_ft": base_height_ft,
        "area_sqft": area_sqft,
        "perimeter_rft": perimeter_rft,
        "width_ft": width_ft,
        "height_ft": height_ft,
        "base_rate": base_rate,
        "breakdown": breakdown
    }

@frappe.whitelist()
def calculate_ceiling_total(item_code, price_list, quantity):
    quantity = frappe.utils.flt(quantity or 100)
    price_list = price_list or "Retail"
    parent_rate = get_item_rate(item_code, price_list, fallback_rate=0) / 1.16
    parent_amount = quantity * parent_rate
    breakdown = [{
        "label": frappe.get_cached_value("Item", item_code, "item_name") or item_code,
        "qty": quantity,
        "rate": parent_rate,
        "amount": parent_amount,
    }]
    total = parent_amount

    # Ensure component items exist so we can fetch their prices
    try:
        ensure_ceiling_component_items()
    except Exception:
        pass

    for component in CEILING_COMPONENTS:
        piece_qty = get_ceiling_whole_piece_qty(quantity, component["ratio"], component["mode"])
        comp_code = component.get("item_code")
        breakdown.append({
            "label": frappe.get_cached_value("Item", comp_code, "item_name") or comp_code,
            "qty": piece_qty,
            "rate": 0,
            "amount": 0,
        })

    return {
        "total": total,
        "base_rate": parent_rate,
        "base_qty": 1,
        "breakdown": breakdown,
    }

@frappe.whitelist()
def get_items_with_prices(category):
    """
    Fetches all items in the given category, along with their
    Retail and Wholesale prices.
    """
    storage_category = _get_storage_category(category)
    if storage_category == "Aluminium":
        _ensure_aluminium_pricing_storage()
    elif category == "Ceiling":
        _ensure_ceiling_configuration_storage()
    glass_type_field_exists = _item_has_field("custom_glass_type")
    filters = {"item_group": storage_category}
    if category in GLASS_CATEGORY_TO_TYPE and glass_type_field_exists:
        filters["custom_glass_type"] = GLASS_CATEGORY_TO_TYPE[category]

    item_fields = ["name", "item_code", "item_name", "stock_uom", "standard_rate"]
    if glass_type_field_exists:
        item_fields.append("custom_glass_type")
    if _item_has_field("custom_product_code"):
        item_fields.append("custom_product_code")
    if storage_category == "Aluminium":
        if _item_has_field("custom_aluminium_rate_per_kg"):
            item_fields.append("custom_aluminium_rate_per_kg")
        if _item_has_field("custom_aluminium_weight_per_length"):
            item_fields.append("custom_aluminium_weight_per_length")
    items = frappe.get_all("Item", filters=filters, fields=item_fields)

    # Exclude service items from the glass catalog views.
    if storage_category == "Glass":
        service_keywords = ["Polishing", "Drilling", "Sandblasting", "Hole", "Notching", "Notch"]
        items = [i for i in items if not any(k in (i.item_name or "") for k in service_keywords)]
        for item in items:
            item.custom_glass_type = _infer_glass_type(item.item_code, item.item_name, item.get("custom_glass_type"))
        if category in GLASS_CATEGORY_TO_TYPE and not glass_type_field_exists:
            expected_glass_type = GLASS_CATEGORY_TO_TYPE[category]
            items = [item for item in items if item.custom_glass_type == expected_glass_type]
    elif storage_category == "Ceiling":
        deduped_items = {}
        for item in items:
            label = (item.item_name or item.item_code or "").strip()
            existing = deduped_items.get(label)
            if not existing:
                deduped_items[label] = item
                continue

            existing_score = 1 if existing.name == existing.item_name else 0
            current_score = 1 if item.name == item.item_name else 0
            if current_score > existing_score:
                deduped_items[label] = item
        items = list(deduped_items.values())
    
    # Fetch Item Prices for these items
    item_codes = [i.name for i in items]
    if not item_codes:
        return []
        
    prices = frappe.get_all("Item Price",
        filters={"item_code": ("in", item_codes), "price_list": ("in", ["Retail", "Wholesale", "Special"])},
        fields=["item_code", "price_list", "price_list_rate", "name"]
    )
    
    # Map prices to items
    price_map = {}
    for p in prices:
        if p.item_code not in price_map:
            price_map[p.item_code] = {}
        price_map[p.item_code][p.price_list] = {
            "rate": p.price_list_rate,
            "docname": p.name
        }
        
    for item in items:
        item.retail_rate = price_map.get(item.name, {}).get("Retail", {}).get("rate", item.standard_rate or 0)
        item.wholesale_rate = price_map.get(item.name, {}).get("Wholesale", {}).get("rate", 0)
        item.special_rate = price_map.get(item.name, {}).get("Special", {}).get("rate", 0)
        if storage_category == "Aluminium":
            item.aluminium_rate_per_kg = flt(getattr(item, "custom_aluminium_rate_per_kg", 0) or 0)
            item.aluminium_weight_per_length = flt(getattr(item, "custom_aluminium_weight_per_length", 0) or 0)
        
        # If it's a Ceiling item, fetch its Ceiling Configuration
        if category == "Ceiling":
            config = frappe.get_all("Ceiling Configuration", 
                filters={"parent_item": item.name},
                fields=["item_1", "ratio_1", "item_2", "ratio_2", "item_3", "ratio_3", "item_4", "ratio_4"],
                limit=1
            )
            if config:
                item.ceiling_config = config[0]
            else:
                item.ceiling_config = {
                    "item_1": "", "ratio_1": 2.5,
                    "item_2": "", "ratio_2": 2.5,
                    "item_3": "", "ratio_3": 3.0,
                    "item_4": "", "ratio_4": 0.36
                }
        
    return items


@frappe.whitelist()
def get_aluminium_colors():
    _ensure_aluminium_color_doctype()
    return frappe.get_all(
        "Aluminium Color",
        fields=["color_name"],
        order_by="color_name asc",
        pluck="color_name",
    )


@frappe.whitelist()
def save_aluminium_colors(colors):
    _ensure_aluminium_color_doctype()

    colors = json.loads(colors) if isinstance(colors, str) else (colors or [])
    clean_colors = []
    seen = set()
    for color in colors:
        color_name = str(color or "").strip()
        if not color_name:
            continue

        normalized = color_name.lower()
        if normalized in seen:
            continue

        seen.add(normalized)
        clean_colors.append(color_name)

    existing = frappe.get_all("Aluminium Color", fields=["name"])
    for row in existing:
        frappe.delete_doc("Aluminium Color", row.name, ignore_permissions=True, force=1)

    for color_name in clean_colors:
        frappe.get_doc({
            "doctype": "Aluminium Color",
            "color_name": color_name,
        }).insert(ignore_permissions=True)

    frappe.db.commit()
    return clean_colors


def _copy_aluminium_color_between_rows(source_rows, target_rows):
    if not source_rows or not target_rows:
        return

    source_rows = [row for row in source_rows if not getattr(row, "custom_auto_generated", 0)]
    target_rows = [row for row in target_rows if not getattr(row, "custom_auto_generated", 0)]
    if any(getattr(row, "custom_aluminium_color", None) for row in source_rows):
        _ensure_aluminium_color_storage()

    source_by_name = {
        row.name: row for row in source_rows
        if getattr(row, "name", None)
    }

    fallback_index = 0
    for target_row in target_rows:
        source_row = None
        prev_detail = getattr(target_row, "prevdoc_detail_docname", None)
        if prev_detail and prev_detail in source_by_name:
            source_row = source_by_name[prev_detail]
        elif fallback_index < len(source_rows):
            source_row = source_rows[fallback_index]
            fallback_index += 1

        if source_row and hasattr(target_row, "custom_aluminium_color"):
            target_row.custom_aluminium_color = getattr(source_row, "custom_aluminium_color", None)

def _save_item_price(item_code, price_list, rate):
    if rate is None:
        return

    _ensure_price_list_exists(price_list)

    price_name = frappe.db.get_value("Item Price", {
        "item_code": item_code,
        "price_list": price_list
    }, "name")

    if price_name:
        frappe.db.set_value("Item Price", price_name, "price_list_rate", rate)
    else:
        ip = frappe.new_doc("Item Price")
        ip.item_code = item_code
        ip.price_list = price_list
        ip.price_list_rate = rate
        ip.save(ignore_permissions=True)

@frappe.whitelist()
def save_custom_item(data):
    """
    Creates or updates an Item and its associated Item Prices (Retail/Wholesale).
    Payload expects: is_new, category, item_code, item_name, retail_rate, wholesale_rate
    """
    data = json.loads(data) if isinstance(data, str) else data
    
    item_code = (data.get("item_code") or "").strip()
    original_item_code = (data.get("original_item_code") or item_code).strip()
    category = data.get("category")
    storage_category = _get_storage_category(category)
    is_new = data.get("is_new")
    aluminium_rate_per_kg = flt(data.get("aluminium_rate_per_kg", 0))
    aluminium_weight_per_length = flt(data.get("aluminium_weight_per_length", 0))
    retail_rate = data.get("retail_rate", 0)
    wholesale_rate = data.get("wholesale_rate", 0)
    special_rate = data.get("special_rate", 0)
    item_name = (data.get("item_name") or item_code).strip()
    glass_type = _get_glass_type_for_category(category, data.get("glass_type"))
    aluminium_type = _normalize_aluminium_type(
        data.get("aluminium_type"),
        data.get("existing_aluminium_type"),
    ) if storage_category == "Aluminium" else None
    product_code = _get_product_code(category, glass_type=glass_type, aluminium_type=aluminium_type, item_name=item_name)

    if not item_code:
        frappe.throw("Item Code is required.")
    if not item_name:
        frappe.throw("Item Name is required.")
    if storage_category == "Aluminium" and (aluminium_rate_per_kg < 0 or aluminium_weight_per_length < 0):
        frappe.throw("Aluminium rate/kg and weight/length cannot be negative.")

    if storage_category == "Glass":
        _ensure_glass_type_storage()
        _ensure_product_code_storage()
        _ensure_glass_type_options()
    elif storage_category == "Aluminium":
        _ensure_product_code_storage()
        _ensure_aluminium_pricing_storage()
        aluminium_prices = _get_aluminium_price_components(aluminium_rate_per_kg, aluminium_weight_per_length)
        retail_rate = aluminium_prices["normal_price"]
        wholesale_rate = aluminium_prices["mill_finished_price"]
        special_rate = aluminium_prices["special_price"]
    elif category == "Ceiling":
        _ensure_product_code_storage()
        _ensure_ceiling_configuration_storage()
    
    # Determine UOM based on category
    uom = _get_category_uom(category)

    _ensure_item_group_exists(storage_category)
    _ensure_uom_exists(uom)
        
    if is_new:
        if frappe.db.exists("Item", item_code):
            frappe.throw(f"Item Code {item_code} already exists.")
            
        item = frappe.get_doc({
            "doctype": "Item",
            "item_code": item_code,
            "item_name": item_name,
            "item_group": storage_category,
            "stock_uom": uom,
            "is_stock_item": 1,
            "standard_rate": retail_rate,
        })
        if _item_has_field("custom_glass_type"):
            item.custom_glass_type = glass_type if storage_category == "Glass" else None
        if _item_has_field("custom_aluminium_type"):
            item.custom_aluminium_type = aluminium_type if storage_category == "Aluminium" else None
        if _item_has_field("custom_aluminium_rate_per_kg"):
            item.custom_aluminium_rate_per_kg = aluminium_rate_per_kg if storage_category == "Aluminium" else 0
        if _item_has_field("custom_aluminium_weight_per_length"):
            item.custom_aluminium_weight_per_length = aluminium_weight_per_length if storage_category == "Aluminium" else 0
        if _item_has_field("custom_product_code"):
            item.custom_product_code = product_code
        _ensure_item_has_default_uom(item, uom)
        item.insert(ignore_permissions=True)
    else:
        if item_code != original_item_code:
            if frappe.db.exists("Item", item_code):
                frappe.throw(f"Item Code {item_code} already exists.")
            rename_doc("Item", original_item_code, item_code, force=True, ignore_permissions=True)

        item = frappe.get_doc("Item", item_code)
        item.item_code = item_code
        item.item_name = item_name
        item.item_group = storage_category
        item.is_stock_item = 1
        item.standard_rate = retail_rate
        if _item_has_field("custom_glass_type"):
            item.custom_glass_type = glass_type if storage_category == "Glass" else None
        if _item_has_field("custom_aluminium_type"):
            item.custom_aluminium_type = aluminium_type if storage_category == "Aluminium" else None
        if _item_has_field("custom_aluminium_rate_per_kg"):
            item.custom_aluminium_rate_per_kg = aluminium_rate_per_kg if storage_category == "Aluminium" else 0
        if _item_has_field("custom_aluminium_weight_per_length"):
            item.custom_aluminium_weight_per_length = aluminium_weight_per_length if storage_category == "Aluminium" else 0
        if _item_has_field("custom_product_code"):
            item.custom_product_code = product_code
        # Existing items keep their current stock UOM; changing it is blocked
        # by ERPNext once transactions exist, and this page never intends to
        # change UOM — only prices.
        _ensure_item_has_default_uom(item, item.stock_uom)
        item.save(ignore_permissions=True)
        
    # Save Item Prices
    _save_item_price(item_code, "Retail", retail_rate)
    _save_item_price(item_code, "Wholesale", wholesale_rate)
    _save_item_price(item_code, "Special", special_rate)

    # Save Ceiling Configuration if applicable
    if category == "Ceiling" and "ceiling_config" in data:
        cfg = data["ceiling_config"]
        cfg_name = _get_single_config_docname("Ceiling Configuration", item_code, original_item_code)
        if cfg_name:
            doc = frappe.get_doc("Ceiling Configuration", cfg_name)
            doc.parent_item = item_code
            doc.item_1 = cfg.get("item_1")
            doc.ratio_1 = cfg.get("ratio_1", 2.5)
            doc.item_2 = cfg.get("item_2")
            doc.ratio_2 = cfg.get("ratio_2", 2.5)
            doc.item_3 = cfg.get("item_3")
            doc.ratio_3 = cfg.get("ratio_3", 3.0)
            doc.item_4 = cfg.get("item_4")
            doc.ratio_4 = cfg.get("ratio_4", 0.36)
            doc.save(ignore_permissions=True)
        else:
            doc = frappe.get_doc({
                "doctype": "Ceiling Configuration",
                "parent_item": item_code,
                "item_1": cfg.get("item_1"), "ratio_1": cfg.get("ratio_1", 2.5),
                "item_2": cfg.get("item_2"), "ratio_2": cfg.get("ratio_2", 2.5),
                "item_3": cfg.get("item_3"), "ratio_3": cfg.get("ratio_3", 3.0),
                "item_4": cfg.get("item_4"), "ratio_4": cfg.get("ratio_4", 0.36)
            })
            doc.insert(ignore_permissions=True)
    
    return item.name


@frappe.whitelist()
def download_glass_builder_template():
    headers = [[
        "width",
        "height",
        "w+",
        "h+",
        "pcs",
        "holes",
        "notches",
        "sandblast",
        "polish_width_side",
        "polish_height_side",
        "numbering",
        "details",
    ]]
    sample = [[
        600,
        900,
        0,
        0,
        1,
        2,
        0,
        0.5,
        2,
        2,
        1,
        "",
    ], [
        1200,
        900,
        0.25,
        0.25,
        2,
        1,
        1,
        1,
        2,
        1,
        2,
        "Office partition",
    ]]
    return _build_xlsx_file("glass_builder_template", headers + sample)


@frappe.whitelist()
def export_glass_items_from_builder(items):
    items = json.loads(items) if isinstance(items, str) else (items or [])
    rows = [[
        "width",
        "height",
        "w+",
        "h+",
        "pcs",
        "holes",
        "notches",
        "sandblast",
        "polish_width_side",
        "polish_height_side",
        "numbering",
        "details",
    ]]

    for idx, item in enumerate(items):
        if item.get("category") != "Glass":
            continue
        rows.append([
            item.get("width_mm", 0),
            item.get("height_mm", 0),
            item.get("width_allowance", 0),
            item.get("height_allowance", 0),
            item.get("qty", 0),
            item.get("holes", 0),
            item.get("notches", 0),
            1 if item.get("sandblast_type") == "Full" else 0.5 if item.get("sandblast_type") == "Half" else 0,
            item.get("polish_width_sides", 0),
            item.get("polish_height_sides", 0),
            idx + 1,
            item.get("description", ""),
        ])

    return _build_xlsx_file("glass_builder_export", rows)


@frappe.whitelist()
def export_quotation_builder_items(data):
    data = json.loads(data) if isinstance(data, str) else (data or [])
    return _build_xlsx_file("Quotation_Export", data)


@frappe.whitelist()
def download_aluminium_items_template():
    rows = [[
        "item_name",
        "code",
        "rate_per_kg",
        "weight_per_length",
    ], [
        "Sample Aluminium Item",
        "A01.1",
        870,
        3.6,
    ]]
    return _build_xlsx_file("aluminium_items_template", rows)


@frappe.whitelist()
def export_aluminium_items():
    _ensure_aluminium_pricing_storage()

    fields = ["item_name", "item_code"]
    if _item_has_field("custom_aluminium_rate_per_kg"):
        fields.append("custom_aluminium_rate_per_kg")
    if _item_has_field("custom_aluminium_weight_per_length"):
        fields.append("custom_aluminium_weight_per_length")

    items = frappe.get_all(
        "Item",
        filters={"item_group": "Aluminium", "disabled": 0},
        fields=fields,
        order_by="item_code asc",
    )

    rows = [[
        "item_name",
        "code",
        "rate_per_kg",
        "weight_per_length",
    ]]
    for item in items:
        rows.append([
            item.item_name or "",
            item.item_code or "",
            flt(getattr(item, "custom_aluminium_rate_per_kg", 0) or 0),
            flt(getattr(item, "custom_aluminium_weight_per_length", 0) or 0),
        ])

    return _build_xlsx_file("aluminium_items_export", rows)


@frappe.whitelist()
def export_glass_items(category):
    storage_category = _get_storage_category(category)
    if storage_category != "Glass":
        frappe.throw("Glass export is only available for glass categories.")

    glass_type_field_exists = _item_has_field("custom_glass_type")
    item_fields = ["item_code", "item_name", "standard_rate"]
    if glass_type_field_exists:
        item_fields.append("custom_glass_type")

    items = frappe.get_all(
        "Item",
        filters={"item_group": "Glass", "disabled": 0},
        fields=item_fields,
        order_by="item_code asc",
    )

    expected_glass_type = _get_glass_type_for_category(category)
    filtered_items = []
    for item in items:
        resolved_glass_type = _infer_glass_type(item.item_code, item.item_name, item.get("custom_glass_type"))
        if resolved_glass_type != expected_glass_type or _is_glass_service_item(item.item_name):
            continue
        filtered_items.append(item)

    item_codes = [item.item_code for item in filtered_items]
    price_map = {}
    if item_codes:
        prices = frappe.get_all(
            "Item Price",
            filters={
                "item_code": ("in", item_codes),
                "price_list": ("in", ["Retail", "Wholesale", "Special"]),
                "selling": 1,
            },
            fields=["item_code", "price_list", "price_list_rate"],
        )
        for price in prices:
            price_map.setdefault(price.item_code, {})[price.price_list] = flt(price.price_list_rate or 0)

    rows = [[
        "description",
        "code",
        "wholesale_rate",
        "retail_rate",
        "special_rate",
    ]]
    for item in filtered_items:
        rows.append([
            item.item_name or "",
            item.item_code or "",
            price_map.get(item.item_code, {}).get("Wholesale", 0),
            price_map.get(item.item_code, {}).get("Retail", flt(item.standard_rate or 0)),
            price_map.get(item.item_code, {}).get("Special", 0),
        ])

    filename = frappe.scrub(f"{category}_items_export") or "glass_items_export"
    return _build_xlsx_file(filename, rows)


@frappe.whitelist()
def export_standard_items(category):
    storage_category = _get_storage_category(category)
    if storage_category in ("Aluminium", "Glass"):
        frappe.throw("This export is only available for non-glass, non-aluminium categories.")

    item_fields = ["item_code", "item_name", "standard_rate"]
    items = frappe.get_all(
        "Item",
        filters={"item_group": storage_category, "disabled": 0},
        fields=item_fields,
        order_by="item_code asc",
    )

    item_codes = [item.item_code for item in items]
    price_map = {}
    if item_codes:
        prices = frappe.get_all(
            "Item Price",
            filters={
                "item_code": ("in", item_codes),
                "price_list": ("in", ["Retail", "Wholesale", "Special"]),
                "selling": 1,
            },
            fields=["item_code", "price_list", "price_list_rate"],
        )
        for price in prices:
            price_map.setdefault(price.item_code, {})[price.price_list] = flt(price.price_list_rate or 0)

    rows = [[
        "description",
        "code",
        "wholesale_rate",
        "retail_rate",
        "special_rate",
    ]]
    for item in items:
        rows.append([
            item.item_name or "",
            item.item_code or "",
            price_map.get(item.item_code, {}).get("Wholesale", 0),
            price_map.get(item.item_code, {}).get("Retail", flt(item.standard_rate or 0)),
            price_map.get(item.item_code, {}).get("Special", 0),
        ])

    filename = frappe.scrub(f"{category}_items_export") or "items_export"
    return _build_xlsx_file(filename, rows)


def _normalize_glass_dimension_uom(dimension_uom=None):
    return "inches" if (dimension_uom or "").strip().lower() == "inches" else "mm"


def _dimension_to_mm(value, dimension_uom=None):
    value = frappe.utils.flt(value or 0)
    return value * 25.4 if _normalize_glass_dimension_uom(dimension_uom) == "inches" else value


@frappe.whitelist()
def import_glass_items_to_builder(file_url, glass_type=None, item_code=None, price_list=None, dimension_uom=None):
    if not file_url:
        frappe.throw("Please attach an Excel file.")

    file_doc = frappe.get_doc("File", {"file_url": file_url})
    extension = (file_doc.file_name or file_url).rsplit(".", 1)[-1].lower()
    if extension not in ("xlsx", "xls"):
        frappe.throw("Please upload an .xlsx or .xls file.")

    from frappe.utils.xlsxutils import read_xls_file_from_attached_file, read_xlsx_file_from_attached_file
    from crystal_alluminium_works.pricing_engine import calculate_dimensions

    rows = (
        read_xlsx_file_from_attached_file(file_url=file_url)
        if extension == "xlsx"
        else read_xls_file_from_attached_file(file_doc.get_content())
    )
    rows = [row for row in (rows or []) if not _is_empty_import_row(row)]
    if len(rows) < 2:
        frappe.throw("The uploaded file must include a header row and at least one item row.")

    glass_type = (glass_type or "").strip()
    item_code = (item_code or "").strip()
    price_list = (price_list or "").strip()
    dimension_uom = _normalize_glass_dimension_uom(dimension_uom)
    if glass_type not in GLASS_TYPE_OPTIONS:
        frappe.throw("Please select a valid glass category.")
    if not item_code:
        frappe.throw("Please select the glass item to import.")
    if price_list not in PRICE_TYPE_TO_PRICE_LIST.values():
        frappe.throw("Please select a valid selling price.")

    headers = [_normalize_builder_sheet_header(cell) for cell in rows[0]]
    aliases = {
        "numbering": "numbering",
        "width": "width",
        "height": "height",
        "w+": "width_allowance",
        "h+": "height_allowance",
        "width_allowance": "width_allowance",
        "height_allowance": "height_allowance",
        "pcs": "pcs",
        "holes": "holes",
        "notches": "notches",
        "sandblast": "sandblast",
        "sand_blast": "sandblast",
        "polish_width_side": "polish_width_side",
        "polish_height_side": "polish_height_side",
        "details": "details",
        "description": "details",
    }
    normalized_headers = {aliases.get(header, header): idx for idx, header in enumerate(headers)}
    required_headers = {"width", "height", "pcs", "holes", "notches", "polish_width_side", "polish_height_side", "numbering"}
    missing_headers = required_headers - set(normalized_headers)
    if missing_headers:
        frappe.throw(f"Missing required column(s): {', '.join(sorted(missing_headers))}")

    product_code = GLASS_TYPE_TO_PRODUCT_CODE.get(glass_type)
    if not product_code:
        frappe.throw("Could not resolve the selected glass category to a product code.")

    item_doc = _get_builder_item_by_item_code(item_code, product_code, ["Glass"])
    item_glass_type = item_doc.custom_glass_type or "Ordinary"
    if item_glass_type != glass_type:
        frappe.throw("The selected glass item does not match the chosen glass category.")

    imported_items = []
    for row_number, row in enumerate(rows[1:], start=2):
        width_value = frappe.utils.flt(_get_import_cell(row, normalized_headers["width"]) or 0)
        height_value = frappe.utils.flt(_get_import_cell(row, normalized_headers["height"]) or 0)
        width_mm = _dimension_to_mm(width_value, dimension_uom)
        height_mm = _dimension_to_mm(height_value, dimension_uom)
        width_allowance = frappe.utils.flt(_get_import_cell(row, normalized_headers.get("width_allowance", -1)) or 0)
        height_allowance = frappe.utils.flt(_get_import_cell(row, normalized_headers.get("height_allowance", -1)) or 0)
        qty = frappe.utils.cint(_get_import_cell(row, normalized_headers["pcs"]) or 0)
        holes = frappe.utils.cint(_get_import_cell(row, normalized_headers["holes"]) or 0)
        notches = frappe.utils.cint(_get_import_cell(row, normalized_headers["notches"]) or 0)
        sandblast_value = frappe.utils.flt(_get_import_cell(row, normalized_headers.get("sandblast", -1)) or 0)
        polish_width_sides = frappe.utils.cint(_get_import_cell(row, normalized_headers["polish_width_side"]) or 0)
        polish_height_sides = frappe.utils.cint(_get_import_cell(row, normalized_headers["polish_height_side"]) or 0)
        numbering = _clean_import_text(_get_import_cell(row, normalized_headers["numbering"]))
        details = _clean_import_text(_get_import_cell(row, normalized_headers.get("details", -1)))

        sandblast_map = {
            0.0: "None",
            0.5: "Half",
            1.0: "Full",
        }
        sandblast_type = sandblast_map.get(round(sandblast_value, 2))

        if polish_width_sides not in (0, 1, 2) or polish_height_sides not in (0, 1, 2):
            frappe.throw(f"Row {row_number}: polish side values can only be 0, 1, or 2.")
        if holes < 0 or notches < 0:
            frappe.throw(f"Row {row_number}: holes and notches cannot be negative.")
        if width_allowance < 0 or height_allowance < 0:
            frappe.throw(f"Row {row_number}: W+ and H+ cannot be negative.")
        if sandblast_type is None:
            frappe.throw(f"Row {row_number}: sandblast must be 0, 0.5, 1, or empty.")
        if width_mm <= 0 or height_mm <= 0 or qty <= 0:
            frappe.throw(f"Row {row_number}: glass rows require width, height, and Pcs greater than zero.")

        dim = calculate_dimensions(width_mm, height_mm, glass_type=item_glass_type, item_code=item_doc.item_code)
        total = calculate_glass_total(
            item_code=item_doc.item_code,
            price_list=price_list,
            qty=qty,
            sale_mode="Resized",
            width_mm=width_mm,
            height_mm=height_mm,
            polish_width_sides=polish_width_sides,
            polish_height_sides=polish_height_sides,
            holes=holes,
            notches=notches,
            sandblast_type=sandblast_type,
            width_allowance=width_allowance,
            height_allowance=height_allowance,
            polish_type=DEFAULT_GLASS_POLISH_TYPE,
            hole_type=DEFAULT_GLASS_HOLE_TYPE,
            notch_type=DEFAULT_GLASS_NOTCH_TYPE,
        )

        imported_items.append({
            "id": frappe.generate_hash(length=8),
            "category": "Glass",
            "item_code": item_doc.item_code,
            "item_name": item_doc.item_name,
            "uom": item_doc.stock_uom or "Square Foot",
            "description": details,
            "numbering": numbering,
            "product_code": product_code,
            "price_list": price_list,
            "qty": qty,
            "rate": total.get("base_rate", 0),
            "amount": total.get("total", 0),
            "dimension_uom": dimension_uom,
            "sale_mode": "Resized",
            "width_mm": width_mm,
            "height_mm": height_mm,
            "width_allowance": width_allowance,
            "height_allowance": height_allowance,
            "base_width_ft": total.get("base_width_ft", dim.get("width_ft", 0)),
            "base_height_ft": total.get("base_height_ft", dim.get("height_ft", 0)),
            "width_ft": total.get("width_ft", dim.get("width_ft", 0)),
            "height_ft": total.get("height_ft", dim.get("height_ft", 0)),
            "area_sqft": total.get("area_sqft", dim.get("area_sqft", 0)),
            "perimeter_rft": total.get("perimeter_rft", dim.get("perimeter_rft", 0)),
            "polishing": 1 if polish_width_sides or polish_height_sides else 0,
            "polish_width_sides": polish_width_sides,
            "polish_height_sides": polish_height_sides,
            "polish_type": DEFAULT_GLASS_POLISH_TYPE,
            "holes": holes,
            "hole_type": DEFAULT_GLASS_HOLE_TYPE,
            "notches": notches,
            "notch_type": DEFAULT_GLASS_NOTCH_TYPE,
            "sandblast_type": sandblast_type,
            "glass_type": item_glass_type,
            "glass_breakdown": total.get("breakdown", []),
        })

    return {"items": imported_items}


@frappe.whitelist()
def get_dimension_intervals(interval_set=None):
    interval_set = interval_set or STANDARD_GLASS_INTERVAL_SET
    fields = ["name", "min_mm", "max_mm", "equivalent_ft", "equivalent_inches", "interval_set"]

    if _dimension_range_has_field("equivalent_inches_min"):
        fields.append("equivalent_inches_min")
    if _dimension_range_has_field("equivalent_inches_max"):
        fields.append("equivalent_inches_max")

    intervals = frappe.get_all("Dimension Range", 
        filters={"interval_set": interval_set},
        fields=fields,
        order_by="min_mm asc"
    )
    return intervals

@frappe.whitelist()
def save_dimension_intervals(intervals, interval_set=None):
    intervals = json.loads(intervals) if isinstance(intervals, str) else intervals
    interval_set = interval_set or STANDARD_GLASS_INTERVAL_SET
    has_inches_min = _dimension_range_has_field("equivalent_inches_min")
    has_inches_max = _dimension_range_has_field("equivalent_inches_max")
    
    # Clear existing only for the selected set
    existing = frappe.get_all("Dimension Range", filters={"interval_set": interval_set}, pluck="name")
    for name in existing:
        frappe.delete_doc("Dimension Range", name, ignore_permissions=True)
        
    # Insert new
    for i in intervals:
        doc_data = {
            "doctype": "Dimension Range",
            "min_mm": float(i.get("min_mm", 0)),
            "max_mm": float(i.get("max_mm", 0)),
            "equivalent_ft": float(i.get("equivalent_ft", 0)),
            "equivalent_inches": float(i.get("equivalent_inches_max") or i.get("equivalent_inches") or 0),
            "interval_set": interval_set,
        }

        if has_inches_min:
            doc_data["equivalent_inches_min"] = float(i.get("equivalent_inches_min", 0))
        if has_inches_max:
            doc_data["equivalent_inches_max"] = float(i.get("equivalent_inches_max") or i.get("equivalent_inches") or 0)

        doc = frappe.get_doc(doc_data)
        doc.insert(ignore_permissions=True)
        
    return True


@frappe.whitelist()
def get_glass_sheet_configs(glass_type=None):
    _ensure_glass_sheet_config_storage()
    shared_glass_type = _get_shared_glass_sheet_type()
    rows = frappe.get_all(
        "Glass Sheet Config",
        filters={"glass_type": shared_glass_type},
        fields=["size", "sft"],
        order_by="creation asc",
    )
    if rows:
        return rows

    return frappe.get_all(
        "Glass Sheet Config",
        filters={"glass_type": ("!=", shared_glass_type)},
        fields=["size", "sft"],
        order_by="creation asc",
    )


@frappe.whitelist()
def save_glass_sheet_configs(rows, glass_type=None):
    _ensure_glass_sheet_config_storage()
    shared_glass_type = _get_shared_glass_sheet_type()
    rows = json.loads(rows) if isinstance(rows, str) else (rows or [])

    existing = frappe.get_all("Glass Sheet Config", pluck="name")
    for name in existing:
        frappe.delete_doc("Glass Sheet Config", name, ignore_permissions=True, force=1)

    for row in rows:
        size = str((row or {}).get("size") or "").strip()
        sft = flt((row or {}).get("sft") or 0)
        if not size or sft <= 0:
            continue

        frappe.get_doc({
            "doctype": "Glass Sheet Config",
            "glass_type": shared_glass_type,
            "size": size,
            "sft": sft,
        }).insert(ignore_permissions=True)

    frappe.db.commit()
    return True

@frappe.whitelist()
def import_category_items(file_url, category):
    """
    Import items from an Excel file for a specific category.
    Expected headers for Aluminium: item_name, code, rate_per_kg, weight_per_length
    Expected headers for other categories: description, code, wholesale_rate, retail_rate, special_rate
    Legacy optional column for Aluminium: aluminium_type (ignored)
    """
    if not file_url:
        frappe.throw("Please attach an Excel file.")

    file_doc = frappe.get_doc("File", {"file_url": file_url})
    extension = (file_doc.file_name or file_url).rsplit(".", 1)[-1].lower()

    if extension not in ("xlsx", "xls"):
        frappe.throw("Please upload an .xlsx or .xls file.")

    from frappe.utils.xlsxutils import (
        read_xls_file_from_attached_file,
        read_xlsx_file_from_attached_file,
    )

    if extension == "xlsx":
        rows = read_xlsx_file_from_attached_file(file_url=file_url)
    else:
        rows = read_xls_file_from_attached_file(file_doc.get_content())

    rows = rows or []
    rows = [row for row in rows if not _is_empty_import_row(row)]
    if len(rows) < 2:
        frappe.throw("The uploaded file must include a header row and at least one item row.")

    headers = [_normalize_import_header(cell) for cell in rows[0]]
    is_aluminium = _get_storage_category(category) == "Aluminium"
    required_headers = (
        {"item_name", "code", "rate_per_kg", "weight_per_length"}
        if is_aluminium else
        {"description", "code", "wholesale_rate", "retail_rate", "special_rate"}
    )

    missing_headers = required_headers - set(headers)
    if missing_headers:
        frappe.throw(f"Missing required column(s): {', '.join(sorted(missing_headers))}")

    column_index = {header: headers.index(header) for header in required_headers}
    created = 0
    updated = 0
    skipped = 0
    errors = []

    for row_number, row in enumerate(rows[1:], start=2):
        item_name = _clean_import_text(
            _get_import_cell(row, column_index["item_name" if is_aluminium else "description"])
        )
        code = _clean_import_text(_get_import_cell(row, column_index["code"]))
        if not item_name or not code:
            skipped += 1
            errors.append(f"Row {row_number}: item name and code are required.")
            continue

        exists = frappe.db.exists("Item", code)
        if exists:
            existing_group = frappe.db.get_value("Item", code, "item_group")
            storage_category = _get_storage_category(category)
            if existing_group != storage_category:
                skipped += 1
                errors.append(
                    f"Row {row_number}: code {code} already exists in item group {existing_group}."
                )
                continue
        payload = {
            "is_new": not exists,
            "category": category,
            "item_code": code,
            "original_item_code": code,
            "item_name": item_name,
        }

        if is_aluminium:
            rate_per_kg = frappe.utils.flt(_get_import_cell(row, column_index["rate_per_kg"]) or 0)
            weight_per_length = frappe.utils.flt(_get_import_cell(row, column_index["weight_per_length"]) or 0)

            if rate_per_kg < 0 or weight_per_length < 0:
                skipped += 1
                errors.append(f"Row {row_number}: rate_per_kg and weight_per_length cannot be negative.")
                continue

            payload["aluminium_rate_per_kg"] = rate_per_kg
            payload["aluminium_weight_per_length"] = weight_per_length
        else:
            wholesale_rate = frappe.utils.flt(_get_import_cell(row, column_index["wholesale_rate"]) or 0)
            retail_rate = frappe.utils.flt(_get_import_cell(row, column_index["retail_rate"]) or 0)
            special_rate = frappe.utils.flt(_get_import_cell(row, column_index["special_rate"]) or 0)

            if wholesale_rate < 0 or retail_rate < 0 or special_rate < 0:
                skipped += 1
                errors.append(f"Row {row_number}: rates cannot be negative.")
                continue

            payload["retail_rate"] = retail_rate
            payload["wholesale_rate"] = wholesale_rate
            payload["special_rate"] = special_rate

        save_custom_item(payload)

        if exists:
            updated += 1
        else:
            created += 1

    frappe.db.commit()

    return {
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "errors": errors,
    }

@frappe.whitelist()
def delete_items(item_codes):
	import json
	if isinstance(item_codes, str):
		item_codes = json.loads(item_codes)
	deleted = 0
	service_item_codes = set(GLASS_SERVICE_ITEM_DEFS)
	for item_code in item_codes:
		if item_code in service_item_codes:
			continue
		if frappe.db.exists("Item", item_code):
			frappe.delete_doc("Item", item_code)
			deleted += 1
	return deleted

@frappe.whitelist()
def delete_aluminium_items_and_related_docs(item_codes=None):
	import json

	default_codes = ["A08.1", "A08", "A07.3", "A07.1"]
	if not item_codes:
		item_codes = default_codes
	elif isinstance(item_codes, str):
		item_codes = json.loads(item_codes) if item_codes.strip().startswith("[") else [code.strip() for code in item_codes.split(",") if code.strip()]

	item_codes = list(dict.fromkeys(item_codes))
	summary = {
		"item_codes": item_codes,
		"deleted": {
			"Delivery Note": [],
			"Sales Invoice": [],
			"Sales Order": [],
			"Quotation": [],
			"Item Price": [],
			"Item": [],
		},
		"errors": [],
	}

	def delete_docnames(doctype, docnames):
		for name in docnames:
			try:
				doc = frappe.get_doc(doctype, name)
				if doc.docstatus == 1:
					doc.cancel()
				frappe.delete_doc(doctype, name, ignore_permissions=True, force=1)
				summary["deleted"][doctype].append(name)
			except Exception:
				summary["errors"].append({
					"doctype": doctype,
					"name": name,
					"error": frappe.get_traceback(),
				})

	for doctype in ["Delivery Note", "Sales Invoice", "Sales Order", "Quotation"]:
		child_doctype = f"{doctype} Item"
		docnames = frappe.get_all(
			child_doctype,
			filters={"item_code": ["in", item_codes]},
			distinct=True,
			pluck="parent",
		)
		delete_docnames(doctype, docnames)

	item_price_names = frappe.get_all(
		"Item Price",
		filters={"item_code": ["in", item_codes]},
		pluck="name",
	)
	for name in item_price_names:
		try:
			frappe.delete_doc("Item Price", name, ignore_permissions=True, force=1)
			summary["deleted"]["Item Price"].append(name)
		except Exception:
			summary["errors"].append({
				"doctype": "Item Price",
				"name": name,
				"error": frappe.get_traceback(),
			})

	frappe.db.delete("Bin", {"item_code": ["in", item_codes]})

	for item_code in item_codes:
		if not frappe.db.exists("Item", item_code):
			continue
		try:
			frappe.delete_doc("Item", item_code, ignore_permissions=True, force=1)
			summary["deleted"]["Item"].append(item_code)
		except Exception:
			summary["errors"].append({
				"doctype": "Item",
				"name": item_code,
				"error": frappe.get_traceback(),
			})

	return summary

@frappe.whitelist()
def get_all_glass_items():
    items = frappe.get_all("Item", filters={"item_group": "Glass"}, fields=["name", "item_code", "item_name", "stock_uom"])
    service_keywords = ["Polishing", "Drilling", "Sandblasting", "Hole", "Notching", "Notch"]
    return [i for i in items if not any(k in (i.item_name or "") for k in service_keywords)]


@frappe.whitelist()
def get_payments_page(search=None, payment_method=None, from_date=None, to_date=None, page=1, page_length=30):
    page = max(int(page or 1), 1)
    page_length = min(max(int(page_length or 30), 1), 100)
    start = (page - 1) * page_length

    filters = {}
    if payment_method:
        filters["payment_method"] = payment_method
    if from_date and to_date:
        filters["date"] = ["between", [from_date, to_date]]
    elif from_date:
        filters["date"] = [">=", from_date]
    elif to_date:
        filters["date"] = ["<=", to_date]

    or_filters = None
    search = (search or "").strip()
    if search:
        like = f"%{search}%"
        or_filters = [
            ["Payments", "customer", "like", like],
            ["Payments", "job_card", "like", like],
            ["Payments", "payment_method", "like", like],
            ["Payments", "deposit_to", "like", like],
            ["Payments", "reference", "like", like],
        ]

    rows = frappe.get_list(
        "Payments",
        filters=filters,
        or_filters=or_filters,
        fields=["name", "customer", "amount", "date", "payment_method", "deposit_to", "reference"],
        order_by="creation desc",
        start=start,
        page_length=page_length,
    )

    count_result = frappe.get_all(
        "Payments",
        filters=filters,
        or_filters=or_filters,
        fields=[{"COUNT": "name", "as": "total_count"}],
    )
    total_count = (count_result[0].total_count if count_result else 0) or 0

    return {
        "rows": rows,
        "page": page,
        "page_length": page_length,
        "total_count": total_count,
        "has_next": start + len(rows) < total_count,
    }


def _normalize_payment_allocations(allocations, customer, payment_amount):
    """Validate and clean a payment's job-card allocation rows.

    Each row is {job_card, amount}. Rules: job cards must belong to the customer, amounts
    must be positive, and the allocated total can't exceed the payment. Whatever is left
    unallocated is intentionally allowed — it becomes the customer's advance / credit."""
    allocations = json.loads(allocations) if isinstance(allocations, str) else (allocations or [])
    cleaned = []
    allocated_total = 0
    for row in allocations:
        job_card = str((row or {}).get("job_card") or "").strip()
        row_amount = flt((row or {}).get("amount") or 0)
        if not job_card:
            continue
        if row_amount <= 0:
            frappe.throw("Each allocation must have an amount greater than zero.")
        if not frappe.db.exists("CAW Job Card", job_card):
            frappe.throw(f"Job Card {job_card} does not exist.")
        # The statement credits each job card's owner, so a cross-customer allocation would
        # silently corrupt another customer's balance.
        if frappe.db.get_value("CAW Job Card", job_card, "customer") != customer:
            frappe.throw(f"Job Card {job_card} does not belong to this customer.")
        allocated_total += row_amount
        cleaned.append({"job_card": job_card, "amount": row_amount})

    if allocated_total - flt(payment_amount) > 0.0001:
        frappe.throw(
            f"Allocated amount ({frappe.utils.fmt_money(allocated_total)}) cannot exceed the "
            f"payment amount ({frappe.utils.fmt_money(payment_amount)})."
        )
    return cleaned


@frappe.whitelist()
def record_customer_payment(customer, amount, date, payment_method, deposit_to, reference=None, job_card=None, allocations=None, payment_type="General Payment"):
    if not customer:
        frappe.throw("Customer is required.")
    if not amount or flt(amount) <= 0:
        frappe.throw("Amount must be greater than zero.")
    if not date:
        frappe.throw("Date is required.")
    if not payment_method:
        frappe.throw("Payment Method is required.")
    if not deposit_to:
        frappe.throw("Deposit To account is required.")

    payment_type = payment_type or "General Payment"
    cleaned_allocations = _normalize_payment_allocations(allocations, customer, amount)

    # Backward-compatible single job_card argument: treat it as one full allocation.
    if not cleaned_allocations and job_card:
        cleaned_allocations = _normalize_payment_allocations(
            [{"job_card": job_card, "amount": amount}], customer, amount
        )

    if payment_type == "Refund":
        for row in cleaned_allocations:
            paid_so_far = flt(frappe.db.get_value("CAW Job Card", row["job_card"], "payment_amount") or 0)
            if row["amount"] - paid_so_far > 0.0001:
                frappe.throw(
                    f"Cannot refund {frappe.utils.fmt_money(row['amount'])} against Job Card "
                    f"{row['job_card']} — only {frappe.utils.fmt_money(paid_so_far)} has been paid."
                )

    mode_of_payment_type = frappe.db.get_value("Mode of Payment", payment_method, "type")
    if mode_of_payment_type == "Bank" and not (reference or "").strip():
        frappe.throw("Reference is required for Bank payment methods.")

    doc = frappe.get_doc({
        "doctype": "Payments",
        "customer": customer,
        "payment_type": payment_type,
        # Mirror a single allocation into the legacy field so the Payments list view / search
        # still surfaces the job card; splits leave it blank (the allocations table is truth).
        "job_card": cleaned_allocations[0]["job_card"] if len(cleaned_allocations) == 1 else None,
        "amount": flt(amount),
        "date": date,
        "payment_method": payment_method,
        "deposit_to": deposit_to,
        "reference": reference,
        "allocations": cleaned_allocations,
    })
    doc.insert(ignore_permissions=True)

    if payment_type == "Refund":
        # Refunds adjust the Job Card's paid/balance amounts directly for every customer
        # type — _sync_job_card_balance_from_payments is a no-op for Cash Customers, which
        # would silently swallow a cash-customer refund.
        for row in cleaned_allocations:
            _apply_job_card_refund(row["job_card"], row["amount"], doc.name)
    else:
        # Invoice customers' real outstanding balance lives on the job card, kept in sync from
        # Payments — this is the only place that updates for them now that invoices don't.
        for row in cleaned_allocations:
            _sync_job_card_balance_from_payments(row["job_card"])

    return doc.name


def _apply_job_card_refund(job_card_name, amount, payment_name):
    job_card = frappe.get_doc("CAW Job Card", job_card_name)
    new_payment = _round_job_card_amount(max(flt(job_card.payment_amount) - flt(amount), 0))
    job_card.payment_amount = new_payment
    job_card.balance_amount = _round_job_card_amount(max(flt(job_card.quotation_amount) - new_payment, 0))
    job_card.flags.ignore_permissions = True
    job_card.save(ignore_permissions=True)
    _write_job_card_amendment_event(
        job_card, "Refunded", amount_paid=-flt(amount), note=f"Refund via Payments {payment_name}"
    )


@frappe.whitelist()
def set_payment_allocations(payment, allocations=None):
    """Replace an existing payment's job-card allocations.

    This is how an advance / unallocated payment gets deliberately distributed across one or
    more job cards (e.g. a contractor funding several projects from one deposit). The customer
    statement then credits each job card's balance; anything left unallocated stays as advance."""
    if not payment or not frappe.db.exists("Payments", payment):
        frappe.throw("Please select a valid payment.")

    payment_doc = frappe.get_doc("Payments", payment)
    previous_job_cards = {row.job_card for row in (payment_doc.allocations or []) if row.job_card}
    if payment_doc.job_card:
        previous_job_cards.add(payment_doc.job_card)

    cleaned_allocations = _normalize_payment_allocations(allocations, payment_doc.customer, payment_doc.amount)

    payment_doc.set("allocations", cleaned_allocations)
    payment_doc.job_card = cleaned_allocations[0]["job_card"] if len(cleaned_allocations) == 1 else None
    payment_doc.flags.ignore_permissions = True
    payment_doc.save(ignore_permissions=True)

    # Resync every job card this payment touched before or after the change — a removed
    # allocation must give a job card's balance back, not just a newly added one take it.
    new_job_cards = {row["job_card"] for row in cleaned_allocations}
    for job_card_name in previous_job_cards | new_job_cards:
        _sync_job_card_balance_from_payments(job_card_name)

    return payment_doc.name


def _get_job_card_allocated_payments(job_card, exclude_payment=None):
    """Sum of payments already applied to a job card: explicit allocation rows plus legacy
    single-field payments that have no allocation rows. exclude_payment lets a caller treat
    a specific Payments doc as if it didn't exist — needed when deleting one, since the
    on_trash hook fires while its rows are still physically in the database."""
    # Payments.autoname is "autoincrement", so frappe.get_all returns Payments.name as an int
    # while a child table's `parent` column is always a string — normalize both to str before
    # comparing/excluding, or "43" vs 43 silently fails the dedup/exclude checks below.
    exclude_payment = str(exclude_payment) if exclude_payment is not None else None

    total = 0
    allocation_rows = frappe.get_all(
        "Payment Job Card Allocation",
        filters={"job_card": job_card, "parenttype": "Payments"},
        fields=["parent", "amount"],
    )
    parents_with_allocations = set()
    for row in allocation_rows:
        parent = str(row.parent)
        if parent == exclude_payment:
            continue
        parents_with_allocations.add(parent)
        total += flt(row.amount)

    legacy_payments = frappe.get_all(
        "Payments",
        filters={"job_card": job_card},
        fields=["name", "amount"],
    )
    for payment in legacy_payments:
        name = str(payment.name)
        if name == exclude_payment:
            continue
        if name not in parents_with_allocations:
            total += flt(payment.amount)

    return total


def _sync_job_card_balance_from_payments(job_card_name, exclude_payment=None):
    """Recompute and persist payment_amount/balance_amount for an Invoice Customer job
    card from real Payments allocated to it — the Payments page is the single source of
    truth for what an invoice customer has actually paid, since invoices (partial or full)
    only ever track released items, never payments. Call this whenever a Payment touching
    this job card is recorded, edited, deleted, or its allocations change.

    No-op for Cash Customers: their payment_amount/balance_amount is driven solely by
    Create/Edit Job Card."""
    if not job_card_name or not frappe.db.exists("CAW Job Card", job_card_name):
        return

    job_card = frappe.get_doc("CAW Job Card", job_card_name)
    if (job_card.payment_mode or "") != "Invoice Customer":
        return

    quotation_amount = _round_job_card_amount(job_card.quotation_amount)
    paid = _get_job_card_allocated_payments(job_card_name, exclude_payment=exclude_payment)
    new_payment_amount = _round_job_card_amount(min(paid, quotation_amount) if quotation_amount > 0 else paid)
    new_balance_amount = _round_job_card_amount(max(quotation_amount - new_payment_amount, 0))

    if job_card.payment_amount == new_payment_amount and job_card.balance_amount == new_balance_amount:
        return  # avoid a no-op save / spurious history row

    job_card.payment_amount = new_payment_amount
    job_card.balance_amount = new_balance_amount
    job_card.flags.ignore_permissions = True
    job_card.save(ignore_permissions=True)  # triggers a CAW Job Card History entry


def on_payments_trash(doc, method=None):
    """Doctype hook (see hooks.py doc_events): when a Payments document is deleted via any
    path (desk Form, bulk delete, etc.), resync every Invoice Customer job card it was
    funding — otherwise that job card would be left understating its real balance until
    something else happened to touch it."""
    job_cards = {row.job_card for row in (doc.allocations or []) if row.job_card}
    if doc.job_card:
        job_cards.add(doc.job_card)
    for job_card_name in job_cards:
        _sync_job_card_balance_from_payments(job_card_name, exclude_payment=doc.name)


@frappe.whitelist()
def get_job_card_statement_balance(job_card):
    """Payments-based outstanding balance for one job card, used to pre-fill a payment
    allocation row. Cash customers settle on the Job Card (payment_amount); invoice customers
    settle via Payments allocated to the job card."""
    if not job_card or not frappe.db.exists("CAW Job Card", job_card):
        return {"balance": 0}

    job_card_doc = frappe.db.get_value(
        "CAW Job Card",
        job_card,
        ["quotation_amount", "payment_mode", "payment_amount"],
        as_dict=True,
    )
    quotation_amount = flt(job_card_doc.quotation_amount)
    if (job_card_doc.payment_mode or "") == "Cash Customer":
        paid = flt(job_card_doc.payment_amount)
    else:
        paid = _get_job_card_allocated_payments(job_card)

    return {"balance": _round_job_card_amount(max(quotation_amount - paid, 0))}


@frappe.whitelist()
def get_customer_outstanding(customer):
    """Current amount the customer owes, computed the same way as the customer statement:
    Σ over non-cancelled job cards of max(quotation_amount - paid), plus the outstanding on
    any Sales Invoices not owned by one of those job cards. Used to nudge the user when a
    payment is recorded without allocating it against an outstanding job card."""
    default_currency = frappe.defaults.get_global_default("currency") or "KES"
    if not customer:
        return {"outstanding": 0, "currency": default_currency}

    job_cards = frappe.get_all(
        "CAW Job Card",
        filters={"customer": customer, "status": ["!=", "Cancelled"]},
        fields=["name", "quotation", "payment_mode", "quotation_amount", "payment_amount"],
    )

    # Sum payment allocations per job card (invoice customers settle via Payments, not the JC).
    payments = frappe.get_all("Payments", filters={"customer": customer}, fields=["name", "amount", "job_card"])
    payment_names = [p.name for p in payments]
    allocation_rows = frappe.get_all(
        "Payment Job Card Allocation",
        filters={"parent": ["in", payment_names], "parenttype": "Payments"},
        fields=["parent", "job_card", "amount"],
    ) if payment_names else []

    paid_by_job_card = {}
    parents_with_allocations = set()
    for row in allocation_rows:
        parents_with_allocations.add(row.parent)
        if row.job_card:
            paid_by_job_card[row.job_card] = paid_by_job_card.get(row.job_card, 0) + flt(row.amount)
    # Legacy single-field payments (no allocation rows) count the whole amount on that job card.
    for payment in payments:
        if payment.name not in parents_with_allocations and payment.job_card:
            paid_by_job_card[payment.job_card] = paid_by_job_card.get(payment.job_card, 0) + flt(payment.amount)

    accounted_quotations = set()
    job_card_outstanding = 0
    for job_card in job_cards:
        if job_card.quotation:
            accounted_quotations.add(job_card.quotation)
        if (job_card.payment_mode or "") == "Cash Customer":
            paid = flt(job_card.payment_amount)
        else:
            paid = flt(paid_by_job_card.get(job_card.name, 0))
        job_card_outstanding += max(flt(job_card.quotation_amount) - paid, 0)

    invoices = frappe.get_all(
        "Sales Invoice",
        filters={"customer": customer, "docstatus": ["!=", 2]},
        fields=["outstanding_amount", "total_taxes_and_charges", "custom_source_quotation", "currency"],
    )
    invoice_outstanding = 0
    currency = None
    for invoice in invoices:
        if invoice.custom_source_quotation in accounted_quotations:
            continue  # already accounted for via its owning job card
        amount = flt(invoice.outstanding_amount)
        if flt(invoice.total_taxes_and_charges) == 0:
            amount = amount * (1 + VAT_RATE)  # visual VAT invoices store tax outside grand_total
        invoice_outstanding += amount
        currency = currency or invoice.currency

    return {
        "outstanding": _round_job_card_amount(job_card_outstanding + invoice_outstanding),
        "currency": currency or default_currency,
    }


@frappe.whitelist()
def get_customer_outstanding_job_cards(customer):
    """Return each non-cancelled job card that still has an outstanding balance for the
    customer, together with its balance. Used to auto-populate the allocations table in
    the Create Payment modal without manual row entry."""
    if not customer:
        return []

    job_cards = frappe.get_all(
        "CAW Job Card",
        filters={"customer": customer, "status": ["!=", "Cancelled"]},
        fields=["name", "payment_mode", "quotation_amount", "payment_amount"],
        order_by="creation asc",
    )

    # Build paid_by_job_card using the same logic as get_customer_outstanding
    payments = frappe.get_all("Payments", filters={"customer": customer}, fields=["name", "amount", "job_card"])
    payment_names = [p.name for p in payments]
    allocation_rows = frappe.get_all(
        "Payment Job Card Allocation",
        filters={"parent": ["in", payment_names], "parenttype": "Payments"},
        fields=["parent", "job_card", "amount"],
    ) if payment_names else []

    paid_by_job_card = {}
    parents_with_allocations = set()
    for row in allocation_rows:
        parents_with_allocations.add(row.parent)
        if row.job_card:
            paid_by_job_card[row.job_card] = paid_by_job_card.get(row.job_card, 0) + flt(row.amount)
    for payment in payments:
        if payment.name not in parents_with_allocations and payment.job_card:
            paid_by_job_card[payment.job_card] = paid_by_job_card.get(payment.job_card, 0) + flt(payment.amount)

    result = []
    for jc in job_cards:
        if (jc.payment_mode or "") == "Cash Customer":
            paid = flt(jc.payment_amount)
        else:
            paid = flt(paid_by_job_card.get(jc.name, 0))
        balance = _round_job_card_amount(max(flt(jc.quotation_amount) - paid, 0))
        if balance > 0.0001:
            result.append({"job_card": jc.name, "amount": balance})

    return result


@frappe.whitelist()
def get_customer_payments(customer):
    """Return a customer's payments with their job-card allocation rows embedded, so the
    customer statement can attribute each payment (split or single) without extra round-trips."""
    if not customer:
        return []

    payments = frappe.get_all(
        "Payments",
        filters={"customer": customer},
        fields=["name", "amount", "date", "payment_method", "deposit_to", "reference", "job_card", "creation"],
        order_by="date desc, creation desc",
        limit_page_length=0,
    )
    if not payments:
        return []

    allocation_rows = frappe.get_all(
        "Payment Job Card Allocation",
        filters={"parent": ["in", [p.name for p in payments]], "parenttype": "Payments"},
        fields=["parent", "job_card", "amount"],
        limit_page_length=0,
    )
    allocations_by_payment = {}
    for row in allocation_rows:
        allocations_by_payment.setdefault(row.parent, []).append({"job_card": row.job_card, "amount": row.amount})

    for payment in payments:
        payment["allocations"] = allocations_by_payment.get(payment.name, [])

    return payments


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def get_customer_names(doctype, txt, searchfield, start, page_len, filters):
    return frappe.db.sql("""
        SELECT name, customer_name
        FROM `tabCustomer`
        WHERE (customer_name LIKE %(txt)s OR name LIKE %(txt)s)
        ORDER BY customer_name ASC
        LIMIT %(page_len)s OFFSET %(start)s
    """, {"txt": f"%{txt}%", "start": start, "page_len": page_len})


# ---------------------------------------------------------------------------
# Stock-in shared helpers
# ---------------------------------------------------------------------------
# Stock-in now goes through the standard Material Request -> Purchase Order ->
# Purchase Receipt flow (see purchase_handler.py for the sheet/piece -> stock
# qty math). What's left here are lookups still shared with the Stock
# Adjustment page (get_stock_entry_options) and ceiling piece-area helpers used
# by both purchase_handler.py and the procurement client script.

STOCK_DEFAULT_WAREHOUSE = "Stores - CA"


def _get_default_stock_company():
    company = frappe.defaults.get_global_default("company")
    if company:
        return company
    companies = frappe.get_all("Company", pluck="name", limit=1)
    return companies[0] if companies else None


def _get_default_receiving_warehouse(company):
    if frappe.db.exists("Warehouse", STOCK_DEFAULT_WAREHOUSE):
        return STOCK_DEFAULT_WAREHOUSE
    wh = frappe.get_all(
        "Warehouse",
        filters={"company": company, "is_group": 0},
        pluck="name",
        order_by="creation asc",
        limit=1,
    )
    return wh[0] if wh else None


@frappe.whitelist()
def get_stock_entry_options():
    """Form data for the Stock Adjustment page: suppliers, receiving warehouses,
    configured glass sheet sizes (size -> sft) and sensible defaults."""
    company = _get_default_stock_company()
    suppliers = frappe.get_all(
        "Supplier",
        fields=["name", "supplier_name"],
        order_by="supplier_name asc",
    )
    warehouses = frappe.get_all(
        "Warehouse",
        filters={"company": company, "is_group": 0},
        fields=["name"],
        order_by="name asc",
    )
    sheet_sizes = get_glass_sheet_configs()
    return {
        "company": company,
        "suppliers": suppliers,
        "warehouses": [w["name"] for w in warehouses],
        "default_warehouse": _get_default_receiving_warehouse(company),
        "sheet_sizes": sheet_sizes,
    }


CEILING_DEFAULT_PIECE_AREA = 0.36  # sqm/piece fallback (matches the system-wide Ceiling Configuration default)


def _get_ceiling_piece_area(item_code):
    """Quantity of stock UOM represented by one physical piece of a ceiling item.
    Ceiling Configuration docnames don't reliably match parent_item (some were
    renamed), so this must filter on the parent_item field, not look up by name.
    The 0.36 sqm/piece default only applies to area-based board items (stock UOM
    Square Meter, e.g. AGC/AMC); count-based items (stock UOM Nos, e.g. Wall
    angle, Sub Cross) have no such config and receive 1 piece = 1 Nos."""
    ratio = frappe.db.get_value("Ceiling Configuration", {"parent_item": item_code}, "ratio_4")
    if ratio:
        return flt(ratio)
    stock_uom = frappe.db.get_value("Item", item_code, "stock_uom")
    return CEILING_DEFAULT_PIECE_AREA if stock_uom == "Square Meter" else 1.0


@frappe.whitelist()
def get_ceiling_piece_area(item_code):
    """Whitelisted lookup for the Stock Entry page: sqm represented by one piece
    of the given ceiling item, used to compute qty = pieces * area_per_piece."""
    return _get_ceiling_piece_area(item_code)


def _attach_sales_invoices_to_entries(entries):
    """Enrich Stock Ledger Entry dicts with `sales_invoice` (canonical, singular) and
    `sales_invoices` (the full ordered list, for the ledger's "Date / Invoice" column).

    Resolution order per Stock Entry:
      1. Glass deducted early at JC Operations (remark carries "Row: {quotation_item}"):
         list EVERY invoice that released that quotation row, sourced from CAW Job Card
         Release — the single up-front deduction maps to all partial/final invoices.
      2. Otherwise use the entry's own `custom_sales_invoice` link (stamped at creation for
         invoice-time deductions), which is exact 1-entry-to-1-invoice.
      3. Legacy/un-backfilled fallback: trace remarks → Job Card → its invoices and show
         the newest (the old, approximate behaviour).
    """
    import re
    se_vouchers = list(set(e.voucher_no for e in entries if e.voucher_type == "Stock Entry"))
    if not se_vouchers:
        for e in entries:
            e.sales_invoice = ""
            e.sales_invoices = []
        return

    se_rows = frappe.get_all(
        "Stock Entry",
        filters={"name": ["in", se_vouchers]},
        fields=["name", "remarks", "custom_sales_invoice"],
    )
    se_remarks_map = {r.name: r.remarks or "" for r in se_rows}
    se_field_invoice = {r.name: r.custom_sales_invoice or "" for r in se_rows}

    # Parse Job Card name and (for early-deducted glass) the quotation row from remarks.
    jc_name_pattern = re.compile(r"CAW Job Card:\s*(JOB-CARD-[\w-]+)")
    row_pattern = re.compile(r"Row:\s*([\w-]+)")
    voucher_to_jc = {}
    voucher_to_row = {}
    jc_names = set()
    row_names = set()
    for se_name, remarks in se_remarks_map.items():
        jc_match = jc_name_pattern.search(remarks)
        if jc_match:
            voucher_to_jc[se_name] = jc_match.group(1)
            jc_names.add(jc_match.group(1))
        row_match = row_pattern.search(remarks)
        if row_match:
            voucher_to_row[se_name] = row_match.group(1)
            row_names.add(row_match.group(1))

    # Every invoice that released each early-deducted glass row (quotation_item is a unique
    # child docname, so it alone keys the releases). Ordered oldest → newest, de-duplicated.
    row_to_invoices = {}
    if row_names:
        releases = frappe.get_all(
            "CAW Job Card Release",
            filters={"quotation_item": ["in", list(row_names)], "sales_invoice": ["is", "set"]},
            fields=["quotation_item", "sales_invoice"],
            order_by="creation asc",
        )
        for rel in releases:
            lst = row_to_invoices.setdefault(rel.quotation_item, [])
            if rel.sales_invoice not in lst:
                lst.append(rel.sales_invoice)

    # Legacy fallback: Job Card → its invoices (newest last).
    jc_to_invoices = {}
    if jc_names and frappe.get_meta("Sales Invoice").has_field("custom_source_job_card"):
        invoices = frappe.get_all(
            "Sales Invoice",
            filters={"custom_source_job_card": ["in", list(jc_names)], "docstatus": ["!=", 2]},
            fields=["name", "custom_source_job_card"],
            order_by="creation asc",
        )
        for inv in invoices:
            jc_to_invoices.setdefault(inv.custom_source_job_card, []).append(inv.name)

    for e in entries:
        inv_list = []
        if e.voucher_type == "Stock Entry":
            row = voucher_to_row.get(e.voucher_no)
            field_inv = se_field_invoice.get(e.voucher_no)
            if row and row_to_invoices.get(row):
                inv_list = list(row_to_invoices[row])
                # Keep the stamped canonical invoice first if it isn't already covered.
                if field_inv and field_inv not in inv_list:
                    inv_list.insert(0, field_inv)
            elif field_inv:
                inv_list = [field_inv]
            elif e.voucher_no in voucher_to_jc:
                inv_list = list(jc_to_invoices.get(voucher_to_jc[e.voucher_no], []))
        e.sales_invoices = inv_list
        e.sales_invoice = inv_list[0] if inv_list else ""


@frappe.whitelist()
def get_glass_stock_ledger(item_code, warehouse, from_date=None, to_date=None):
    """Reconstruct a running sheet balance alongside the standard SFT balance by parsing
    the underlying Purchase Receipts and Stock Entries for a glass item in a warehouse."""
    if not item_code or not warehouse:
        return []
        
    # We fetch the entire history to accurately compute the running sheets balance from zero,
    # then we slice by date before returning.
    ledger = frappe.get_all(
        "Stock Ledger Entry",
        filters={
            "item_code": item_code,
            "warehouse": warehouse,
            "is_cancelled": 0
        },
        fields=["name", "posting_date", "posting_time", "voucher_type", "voucher_no", "actual_qty", "qty_after_transaction"],
        order_by="posting_date asc, posting_time asc, creation asc"
    )
    
    pr_names = list(set([e.voucher_no for e in ledger if e.voucher_type == "Purchase Receipt"]))
    se_names = list(set([e.voucher_no for e in ledger if e.voucher_type == "Stock Entry"]))
    
    pr_items = {}
    if pr_names:
        pr_rows = frappe.get_all(
            "Purchase Receipt Item",
            filters={"parent": ["in", pr_names], "item_code": item_code},
            fields=["parent", "custom_sheet_size", "custom_sheet_pcs"]
        )
        for r in pr_rows:
            pr_items.setdefault(r.parent, []).append(r)
            
    se_items = {}
    if se_names:
        se_rows = frappe.get_all(
            "Stock Entry Detail",
            filters={"parent": ["in", se_names], "item_code": item_code},
            fields=["parent", "description"]
        )
        for r in se_rows:
            se_items.setdefault(r.parent, []).append(r)
            
    sheet_balance = {}
    result = []
    
    is_laminated = frappe.db.get_value("Item", item_code, "custom_glass_type") == "Laminated"
    
    for entry in ledger:
        sheets_in = {}
        sheets_out = {}
        entry_invoice_sft = 0.0
        
        if entry.voucher_type == "Stock Entry":
            rows = se_items.get(entry.voucher_no, [])
            for r in rows:
                desc = r.description or ""
                import re
                match = re.search(r"Invoice SFT:\s*([\d\.]+)", desc)
                if match:
                    entry_invoice_sft += frappe.utils.flt(match.group(1))

        if not is_laminated:
            if entry.voucher_type == "Purchase Receipt":
                rows = pr_items.get(entry.voucher_no, [])
                for r in rows:
                    size = (r.custom_sheet_size or "").strip()
                    pcs = frappe.utils.flt(r.custom_sheet_pcs)
                    if size and pcs > 0:
                        sheets_in[size] = sheets_in.get(size, 0) + pcs
                        sheet_balance[size] = sheet_balance.get(size, 0) + pcs
                        
            elif entry.voucher_type == "Stock Entry":
                rows = se_items.get(entry.voucher_no, [])
                for r in rows:
                    desc = r.description or ""
                    if "Sheets Consumed: " in desc:
                        idx = desc.find("Sheets Consumed: ") + len("Sheets Consumed: ")
                        raw_json = desc[idx:].strip()
                        if "\n" in raw_json:
                            raw_json = raw_json.split("\n")[0].strip()
                        try:
                            import json
                            sheets_data = json.loads(raw_json)
                            if isinstance(sheets_data, list):
                                for s in sheets_data:
                                    size = str(s.get("size") or "").strip()
                                    pcs = frappe.utils.flt(s.get("pcs"))
                                    if size and pcs > 0:
                                        sheets_out[size] = sheets_out.get(size, 0) + pcs
                                        sheet_balance[size] = sheet_balance.get(size, 0) - pcs
                        except Exception:
                            pass
                    if "Sheets Returned: " in desc:
                        # Written by invoice-edit corrective Material Receipts —
                        # symmetric to Sheets Consumed, restores the derived balance.
                        idx = desc.find("Sheets Returned: ") + len("Sheets Returned: ")
                        raw_json = desc[idx:].strip()
                        if "\n" in raw_json:
                            raw_json = raw_json.split("\n")[0].strip()
                        try:
                            import json
                            sheets_data = json.loads(raw_json)
                            if isinstance(sheets_data, list):
                                for s in sheets_data:
                                    size = str(s.get("size") or "").strip()
                                    pcs = frappe.utils.flt(s.get("pcs"))
                                    if size and pcs > 0:
                                        sheets_in[size] = sheets_in.get(size, 0) + pcs
                                        sheet_balance[size] = sheet_balance.get(size, 0) + pcs
                        except Exception:
                            pass
        
        sheet_balance_clean = {k: v for k, v in sheet_balance.items() if abs(v) > 0.0001}
        
        entry.sheets_in = sheets_in
        entry.sheets_out = sheets_out
        entry.sheet_balance = dict(sheet_balance_clean) # copy
        entry.invoice_sft = entry_invoice_sft
        
        # Only include in result if it falls within the requested date range
        include = True
        if from_date and str(entry.posting_date) < from_date:
            include = False
        if to_date and str(entry.posting_date) > to_date:
            include = False
            
        if include:
            result.append(entry)
            
    total_invoice_sft = sum(e.invoice_sft for e in result)

    # Enrich entries with linked Sales Invoice
    _attach_sales_invoices_to_entries(result)
            
    # Also return the final sheet balance for the summary cards
    final_balance = {k: v for k, v in sheet_balance.items() if abs(v) > 0.0001}
    
    return {
        "ledger": result,
        "final_sheet_balance": final_balance,
        "final_sft_balance": ledger[-1].qty_after_transaction if ledger else 0,
        "is_laminated": is_laminated,
        "total_invoice_sft": total_invoice_sft
    }


@frappe.whitelist()
def get_category_stock_balance(item_group=None, warehouse=None):
    """Return current stock balances for all items in a given Item Group (product category).
    If no item_group is supplied, return balances for ALL items.
    Optionally filter by warehouse.
    """
    filters = {"actual_qty": ["!=", 0]}
    if item_group:
        items = frappe.get_all("Item", filters={"item_group": item_group}, pluck="name")
        if not items:
            return []
        filters["item_code"] = ["in", items]
    if warehouse:
        filters["warehouse"] = warehouse

    bins = frappe.get_all(
        "Bin",
        filters=filters,
        fields=["item_code", "warehouse", "actual_qty", "stock_uom"],
        order_by="item_code asc",
        limit_page_length=0
    )

    # Enrich with item_name and item_group
    item_codes = list(set([b.item_code for b in bins]))
    item_map = {}
    if item_codes:
        item_list = frappe.get_all("Item", filters={"name": ["in", item_codes]}, fields=["name", "item_name", "item_group"])
        item_map = {i.name: i for i in item_list}

    for b in bins:
        item = item_map.get(b.item_code, {})
        b.item_name = item.get("item_name", b.item_code)
        b.item_group = item.get("item_group", "")
        if b.item_group == "Glass":
            glass_data = get_glass_stock_ledger(b.item_code, b.warehouse)
            b.sheet_balance = glass_data.get("final_sheet_balance", {})

    return bins


@frappe.whitelist()
def get_standard_stock_ledger(item_code, warehouse=None, from_date=None, to_date=None):
    """Return chronological Stock Ledger Entry records for any item (non-glass standard view).
    Returns a list of dicts with posting_date, posting_time, voucher_type, voucher_no,
    actual_qty, qty_after_transaction, stock_uom.
    """
    if not item_code:
        return []

    filters = {
        "item_code": item_code,
        "is_cancelled": 0
    }
    if warehouse:
        filters["warehouse"] = warehouse
    if from_date and to_date:
        filters["posting_date"] = ["between", [from_date, to_date]]
    elif from_date:
        filters["posting_date"] = [">=", from_date]
    elif to_date:
        filters["posting_date"] = ["<=", to_date]

    entries = frappe.get_all(
        "Stock Ledger Entry",
        filters=filters,
        fields=[
            "posting_date", "posting_time", "voucher_type", "voucher_no",
            "actual_qty", "qty_after_transaction", "stock_uom",
            "incoming_rate", "valuation_rate"
        ],
        order_by="posting_date asc, posting_time asc, creation asc",
        limit_page_length=0
    )

    # Enrich entries with linked Sales Invoice
    _attach_sales_invoices_to_entries(entries)

    return entries


@frappe.whitelist()
def save_jc_operations_consumption(job_card_name, consumption_json):
    """Save the sheet consumption JSON on the Job Card and automatically trigger
    repacks in the background for any Laminated Glass rows that haven't been repacked yet.
    """
    import json
    frappe.db.set_value("CAW Job Card", job_card_name, "custom_sheet_consumption_json", consumption_json)
    
    job_card = frappe.get_doc("CAW Job Card", job_card_name)
    if not job_card.quotation:
        return
        
    quotation_doc = frappe.get_doc("Quotation", job_card.quotation)
    consumption = json.loads(consumption_json or "{}")
    
    company = _get_default_stock_company()
    warehouse = _get_default_receiving_warehouse(company)
    
    for row in quotation_doc.items:
        if getattr(row, "custom_auto_generated", 0):
            continue
            
        glass_type = frappe.db.get_value("Item", row.item_code, "custom_glass_type")
        sale_mode = getattr(row, "custom_glass_sale_mode", "")
        
        is_laminated = (glass_type == "Laminated")
        is_resized_or_custom = (sale_mode in ("Resized", "Custom"))
        
        if not is_laminated and not is_resized_or_custom:
            continue
            
        row_consumption = consumption.get(row.name, [])
        if not row_consumption:
            continue
            
        # Check if we already created a repack or deduction for this row
        if is_laminated:
            se_exists = frappe.db.exists(
                "Stock Entry",
                {
                    "remarks": ["like", f"%Repacked for CAW Job Card: {job_card.name} Row: {row.name}%"],
                    "docstatus": 1
                }
            )
        else:
            se_exists = frappe.db.exists(
                "Stock Entry",
                {
                    "remarks": ["like", f"%Deducted for CAW Job Card: {job_card.name} Row: {row.name}%"],
                    "docstatus": 1
                }
            )
        if se_exists:
            continue
            
        sft_qty = 0
        configs = get_glass_sheet_configs()
        for sheet in row_consumption:
            size = sheet.get("size")
            pcs = frappe.utils.flt(sheet.get("pcs"))
            sft_per_sheet = next((frappe.utils.flt(c.get("sft")) for c in configs if c.get("size") == size), 0)
            sft_qty += sft_per_sheet * pcs
            
        if sft_qty <= 0.0001:
            continue
            
        # Check raw component stock sufficiency
        shortfalls = []
        for sheet in row_consumption:
            comp_item = sheet.get("item_consumed")
            size = sheet.get("size")
            pcs = frappe.utils.flt(sheet.get("pcs"))
            sft_per_sheet = next((frappe.utils.flt(c.get("sft")) for c in configs if c.get("size") == size), 0)
            needed = round(sft_per_sheet * pcs, 4)
            
            available = frappe.utils.flt(frappe.db.get_value(
                "Bin", {"item_code": comp_item, "warehouse": warehouse}, "actual_qty"
            ) or 0)
            if available + 0.0001 < needed:
                shortfalls.append({
                    "item": comp_item,
                    "needed": needed,
                    "available": available
                })
                
        if shortfalls:
            details = "; ".join(f"{s['item']} (need {s['needed']}, have {s['available']})" for s in shortfalls)
            frappe.throw(f"Insufficient stock in {warehouse} to produce/deduct {row.item_code}: {details}")
            
        total_sft = frappe.utils.flt(row.custom_area_sqft) * frappe.utils.flt(row.qty)
        
        if is_laminated:
            # Execute repack (consumes raw glass, produces laminated)
            _create_composite_repack_entry(
                row.item_code, row_consumption, total_sft, warehouse, company, job_card.name, row.name, configs
            )
            # Execute immediate stock deduction for Laminated Glass (via Material Issue)
            # This makes it behave identically to Cut/Resized glass and appear on the ledger right away.
            _create_glass_deduction_stock_entry_for_row(
                row.item_code, total_sft, warehouse, company, job_card.name, row.name, None, total_sft
            )
        else:
            # Execute immediate stock deduction for Resized/Cut Glass (via Material Issue)
            # Group sheets by item_consumed
            sheets_by_item = {}
            for sheet in row_consumption:
                itm = sheet.get("item_consumed") or row.item_code
                if itm not in sheets_by_item:
                    sheets_by_item[itm] = []
                sheets_by_item[itm].append(sheet)
                
            for itm, itm_sheets in sheets_by_item.items():
                itm_sft_release_qty = 0
                for sheet in itm_sheets:
                    size = sheet.get("size")
                    pcs = frappe.utils.flt(sheet.get("pcs"))
                    sft_per_sheet = next((frappe.utils.flt(c.get("sft")) for c in configs if c.get("size") == size), 0)
                    itm_sft_release_qty += sft_per_sheet * pcs
                
                if itm_sft_release_qty > 0.0001:
                    _create_glass_deduction_stock_entry_for_row(
                        itm, itm_sft_release_qty, warehouse, company, job_card.name, row.name, json.dumps(itm_sheets), total_sft
                    )

def _create_composite_repack_entry(laminated_item, row_consumption, sft_qty_from_quotation, warehouse, company, job_card_name, row_name, configs):
    import json
    entry = frappe.new_doc("Stock Entry")
    entry.stock_entry_type = "Repack"
    entry.company = company
    entry.remarks = f"Repacked for CAW Job Card: {job_card_name} Row: {row_name}"
    
    # Consumed items (Ordinary / Ready Laminated)
    for sheet in row_consumption:
        comp_item = sheet.get("item_consumed")
        size = sheet.get("size")
        pcs = frappe.utils.flt(sheet.get("pcs"))
        sft_per_sheet = next((frappe.utils.flt(c.get("sft")) for c in configs if c.get("size") == size), 0)
        needed = round(sft_per_sheet * pcs, 4)
        
        entry.append("items", {
            "item_code": comp_item,
            "s_warehouse": warehouse,
            "qty": needed,
            "description": f"Sheets Consumed: {json.dumps([{'size': size, 'pcs': pcs}])}"
        })
        
    # Produced item (Laminated Glass) - capturing only SFT
    entry.append("items", {
        "item_code": laminated_item,
        "t_warehouse": warehouse,
        "qty": round(frappe.utils.flt(sft_qty_from_quotation), 4)
    })
    
    entry.flags.ignore_permissions = True
    entry.insert()
    entry.submit()
    return entry.name


@frappe.whitelist()
def get_item_stock_balance(item_code):
    """Retrieve the current stock balance for an item across all warehouses.
    For standard Glass items, return sheet balances. For others, return quantities."""
    if not item_code:
        return []
        
    # Get item group and custom glass type
    item_info = frappe.db.get_value("Item", item_code, ["item_group", "custom_glass_type", "stock_uom"], as_dict=True)
    if not item_info:
        return []
        
    item_group = item_info.item_group
    is_glass = (item_group == "Glass")
    is_laminated = is_glass and (item_info.custom_glass_type == "Laminated")
    stock_uom = item_info.stock_uom or "Nos"
    
    # Query tabBin for all warehouses with non-zero stock
    bins = frappe.get_all(
        "Bin",
        filters={"item_code": item_code, "actual_qty": ["!=", 0]},
        fields=["warehouse", "actual_qty"]
    )
    
    balances = []
    for b in bins:
        warehouse = b.warehouse
        actual_qty = frappe.utils.flt(b.actual_qty)
        
        if is_glass and not is_laminated:
            # Reconstruct glass sheet balance for this warehouse
            try:
                ledger_data = get_glass_stock_ledger(item_code, warehouse)
                sheet_bal = ledger_data.get("final_sheet_balance") if isinstance(ledger_data, dict) else {}
            except Exception:
                sheet_bal = {}
                
            # Format sheet balance string
            if sheet_bal:
                sheet_strs = [f"{size}: {int(pcs)} pcs" for size, pcs in sheet_bal.items()]
                bal_str = ", ".join(sheet_strs)
            else:
                bal_str = f"0 sheets ({round(actual_qty, 2)} SFT)"
            
            balances.append({
                "warehouse": warehouse,
                "balance": bal_str,
                "qty": actual_qty,
                "uom": "SFT",
                "sheet_bal": sheet_bal
            })
        else:
            balances.append({
                "warehouse": warehouse,
                "balance": f"{round(actual_qty, 2)} {stock_uom}",
                "qty": actual_qty,
                "uom": stock_uom
            })
            
    return balances


