# Foreign Currency: FIFO Cost Basis and Month-End Revaluation

The books are kept in KES, but two bank accounts hold USD:

- `I & M USD A/C - CA`
- `DTB Bank USD A/C - CA`

Those dollars are treated as an **inventory of currency**. Every dollar that
enters carries the shillings it cost; every dollar that leaves is costed at what
the oldest remaining dollars cost, first in first out — the same way stock is
valued.

Two mechanisms follow from that, and they answer different questions. Confusing
them is the main source of trouble here, so start with this table.

| | FIFO cost basis | Exchange Rate Revaluation |
|---|---|---|
| Question it answers | What did the dollars cost? | What are they worth *right now*? |
| When | Continuously, as currency is paid out | Month-end |
| Effect | Sets the exchange rate on the payment | **Unrealised** gain/loss journal |
| Who uses it | Everyone entering payments | Statutory accounts, auditor |
| Built by | This app | ERPNext core (+ safety guards from this app) |

---

# Part 1 — Exchange rates on this site

**Nothing is fetched automatically.** Currency Exchange Settings is disabled and
there are deliberately **zero** Currency Exchange records, so ERPNext never
invents a rate. Previously the site pointed at a public FX API that quietly
supplied a *different* market rate as the default on every Payment Entry — close
enough to look right, wrong enough to misstate the USD position.

What that means depends on which way the money is going.

| Movement | Rate | Who sets it |
|---|---|---|
| **Buying USD** (KES bank → USD bank) | The actual rate the bank gave you | Typed |
| **Receiving USD** from a customer | CBK mean rate for the date | Typed |
| **Paying out of a USD account** | FIFO cost of the dollars being spent | **Derived — do not type** |
| **Selling USD** (USD bank → KES bank) | FIFO cost on the USD side; the shillings received are whatever the bank actually gave | Derived + actual |
| **Month-end revaluation** | CBK mean rate at the closing date | Typed |

Where a rate is typed, it is the **CBK (Central Bank of Kenya) mean rate** for
that date, and the person entering the document is responsible for looking it up.

Where a rate is derived, the field fills itself in as you enter the amount. It
will be overwritten on save if edited, and that is intentional — see Part 2.

**One warning about typed rates.** A decimal slip on a *purchase* — 13.15 for
131.50 — no longer just spoils a report. Purchases set the cost basis, and that
cost basis is posted to the GL by every later payment that consumes those
dollars. Check buy and receipt rates carefully.

See `patches/use_manual_cbk_exchange_rates.py`.

---

# Part 2 — The FIFO cost basis

## The problem it solves

Left to itself, ERPNext credits a bank account at the rate of each outgoing
payment. That rate has nothing to do with what the dollars cost, so the shilling
balance drifts away from reality.

Buy 500 USD at 130, then pay 200 away on a day when the rate is 131.50:

| Step | USD | KES posted | Rate |
|---|---|---|---|
| Buy 500 | +500 | +65,000 | 130.00 |
| Pay 200 | −200 | −26,300 | 131.50 |
| **Balance** | **300** | **38,700** | **129.00 implied** |

Those 200 dollars *cost* 26,000, but 26,300 came out of the account — 300 KES
more than they cost. The remaining 300 dollars now imply a rate of 129.00: not
what they cost (130.00), and not any rate that has ever existed. A residue, and
it grows with every payment.

## What we do instead

The payment is credited at **what those dollars cost**: 200 × 130 = 26,000. The
account keeps 300 USD at 39,000 KES, implied rate 130.00 — which is correct,
because those dollars came from the same purchase and were never touched.

The rate is worked out and written onto the Payment Entry automatically, before
it saves. Nobody types it.

### Worked example — ten transactions

| # | Txn | Rate posted | Lots consumed | Bal | Remaining lots |
|---|---|---|---|---|---|
| 1 | Buy 500 @130 | 130.0000 | new lot | 500 | 500 @130 |
| 2 | Pay 200 | **130.0000** | 200 @130 | 300 | 300 @130 |
| 3 | Buy 300 @129 | 129.0000 | new lot | 600 | 300 @130, 300 @129 |
| 4 | Pay 250 | **130.0000** | 250 @130 | 350 | 50 @130, 300 @129 |
| 5 | Buy 400 @128.5 | 128.5000 | new lot | 750 | 50 @130, 300 @129, 400 @128.5 |
| 6 | Pay 300 | **129.1667** | 50 @130 + 250 @129 | 450 | 50 @129, 400 @128.5 |
| 7 | Buy 250 @127.5 | 127.5000 | new lot | 700 | 50 @129, 400 @128.5, 250 @127.5 |
| 8 | Pay 350 | **128.5714** | 50 @129 + 300 @128.5 | 350 | 100 @128.5, 250 @127.5 |
| 9 | Buy 500 @131 | 131.0000 | new lot | 850 | 100 @128.5, 250 @127.5, 500 @131 |
| 10 | Pay 400 | **128.1875** | 100 @128.5 + 250 @127.5 + 50 @131 | 450 | 450 @131 |

Closing position: 450 USD carried at 58,950 KES, implied **131.00** — exactly
what those dollars cost. The GL agrees with the ledger at every single step, not
just at the end.

### Why the rate is often not a round market number

A payment routinely spans more than one lot. Txn 6 eats 50 dollars that cost 130
and 250 that cost 129, so the entry carries **129.1667** — the blended cost of
that particular mix. Txn 10 spans three lots at 128.1875.

Smaller worked example: lots of 20 @130 and 50 @129, paying 35 USD.

```
20 USD @130 = 2,600.00 KES
15 USD @129 = 1,935.00 KES
              ─────────
              4,535.00 KES for 35 USD  ->  rate 129.571429
```

**129.571429 matches no market quote and is not meant to.** It is the cost of
those particular dollars. A Payment Entry has only one exchange rate field, so
that is how the lot-by-lot split gets expressed. The FIFO panel on the entry
shows the breakdown that produced it.

## Where gain is recognised

**Paying a supplier realises nothing.** You spent dollars on a dollar invoice —
no currency was converted. The panel shows the cost and no gain, deliberately.

The economic result still reaches the P&L immediately, as the difference between
the invoice's rate and this cost rate, which ERPNext books natively against
Creditors. Say a USD 200 invoice was booked at 129 (Creditors 25,800) and paid
from lots costing 130:

| | Bank credited | Creditors cleared | To Exchange Gain/Loss |
|---|---|---|---|
| Old behaviour (spot 131.50) | 26,300 | 25,800 | −500, with +300 hidden in the bank |
| Now (cost 130) | 26,000 | 25,800 | **−200, complete** |

Both net to −200 — you settled a 25,800 liability with dollars that cost 26,000.
The difference is that the whole −200 is now recognised at payment time instead
of half of it hiding in the balance sheet.

**Selling dollars for shillings does realise gain**, because currency genuinely
converted and the shillings received are a fact. The USD side is credited at
cost, the KES side at what the bank actually paid, and ERPNext books the
difference to `Exchange Gain/Loss - CA` automatically through its exchange
gain/loss deduction row. Selling the closing 450 USD for 59,850 KES realises
**900** — verified against the engine.

**Holding dollars** produces gain only at month-end, through revaluation.

## The rules the ledger follows

- **Only bank and cash accounts** in a non-KES currency are tracked. Debtors and
  Creditors are excluded on purpose — a USD receivable is a claim, not currency
  you hold, and ERPNext already revalues it per invoice.
- **Direction decides the movement, not `payment_type`.** A USD→USD transfer
  between the two banks would otherwise read as a sale on one side and a
  purchase on the other, inventing a gain that never happened.
- **Same-currency transfers carry cost basis across intact** rather than
  re-costing at today's rate.
- **Incoming dollars enter at the rate the document recorded**, and that becomes
  their cost. Receipts from customers are appended to the ledger as a new lot,
  exactly like a purchase.
- **Nothing is stored.** The ledger replays the full history on every read, so
  it always reports itself correctly, even after a backdated entry.

## Where to see it

- **Payment Entry form** — a read-only panel showing which lots the entry
  consumed, at what cost, and the rate that came out of it.
- **Forex FIFO Ledger** report — the full movement history.
- **Forex FIFO Holdings** report — current lots and their cost basis.

## Two things that will stop you

**Paying more than the ledger has seen.** If dollars reached the account through
something the ledger does not read — a Journal Entry, or an opening balance from
before go-live — there is no cost for them, and **the entry is refused**. The
form warns as you type; saving throws with the shortfall named.

The fix is to record the missing currency as a Payment Entry so its cost is
known. There is no override, because the alternative is posting a fabricated
rate to the GL.

**Backdating.** FIFO depends on order, so slotting an entry into the past changes
which lots later payments drew on — and those payments have already posted their
rates. Nothing recalculates them. You get a warning naming the first affected
entry; heed it, or date the entry today instead. The real defence is closing
periods once they are done.

---

# Part 3 — Month-end revaluation

## Purpose

Between month-ends the books carry dollars at cost. Under IAS 21 a bank balance
is a monetary item that must be retranslated at the closing rate on each
reporting date — so at month-end the balance is restated to the CBK rate and the
difference booked to `Unrealized Exchange Gain/Loss - CA`.

Continuing the example: 450 USD carried at 58,950 (cost 131.00), CBK closes
January at **133.00**.

```
450 × 133.00 = 59,850     revalued balance
             − 58,950     carrying value (cost)
             ─────────
                 900      unrealised gain
```

That 900 is **purely a holding gain** — 450 × (133.00 − 131.00). Because costing
already removed the residue, the month-end figure now means exactly one thing:
what the dollars you still hold gained or lost while you held them. It is not
mixed up with trading results from payments already made.

"Unrealised" is the honest label: you still hold the dollars, the rate can move
back tomorrow, and nothing has been earned in cash.

## When

**Monthly, on the last day of the month**, as part of the close. Mandatory at
year-end.

Run it **after** every Payment Entry, Sales Invoice and Purchase Invoice for the
month is submitted — revaluation reads current balances, so anything entered
afterwards with a date inside the month leaves it stale.

## Before you start

1. All documents for the month submitted, nothing in draft.
2. Get the **CBK mean rate for the closing date**. Save a PDF or screenshot for
   the audit file — nothing on this site fetches it, so this is the accountant's
   evidence to produce.
3. Check the closing USD balances against the bank statements. Revaluing an
   unreconciled balance just multiplies an error by 133.

## The steps

> **Submitting the revaluation does not post anything.** Creating the Journal
> Entries is a separate click, and they arrive as **drafts** that must then be
> submitted. This is the usual place a close stalls, with someone believing it is
> done while the GL has not moved.

### Step 1 — New Exchange Rate Revaluation

Accounts → Exchange Rate Revaluation → New. Set company `Crystal aluminium` and
the posting date (e.g. 31-01-2026). Click **Get Entries**.

This is a *transaction document*, created fresh every month, like an invoice. It
is not an account. The accounts it posts to already exist and are never created
again.

### Step 2 — Type the CBK rates

Every account with a foreign-currency balance appears: both USD banks, plus any
USD Debtors/Creditors balances. Type the CBK rate into **New Exchange Rate** on
each row.

Leave rows flagged **`zero_balance`** alone — those are accounts holding zero
dollars but a leftover shilling balance, which ERPNext squares off deliberately.

If a rate is missed, submit throws with the account named. That guard is custom
(`exchange_rate_revaluation_handler.py`): without it a blank field reads as zero
and would value the entire USD position at nil, booking the whole balance as a
loss.

### Step 3 — Review and submit

Check **Total Gain/Loss** first. Two normal behaviours that look alarming the
first time: rows with zero gain are silently dropped on submit, and the total
splits into `gain_loss_booked` and `gain_loss_unbooked`.

### Step 4 — Create the Journal Entries

After submit, a **Create → Journal Entries** button appears. Click it. It
produces up to two **drafts** — a zero-balance JV and a revaluation JV — and
links to both in a message.

### Step 5 — Submit each Journal Entry

Open each draft and submit it. **Only now does the GL change.**

```
Dr  I & M USD A/C - CA                      900.00     (USD 0.00)
    Cr  Unrealized Exchange Gain/Loss - CA            900.00
```

Note the **USD 0.00** — no dollars move. The line carries shilling value with
zero foreign-currency amount, which is how the carrying value changes while the
balance stays 450 USD.

### Step 6 — Verify

- General ledger, USD bank: 450 USD now carrying 59,850 KES, implied 133.00.
- `Unrealized Exchange Gain/Loss - CA` shows the 900.

### Step 7 — Reverse it on the first of the next month

**This site uses reversing revaluations.** On 1 February, post a Journal Entry
equal and opposite to the revaluation JV, putting the account back to 58,950.

ERPNext does **not** do this automatically — it is a step on the close checklist
that has to actually get done.

Why reverse: the revaluation is a reporting-date snapshot, not part of the
underlying record. Reversing it means the account spends the month carrying
dollars at cost, matching the FIFO ledger exactly, and the only figures sitting
in the account during the month are real transactions. Each month's revaluation
is then computed fresh from cost rather than from last month's estimate.

It makes **no difference to profit** in any month — the reversal simply lands
the previous month's adjustment in the new month, which is where it would have
landed anyway as part of the next revaluation.

Year-end is unaffected: the closing revaluation stands at the reporting date,
and the reversal happens after it in the new year.

### Step 8 — Cross-check against FIFO

Worth building into the routine, because it is the only check that catches a bad
purchase rate typed months ago. Open **Forex FIFO Holdings**:

| | |
|---|---|
| FIFO cost of holdings | 58,950 (450 @131) |
| Revalued balance | 59,850 (450 @133) |
| Difference | 900 — should equal the revaluation gain |

Because the books carry dollars at cost, **the revaluation gain and this
difference should agree exactly**. If they do not, either a revaluation was left
unreversed from a previous month, or currency moved through a document the
ledger does not read.

## The accounts involved

Both already exist and are wired to the Company record. **Never create these as
part of month-end** — if that seems necessary, something is misconfigured and it
should go to the developer first.

| Account | Used for |
|---|---|
| `Exchange Gain/Loss - CA` | Realised: settling foreign-currency invoices, and gains on genuinely selling dollars |
| `Unrealized Exchange Gain/Loss - CA` | Month-end revaluation only |

Both sit under **Indirect Expenses**, so a *gain* appears as a negative expense
rather than as income. That is ERPNext's default and fine for reporting, but it
looks wrong the first time someone reads a −900 expense line as a cost.

## When things go wrong

| Situation | Fix |
|---|---|
| Rate typed wrong, JEs not yet submitted | Delete the draft JEs, cancel and amend the revaluation |
| Rate wrong, JEs already submitted | Cancel the JEs, then cancel the revaluation (clean, but only if the period is not closed) |
| Forgot to reverse last month | The next revaluation will be measured from an inflated base. Post the missing reversal before running it |
| A Payment Entry gets backdated into a closed month | The revaluation is stale, and so are the posted rates of later payments. The ledger self-corrects on the next read; the GL does not |
| FIFO panel empty on a submitted entry | Normal if the entry does not touch a tracked USD account |

---

# Part 4 — For developers

| File | Purpose |
|---|---|
| `crystal_alluminium_works/forex_fifo.py` | The ledger. Pure FIFO core (`consume`, `replay`) with no frappe dependency, the Payment Entry reader, and `get_cost_rate` |
| `crystal_alluminium_works/payment_entry_forex_rate.py` | `before_validate` handler: stamps the cost rate, refuses shortfalls, warns on backdating |
| `crystal_alluminium_works/public/js/payment_entry_fifo_rate.js` | Fills the rate in on the form as the entry is typed |
| `crystal_alluminium_works/public/js/payment_entry_forex_fifo.js` | Read-only lot panel on the entry |
| `crystal_alluminium_works/exchange_rate_revaluation_handler.py` | Blocks blank rates; recomputes `new_balance_in_base_currency` server-side |
| `crystal_alluminium_works/report/forex_fifo_ledger/` | Movement history |
| `crystal_alluminium_works/report/forex_fifo_holdings/` | Current lots and cost basis |
| `patches/add_payment_entry_forex_fifo_fields.py` | Creates the panel's custom fields |
| `patches/use_manual_cbk_exchange_rates.py` | Disables rate fetching |
| `patches/setup_unrealized_exchange_account.py` | Creates and wires the unrealised account |

Custom fields on Payment Entry: `custom_forex_fifo_section`,
`custom_forex_fifo_html`. Both are in `fixtures/custom_field.json` — run
`bench export-fixtures` and check the diff before committing changes to them.

**Why `before_validate`.** Setting `source_exchange_rate` before ERPNext's own
`validate` runs means every downstream figure — base amounts, the exchange
gain/loss deduction row, allocation checks — is derived from it by ERPNext
itself. Setting it in `validate` would leave those figures computed from a rate
no longer on the document. ERPNext only fetches a rate when the field is falsy,
so a value set this early survives.

**Why the sale case needs no special handling.** `set_exchange_gain_loss()`
appends a deduction for `base_paid_amount − base_received_amount` using the
company's `exchange_gain_loss_account` and `cost_center` (both set). Crediting
the USD side at cost while the KES side carries actual proceeds produces exactly
that difference, so the realised gain books itself and `difference_amount` lands
at zero.

**Why the guard on the revaluation handler matters.**
`new_balance_in_base_currency` — the number gain/loss is derived from — is
normally calculated in client script when the rate changes. Anything that does
not run that script (the API, a data import, a browser hiccup) leaves it at 0
while the rate reads fine, producing a full write-off that passes a rate-only
check. The handler recomputes it server-side.

**The repost gap.** This module is GL-determining, so history edits are
consequential: a backdated or cancelled entry changes which lots later payments
consumed, and those payments have already posted. Nothing reposts them. The
handler warns; the real defence is closing periods. If drift is suspected,
compare **Posted Rate** against **FIFO Cost Rate** in the Forex FIFO Ledger — on
outbound rows they should be identical.

**Current state:** wired, migrated, and verified against a simulated
ten-transaction history. As of this writing the site has **0 submitted Payment
Entries and 0 Exchange Rate Revaluations** — none of it has run on real data.
