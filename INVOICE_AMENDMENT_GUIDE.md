# Sales Invoice: Cancel, Credit Note/Return, and Amend

Three different tools for three different problems. Use this guide to pick the right one.

## Cancel Invoice

**Use when:** the invoice itself shouldn't have existed in this form at all — wrong
customer details, wrong posting date, duplicate, or you need to fix something
administrative.

**What happens:** ERPNext reverses the GL entries (the accounting impact disappears). If
it was a job-card partial invoice, the job card's `payment_amount`/`balance_amount` are
also reversed. Crucially: the **physical goods release records are NOT touched** — if the
customer already walked out with glass/aluminium/ceiling sheets, that stays on record.
Cancellation is purely an accounting undo, not a "the goods came back" statement. The job
card freezes afterward until you either amend or otherwise resolve it.

**You cannot fix money this way** — cancel + amend only lets you change administrative
fields (see below). If the goal is changing what was billed, cancel/amend is the wrong
tool.

## Credit Note / Return

**Use when:** the invoice was financially wrong and you need to correct money — wrong rate
charged, customer disputes a price, or goods were physically returned.

Two sub-cases, same button (it opens ERPNext's standard return-against-invoice flow):

- **Price-only correction** (rate was wrong, qty/goods are fine): create the return, keep
  the same quantities, adjust the rate/amount to issue a partial refund/credit.
  `custom_collected_qty` is untouched — nothing changes about what was physically released.
- **Goods actually came back**: create the return with the reversed quantities. This is
  the one that also reverses `custom_collected_qty` on the quotation rows (via the
  `on_sales_invoice_submit` hook), so "remaining to invoice" stays correct.

This is the only path for changing **commercial** values — quantities, rates, taxes,
totals.

## Amend Invoice

**Use when:** nothing about the money is wrong, but you need to fix something
administrative — wrong posting date, due date, customer PO reference, remarks, terms, or
the print heading.

**How:**

1. Open the invoice in **Sales Invoice Manager**.
2. Click **Cancel Invoice** first (amendment in Frappe always starts from a cancelled doc).
3. Click **Amend Invoice** — this creates a new draft linked via `amended_from`.
4. A dialog opens letting you edit only: posting date, due date, PO/reference, remarks,
   terms.
5. Click **Save & Submit** — it re-submits through the job-card settlement path,
   **re-applies the exact same payment impact** (doesn't double-count), and re-links any
   ceiling-release records to the new invoice.

If you try to sneak a rate/qty/customer/tax change into that draft,
`sales_invoice_handler.py`'s `_enforce_admin_only_amendment` diffs it against the cancelled
original and throws — it'll tell you to use a Credit Note/Return instead.

## Quick decision rule

| Situation | Use |
|---|---|
| Wrong date / reference / remarks | **Amend** |
| Wrong price or quantity, goods still with customer | **Credit Note** (qty kept) |
| Goods physically returned | **Sales Return** (qty reversed) |
| Invoice shouldn't exist at all, no money correction needed | **Cancel** (then optionally Amend) |
