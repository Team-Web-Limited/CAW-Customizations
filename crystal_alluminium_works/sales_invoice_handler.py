import frappe
from crystal_alluminium_works.pricing_engine import (
    calculate_ceiling_pricing,
    get_price_adjustment_multiplier,
    process_glass_item,
    reapply_price_adjustment,
)


def _reset_auto_generated_ceiling_component_pricing(doc):
    for item in doc.items:
        if not getattr(item, "custom_auto_generated", 0):
            continue

        if (getattr(item, "custom_product_category", "") or "") != "Ceiling":
            continue

        # Ceiling bundle component rows are informational only; the parent
        # ceiling row already carries the quoted commercial amount.
        item.rate = 0.0
        item.amount = 0.0
        if hasattr(item, "price_list_rate"):
            item.price_list_rate = 0.0
        if hasattr(item, "base_price_list_rate"):
            item.base_price_list_rate = 0.0
        if hasattr(item, "rate_with_margin"):
            item.rate_with_margin = 0.0
        if hasattr(item, "base_rate_with_margin"):
            item.base_rate_with_margin = 0.0
        if hasattr(item, "discount_amount"):
            item.discount_amount = 0.0
        if hasattr(item, "discount_percentage"):
            item.discount_percentage = 0.0
        if hasattr(item, "base_rate"):
            item.base_rate = 0.0
        if hasattr(item, "base_amount"):
            item.base_amount = 0.0
        if hasattr(item, "net_rate"):
            item.net_rate = 0.0
        if hasattr(item, "net_amount"):
            item.net_amount = 0.0
        if hasattr(item, "base_net_rate"):
            item.base_net_rate = 0.0
        if hasattr(item, "base_net_amount"):
            item.base_net_amount = 0.0


def _enforce_admin_only_amendment(doc):
    """An amended Sales Invoice may only change administrative fields (posting/due dates,
    PO ref, remarks, terms, print heading). Every commercial value is diffed against the
    cancelled original and any change is rejected — monetary corrections must go through a
    Credit Note or Sales Return instead. Pricing-engine regeneration is deliberately
    skipped so amounts can't silently drift if pricing config changed since the original."""
    from frappe.utils import flt

    original = frappe.get_doc("Sales Invoice", doc.amended_from)

    def _amt(value):
        return flt(value, 2)

    message = (
        "Only administrative fields (dates, PO reference, remarks, terms, print heading) can "
        "be changed on an amended invoice. Use a Credit Note or Sales Return to correct money, "
        "quantities or taxes."
    )

    if (doc.customer or "") != (original.customer or ""):
        frappe.throw(message)

    for field in ("total", "net_total", "grand_total", "base_grand_total", "total_taxes_and_charges"):
        if _amt(doc.get(field)) != _amt(original.get(field)):
            frappe.throw(message)

    def _rows(invoice):
        return [
            (r.item_code, _amt(r.qty), _amt(r.rate), _amt(r.amount))
            for r in invoice.items
            if not getattr(r, "custom_auto_generated", 0)
        ]

    if _rows(doc) != _rows(original):
        frappe.throw(message)

    # Administrative amendments stay non-stock and keep their manual posting time.
    doc.update_stock = 0
    doc.set_posting_time = 1


# Credit notes (returns) are a bare 4-digit number continuing the previous system (8485, 8486,
# ...). A bare series has no prefix to key its counter on, so autoname below draws it from its
# own tabSeries key ("CN-", seeded by patches/seed_credit_note_series) and naming_series is set
# to the same key as a fallback. An amended credit note keeps its original name with the usual
# -1 suffix. (They were ACC-CNN-.YYYY.- until 2026-10-01.)
CREDIT_NOTE_SERIES_KEY = "CN-"
CREDIT_NOTE_NAMING_SERIES = "CN-.####"


# Invoices continue the numbering of the system they replace, one run per customer type, as
# the bare number with no prefix or year. The leading digit is each series' prefix, so the two
# keep separate counters in tabSeries ("1", "8"): Invoice Customers get 10009838, Cash
# Customers 80552. Invoices before 2026-10-01 keep their old INV-<year>- names; the counters
# carried over from "INV-2026-1" / "INV-2026-8" (see patches/carry_sales_invoice_series_counters).
INVOICE_CUSTOMER_NAMING_SERIES = "1.#######"
CASH_CUSTOMER_NAMING_SERIES = "8.####"


def before_insert(doc, method):
    if doc.get("amended_from"):
        return
    if doc.get("is_return"):
        doc.naming_series = CREDIT_NOTE_NAMING_SERIES
        return

    from crystal_alluminium_works.api import SHARED_CASH_CUSTOMER_NAME

    billing_type = frappe.db.get_value("Customer", doc.customer, "custom_customer_billing_type")
    is_cash = billing_type == "Cash Customer" or doc.customer == SHARED_CASH_CUSTOMER_NAME
    doc.naming_series = CASH_CUSTOMER_NAMING_SERIES if is_cash else INVOICE_CUSTOMER_NAMING_SERIES


def autoname(doc, method):
    if doc.get("is_return") and not doc.get("amended_from"):
        from frappe.model.naming import getseries

        doc.name = getseries(CREDIT_NOTE_SERIES_KEY, 4)


def on_validate(doc, method):
    """
    Sales Invoice validate hook.
    Re-run the pricing engine to generate glass/ceiling service rows,
    mirroring the same logic used in quotation_handler.py and sales_order_handler.py.
    """
    # Amended invoices are administrative-only: lock commercial fields and skip the
    # pricing-engine regeneration entirely so amounts can't drift.
    if doc.get("amended_from"):
        _enforce_admin_only_amendment(doc)
        return

    # Credit notes / Sales Returns carry the original invoice's rows verbatim (with
    # reversed quantities); never re-run the pricing engine on them.
    if doc.get("is_return"):
        doc.update_stock = 0
        doc.set_posting_time = 1
        return

    # Keep custom invoicing non-stock for now.
    doc.update_stock = 0
    doc.set_posting_time = 1

    # ── 1. Remove old auto-generated rows to avoid duplication ────────
    items_to_keep = []
    for item in doc.items:
        if not item.custom_auto_generated:
            items_to_keep.append(item)
    doc.items = items_to_keep

    new_items = []
    # The Quotation Builder's +/- %, mapped here from the Quotation — see reapply_price_adjustment.
    adjustment_multiplier = get_price_adjustment_multiplier(doc)
    rates_adjusted = False
    quoted = _QuotedRates(doc)

    # ── 2. Process each remaining item through the pricing engine ─────
    for idx, item in enumerate(doc.items):
        item_group = frappe.get_cached_value("Item", item.item_code, "item_group")

        if item_group == "Glass":
            auto_rows = process_glass_item(item, idx + 1)
            new_items.extend(auto_rows)
        elif item_group == "Ceiling":
            auto_rows = calculate_ceiling_pricing(item, idx + 1)
            new_items.extend(auto_rows)
        else:
            continue
        # The engine priced the row at today's rates; a row invoiced from a quotation goes back
        # to its quoted price, which already carries the Builder's +/- %.
        if quoted.restore_row(item, idx + 1):
            rates_adjusted = True
            continue
        rates_adjusted = reapply_price_adjustment(item, item_group, adjustment_multiplier) or rates_adjusted

    # ── 3. Append generated service rows ──────────────────────────────
    for new_item in new_items:
        quoted.restore_service_row(new_item)
        doc.append("items", new_item)

    # Ensure invoice-only accounting fields are filled for both mapped
    # rows and the auto-generated service lines before mandatory checks.
    doc.set_missing_item_details(for_validate=True)
    _reset_auto_generated_ceiling_component_pricing(doc)

    # ── 4. Recalculate totals since we added new items ────────────────
    if new_items or rates_adjusted:
        doc.calculate_taxes_and_totals()


class _QuotedRates:
    """The prices a Sales Invoice made from a quotation must keep.

    The pricing engine re-prices cut-size / full-sheet glass and ceiling bundles from the Item's
    current rate, and rebuilds glass service rows (polishing, holes, notches, sandblasting) at
    today's service rates — so a price change after the customer accepted and paid the quotation
    made its invoice cost more (or less) than quoted, and the cash release check then asked them
    to pay the difference. Rows linked to their Quotation Item (custom_quotation_row, set by
    api.make_sales_invoice_from_quotation) get the quoted price back here; quantities, area and
    which service rows exist still come from the engine, so partial releases scale as before.
    Aluminium, fittings and the rest are never re-priced, so they keep the mapped quoted rate.
    Rows without the link (invoices made before it existed) are priced as before."""

    def __init__(self, doc):
        names = [row.custom_quotation_row for row in doc.items if row.get("custom_quotation_row")]
        self.rows = {}
        self.services = {}
        self.parent_by_invoice_idx = {}
        if not names:
            return
        fields = ["name", "parent", "idx", "item_code", "rate", "custom_ceiling_sq_m"]
        for row in frappe.get_all("Quotation Item", filters={"name": ["in", names]}, fields=fields):
            self.rows[row.name] = row
        parents = list({row.parent for row in self.rows.values()})
        for row in frappe.get_all(
            "Quotation Item",
            filters={"parent": ["in", parents], "custom_auto_generated": 1},
            fields=["parent", "custom_parent_row_idx", "item_code", "rate"],
        ):
            self.services[(row.parent, frappe.utils.cint(row.custom_parent_row_idx), row.item_code)] = row.rate

    def restore_row(self, item, invoice_idx):
        source = self.rows.get(item.get("custom_quotation_row"))
        if not source or frappe.utils.flt(source.rate) <= 0:
            return False
        self.parent_by_invoice_idx[invoice_idx] = source

        quoted_sq_m = frappe.utils.flt(source.custom_ceiling_sq_m)
        if quoted_sq_m and frappe.utils.flt(item.get("custom_ceiling_sq_m")):
            # A ceiling bundle is one row priced sqm x rate per sqm, and a partial release
            # carries fewer sqm — keep the quoted rate per sqm, not the whole-bundle rate.
            item.rate = frappe.utils.flt(item.custom_ceiling_sq_m) * frappe.utils.flt(source.rate) / quoted_sq_m
        else:
            # Glass is priced per piece; a partial release only changes the number of pieces.
            item.rate = frappe.utils.flt(source.rate)
        item.amount = frappe.utils.flt(item.qty) * item.rate
        return True

    def restore_service_row(self, service_row):
        parent = self.parent_by_invoice_idx.get(frappe.utils.cint(service_row.get("custom_parent_row_idx")))
        if not parent:
            return
        rate = self.services.get((parent.parent, frappe.utils.cint(parent.idx), service_row.get("item_code")))
        if rate is None:
            return
        service_row["rate"] = frappe.utils.flt(rate)
        service_row["amount"] = frappe.utils.flt(service_row.get("qty")) * service_row["rate"]


def refresh_draft_invoice(name):
    invoice = frappe.get_doc("Sales Invoice", name)
    if invoice.docstatus != 0:
        frappe.throw("Only draft Sales Invoices can be refreshed safely.")

    invoice.save(ignore_permissions=True)
    return {
        "name": invoice.name,
        "grand_total": invoice.grand_total,
        "rounded_total": invoice.rounded_total,
        "outstanding_amount": invoice.outstanding_amount,
    }
