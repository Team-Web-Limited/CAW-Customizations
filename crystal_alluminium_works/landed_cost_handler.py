"""Ship No -> Landed Cost Voucher wiring.

An import arrives as one shipment identified by a Ship No, but it reaches the
books as several Purchase Invoices: the goods themselves (invoices with "Update
Stock" ticked, which take the stock in) and everything spent getting them here
-- freight, clearing, duty, port charges -- billed by other vendors on ordinary
non-stock invoices. All of them carry the same Ship No.

A Landed Cost Voucher has to reassemble that shipment:

  * ``purchase_receipts`` (Vouchers)  -- the receipts the cost lands on, i.e.
    the stock-updating invoices (and Purchase Receipts, see _receipt_sources).
  * ``vendor_invoices``              -- the non-stock invoices being spread.
  * ``taxes`` (Landed Cost)          -- one charge per expense-account line on
    those non-stock invoices, which is what actually gets distributed.

Typing the Ship No on the voucher is the only input; this module answers with
all three tables, and public/js/landed_cost_voucher.js fills them in as the
field is keyed. Amounts are net of tax: the tax on a clearing agent's invoice is
recoverable input VAT and does not belong in the cost of the goods.

This replaces the "Landed Cost Voucher ship no" Client Script that used to live
in the database and only filled the Vouchers table.
"""

import frappe
from frappe import _
from frappe.utils import flt

# Ship No only ever identifies submitted documents -- a draft invoice has no
# cost to land, and the voucher refuses unsubmitted receipts on validate.
DOCSTATUS_SUBMITTED = 1


def _receipt_sources():
    """Doctypes a shipment's stock can arrive through, that carry a Ship No.

    Today only Purchase Invoice has the custom_ship_no field, so goods come in
    on stock-updating invoices. Purchase Receipt is listed because the business
    describes the flow as "purchase invoice / purchase receipt"; adding the same
    custom field to Purchase Receipt is all it takes to switch that on.
    """
    sources = []
    for doctype in ("Purchase Invoice", "Purchase Receipt"):
        if frappe.get_meta(doctype).has_field("custom_ship_no"):
            sources.append(doctype)
    return sources


@frappe.whitelist()
def get_ship_no_documents(ship_no, company=None):
    """Return the three Landed Cost Voucher tables for one Ship No.

    Shape mirrors the child tables so the client can drop the rows straight in:
    ``{"purchase_receipts": [...], "vendor_invoices": [...], "taxes": [...]}``.
    """
    ship_no = (ship_no or "").strip()
    if not ship_no:
        return {"purchase_receipts": [], "vendor_invoices": [], "taxes": []}

    receipts = []
    vendor_invoices = []
    taxes = []

    for doctype in _receipt_sources():
        for doc in _shipment_documents(doctype, ship_no, company):
            if doctype == "Purchase Invoice" and not doc.update_stock:
                # No stock impact: this is a cost to spread, not a cost to land on.
                invoice_taxes = _expense_charges(doc)
                if not invoice_taxes:
                    continue
                taxes.extend(invoice_taxes)
                vendor_invoices.append(
                    {
                        "vendor_invoice": doc.name,
                        # Keep the vendor-invoice total and the charges it
                        # produced in step, so the two totals on the voucher
                        # reconcile instead of differing by tax.
                        "amount": sum(flt(t["base_amount"]) for t in invoice_taxes),
                    }
                )
                continue

            receipts.append(
                {
                    "receipt_document_type": doctype,
                    "receipt_document": doc.name,
                    "supplier": doc.supplier,
                    "posting_date": str(doc.posting_date),
                    "grand_total": flt(doc.base_grand_total),
                }
            )

    return {
        "purchase_receipts": receipts,
        "vendor_invoices": vendor_invoices,
        "taxes": taxes,
    }


def _shipment_documents(doctype, ship_no, company):
    """Submitted documents of `doctype` carrying this Ship No."""
    filters = {"custom_ship_no": ship_no, "docstatus": DOCSTATUS_SUBMITTED}
    if company:
        filters["company"] = company

    fields = ["name", "supplier", "posting_date", "base_grand_total", "currency", "conversion_rate"]
    if doctype == "Purchase Invoice":
        fields.append("update_stock")

    return frappe.get_all(doctype, filters=filters, fields=fields, order_by="posting_date asc, name asc")


def _expense_charges(invoice):
    """One Landed Cost row per expense-account line on a non-stock invoice.

    ``amount`` on a Landed Cost row is in the expense account's own currency and
    the controller multiplies it by ``exchange_rate``. So when the account is
    booked in the invoice's currency the invoice's own line and rate carry over
    untouched; otherwise fall back to company currency, where the invoice has
    already done the conversion for us.
    """
    company = frappe.db.get_value("Purchase Invoice", invoice.name, "company")
    company_currency = frappe.get_cached_value("Company", company, "default_currency")

    charges = []
    items = frappe.get_all(
        "Purchase Invoice Item",
        filters={"parent": invoice.name},
        fields=["item_code", "item_name", "description", "expense_account", "net_amount", "base_net_amount"],
        order_by="idx asc",
    )

    for item in items:
        if not item.expense_account or not flt(item.base_net_amount):
            continue

        account_currency = (
            frappe.get_cached_value("Account", item.expense_account, "account_currency") or company_currency
        )

        if account_currency == invoice.currency:
            amount = flt(item.net_amount)
            exchange_rate = flt(invoice.conversion_rate) or 1
        else:
            account_currency = company_currency
            amount = flt(item.base_net_amount)
            exchange_rate = 1

        charges.append(
            {
                "description": _("{0}: {1}").format(
                    invoice.name, item.item_name or item.item_code or item.description
                ),
                "expense_account": item.expense_account,
                "account_currency": account_currency,
                "exchange_rate": exchange_rate,
                "amount": amount,
                "base_amount": flt(item.base_net_amount),
            }
        )

    return charges
