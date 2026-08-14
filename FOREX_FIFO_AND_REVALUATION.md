# Foreign Currency: FIFO Cost Basis and Month-End Revaluation

The books are kept in KES, but two bank accounts hold USD:

- `I & M USD A/C - CA`
- `DTB Bank USD A/C - CA`

Two separate mechanisms deal with that, and they answer different questions. Confusing
them is the main source of trouble here, so start with this table.

| | FIFO ledger | Exchange Rate Revaluation |
|---|---|---|
| Question it answers | What did the dollars cost, and what did trading them earn? | What are the dollars worth *right now*? |
| When | Continuously, on every payment | Month-end |
| Result | **Realised** gain/loss | **Unrealised** gain/loss |
| Posts to the GL | **No — report only** | **Yes**, via Journal Entry |
| Who uses it | Management | Statutory accounts, auditor |
| Built by | This app | ERPNext core (+ a safety guard from this app) |

The FIFO ledger changes nothing in your accounts. Revaluation is the only one of the two
that touches the GL.

---

# Part 1 — Exchange rates on this site

**Rates are typed by hand. Nothing is fetched automatically.**

Currency Exchange Settings is disabled, and there are deliberately **zero** Currency
Exchange records. With both true, `get_exchange_rate` returns 0 and a rate is never
invented — whoever enters the document must type the **CBK (Central Bank of Kenya) mean
rate** for that date.

This is intentional, not a gap. Previously the site pointed at a public FX API which
quietly supplied a *different* market rate as the default on every Payment Entry — close
enough to look right, wrong enough to misstate the USD position.

No Currency Exchange records are kept either, because Accounts Settings has
`allow_stale = 1`: a single record would silently become the rate for every later date and
never be reconsulted.

**Consequence for everyone entering documents:** the exchange rate field arrives blank or
zero on every foreign-currency document. That is normal. Look up the CBK rate for the
posting date and type it in.

See `patches/use_manual_cbk_exchange_rates.py`.

---

# Part 2 — The FIFO ledger

## Why it exists

ERPNext credits a bank at the rate of each outgoing payment, and books no exchange gain
against the bank itself. So the KES carrying value of a USD account becomes an
accumulation of historical rates rather than anything meaningful.

Worked small: buy 500 USD at 130, pay 200 away at 131.50.

| Step | USD | KES posted to the account | Rate |
|---|---|---|---|
| Buy 500 | +500 | +65,000 | 130.00 |
| Pay 200 | −200 | −26,300 | 131.50 |
| **Balance** | **300** | **38,700** | **129.00 implied** |

Those 200 dollars *cost* 26,000 (200 × 130), but ERPNext removed 26,300 from the account.
It took out 300 KES more than they cost. That 300 is your gain — bought at 130, disposed
at 131.50 — but it is never recognised as a gain. It is absorbed into the remaining
balance, which now implies 129.00: not the cost of the dollars (130.00), and not any spot
rate that ever existed. A residue.

The FIFO ledger recovers the real numbers.

## How it works

Each USD bank account is treated as an **inventory of dollars**. Every dollar that enters
carries the KES it cost. Every dollar that leaves consumes the **oldest lot first**, and
the difference against the payment rate is the realised gain or loss.

### Worked example — ten transactions

| # | Txn | Rate | Lots consumed | Cost | Proceeds | Gain/Loss | Bal | Remaining lots |
|---|---|---|---|---|---|---|---|---|
| 1 | Buy 500 | 130.00 | new lot | | | | 500 | 500 @130 |
| 2 | Pay 200 | 131.50 | 200 @130 | 26,000 | 26,300 | **+300** | 300 | 300 @130 |
| 3 | Buy 300 | 129.00 | new lot | | | | 600 | 300 @130, 300 @129 |
| 4 | Pay 250 | 129.50 | 250 @130 | 32,500 | 32,375 | **−125** | 350 | 50 @130, 300 @129 |
| 5 | Buy 400 | 128.50 | new lot | | | | 750 | 50 @130, 300 @129, 400 @128.5 |
| 6 | Pay 300 | 128.00 | 50 @130 + 250 @129 | 38,750 | 38,400 | **−350** | 450 | 50 @129, 400 @128.5 |
| 7 | Buy 250 | 127.50 | new lot | | | | 700 | 50 @129, 400 @128.5, 250 @127.5 |
| 8 | Pay 350 | 129.00 | 50 @129 + 300 @128.5 | 45,000 | 45,150 | **+150** | 350 | 100 @128.5, 250 @127.5 |
| 9 | Buy 500 | 131.00 | new lot | | | | 850 | 100 @128.5, 250 @127.5, 500 @131 |
| 10 | Pay 400 | 132.00 | 100 @128.5 + 250 @127.5 + 50 @131 | 51,275 | 52,800 | **+1,525** | 450 | 450 @131 |

Cumulative realised gain: **+1,500 KES**. Note that a single payment (10) carries most of
it, and that payments 4 and 6 lost money because the rate had dipped below what those
dollars cost.

### The same history, both valuations

| | USD held | KES value | Implied rate |
|---|---|---|---|
| FIFO (what the dollars cost) | 450 | **58,950** | **131.00** |
| GL (ERPNext's carrying value) | 450 | **57,450** | 127.6667 |
| Gap | | **1,500** | |

**The gap equals cumulative realised gain — at every step, not just at the end.** Running
through the ten rows the gap reads 0, 300, 300, 175, 175, −175, −175, −25, −25, 1,500,
matching the running total of the gain column exactly. Purchases never move the gap; only
payments do. It goes negative when you are sitting on losses.

That identity is the whole point: **the amount by which the GL's carrying value is wrong
is exactly the trading gain it declined to recognise.**

## The rules it follows

- **Only bank and cash accounts** in a non-KES currency are tracked. Debtors and Creditors
  are excluded on purpose — a USD receivable is a claim, not currency you hold, and
  ERPNext already revalues it per invoice. Including them would double-count.
- **Direction decides the movement, not `payment_type`.** A USD→USD transfer between the
  two banks would otherwise read as a sale on one side and a purchase on the other, and
  invent a gain that never happened.
- **Gain arises only on the way out.** Currency arriving from a customer lands at the rate
  the GL debited the bank at, so it carries no gain of its own; the
  invoice-rate-vs-receipt-rate difference is receivable FX and ERPNext has already booked
  it against Debtors.
- **Same-currency transfers carry cost basis across intact** rather than re-costing at
  today's rate. Any quantity that fails to arrive (a bank fee taken in currency) is a real
  loss of the oldest lots.
- **Shortfalls carry no gain.** If more currency leaves than the ledger ever saw enter, the
  uncovered part is flagged rather than valued — booking it at the transaction rate would
  record a 100% "gain" on currency whose acquisition was never seen. A shortfall almost
  always means currency moved through a Journal Entry (which this ledger does not read) or
  an opening balance was never captured.
- **Lots are costed at what the GL actually posted** (`base_received_amount`), so the
  ledger can never drift from the books.
- **Nothing is stored.** The ledger replays the full history on every read, so backdated,
  amended and cancelled entries need no repost — the next read simply sees a different
  history.

## Where to see it

- **Payment Entry form** — a read-only FIFO panel on each submitted entry, showing which
  lots it consumed, at what cost, and the resulting gain or loss.
- **Forex FIFO Ledger** report — the full movement history.
- **Forex FIFO Holdings** report — current lots and their cost basis.

## What it does *not* do

It does not post. Nothing in the trial balance, P&L or balance sheet changes because of
it. The 1,500 above will **not** appear in `Exchange Gain/Loss - CA`.

That gain is not lost — it is sitting inside the bank's carrying value as the thing that
makes the implied rate 127.67 instead of 131.00. It reaches the P&L by one of two routes:

1. **Revaluation** restates the balance and the gain comes out (see Part 3).
2. **The account empties.** Sell all 450 USD at 133 and ERPNext credits 59,850 against a
   carrying value of 57,450, leaving the account at zero dollars and **minus 2,400 KES**.
   That leftover is squared off by revaluation's zero-balance handling.

Either way the money arrives — just late, and filed under "unrealised".

**Why it was built not to post**, in order of weight:

1. **Double counting.** Revaluation already sweeps up the same gain. Posting both would
   book the same movement twice, and you would have to give up revaluation — the one the
   auditor expects.
2. **The ledger is derived.** Backdating an entry changes past answers. That is a feature
   for a report and a catastrophe for a poster.
3. **ERPNext's treatment is not illegitimate.** Combined with revaluation it produces
   correct financial statements. It simply cannot answer a management question.

---

# Part 3 — Month-end revaluation

## Purpose

Under IAS 21, monetary items are retranslated at the closing rate each reporting date. A
bank balance is monetary, so the balance sheet must state what the dollars are worth on
the reporting date — not the accumulated arithmetic of past transactions.

Continuing the example: 450 USD, GL carrying 57,450, CBK closes January at **133.00**.

```
450 × 133.00 = 59,850     revalued balance
             − 57,450     current carrying value
             ─────────
               2,400      gain booked to Unrealized Exchange Gain/Loss
```

Without it the balance sheet reports 57,450 for something worth 59,850 — understating
assets by 2,400, on a figure the auditor can check with one phone call to CBK.

### What that 2,400 is made of

| Component | Amount | What it is |
|---|---|---|
| Correcting the residue | 1,500 | Trading gains already earned on payments 2, 4, 6, 8, 10 that the GL never recognised |
| Genuine holding gain | 900 | 450 USD × (133.00 − 131.00) — the dollars still held appreciating above cost |
| **Total booked** | **2,400** | |

Only the 900 is a true holding gain for the month. The 1,500 is deferred recognition of
trading that already happened. **The GL cannot separate these — the FIFO reports are the
only place that distinction exists.**

## When

**Monthly, on the last day of the month**, as part of the close. Mandatory at year-end;
monthly is what keeps management accounts meaningful and stops a year of drift landing in
one December number.

Run it **after** every Payment Entry, Sales Invoice and Purchase Invoice for the month is
submitted. Revaluation reads current balances, so anything entered afterwards with a date
inside the month leaves it stale.

## Before you start

1. All documents for the month submitted — nothing sitting in draft.
2. Get the **CBK mean rate for the closing date** from the Central Bank of Kenya daily
   indicative rates. Save a PDF or screenshot for the audit file. Nothing on this site
   fetches it, so this is the accountant's evidence to produce.
3. Check the closing USD balances against the bank statements. Revaluing an unreconciled
   balance just multiplies an error by 133.

## The steps

> **Submitting the revaluation does not post anything.** Creating the Journal Entries is a
> separate click, and they arrive as **drafts** that must then be submitted. Three steps,
> not one — this is the usual place month-end stalls, with someone believing it is done
> while the GL has not moved.

### Step 1 — New Exchange Rate Revaluation

Accounts → Exchange Rate Revaluation → New. Set company `Crystal aluminium` and the
posting date (e.g. 31-01-2026). Click **Get Entries**.

This is a *transaction document*, created fresh every month — like an invoice. It is not
an account. The accounts it posts to already exist and are never created again.

### Step 2 — Type the CBK rates

Every account with a foreign-currency balance appears: both USD banks, plus any USD
Debtors/Creditors balances. Type the CBK rate into **New Exchange Rate** on each row.

The **Current Exchange Rate** column will show something odd like 127.6667. That is the
residue from Part 2, not a real rate. Ignore it.

Leave rows flagged **`zero_balance`** alone — those are accounts holding zero dollars but a
leftover shilling balance, which ERPNext squares off deliberately.

If a rate is missed, submit throws with the account named. That guard is custom
(`exchange_rate_revaluation_handler.py`) and it matters: without it a blank field reads as
zero and would value the entire USD position at nil, booking the whole KES balance as a
loss.

### Step 3 — Review and submit

Check **Total Gain/Loss** before submitting. Two normal behaviours that look alarming the
first time:

- Rows with zero gain are silently dropped on submit.
- The total splits into `gain_loss_booked` and `gain_loss_unbooked`.

### Step 4 — Create the Journal Entries

After submit, a **Create → Journal Entries** button appears. Click it. It produces up to
two **drafts** — a zero-balance JV and a revaluation JV — and links to both in a message.

### Step 5 — Submit each Journal Entry

Open each draft and submit it. **Only now does the GL change.** The posting looks like:

```
Dr  I & M USD A/C - CA                    2,400.00     (USD 0.00)
    Cr  Unrealized Exchange Gain/Loss - CA          2,400.00
```

Note the **USD 0.00** — no dollars move. The line carries base-currency value with zero
foreign-currency amount, which is exactly how the KES carrying value changes while the
balance stays 450 USD.

### Step 6 — Verify

- General ledger, USD bank: 450 USD now carrying 59,850 KES, implied 133.00.
- `Unrealized Exchange Gain/Loss - CA` shows the 2,400.

### Step 7 — Cross-check against FIFO

Worth building into the routine, because it is the only check that catches a bad rate typed
months ago. Open **Forex FIFO Holdings** and compare:

| | |
|---|---|
| FIFO cost of holdings | 58,950 (450 @131) |
| Revalued balance | 59,850 (450 @133) |
| Difference | 900 = the true holding gain |

If that difference looks implausible against how the rate actually moved, a rate somewhere
in the history is wrong — most likely a decimal slip on a purchase, which silently corrupts
the cost basis of every payment that later consumed that lot.

## The accounts involved

Both already exist and are wired to the Company record. **Never create these as part of
month-end** — if that seems necessary, something is misconfigured and it should go to the
developer first.

| Account | Used for |
|---|---|
| `Exchange Gain/Loss - CA` | Realised differences ERPNext books natively (invoice rate vs payment rate on party accounts) |
| `Unrealized Exchange Gain/Loss - CA` | Month-end revaluation |

Both sit under **Indirect Expenses**, so a *gain* appears as a negative expense rather than
as income. That is ERPNext's default and is fine for reporting, but it looks wrong the
first time someone reads a −2,400 expense line as a cost.

## When things go wrong

| Situation | Fix |
|---|---|
| Rate typed wrong, JEs not yet submitted | Delete the draft JEs, cancel and amend the revaluation |
| Rate wrong, JEs already submitted | Cancel the JEs, then cancel the revaluation (works cleanly, but only if the period is not closed) |
| A Payment Entry gets backdated into a closed month | The revaluation is now stale. The FIFO ledger self-corrects on the next read; **the GL does not.** Someone has to notice — an argument for locking periods once closed |
| The FIFO panel is empty on a submitted entry | Normal if the entry does not touch a tracked USD account |

## Two things to know going forward

**No automatic reversal.** ERPNext does not reverse the revaluation JE next period. The
59,850 becomes the new carrying base, and February measures from there. If the accountant
prefers the reverse-on-day-one convention, that is a manual reversing entry — settle it
before the first month-end rather than after.

**The gap identity changes once a revaluation exists.** After posting, FIFO says 58,950 and
the GL says 59,850, a gap of −900 rather than 1,500. The rule generalises to:

```
gap = cumulative unrecognised realised gain − cumulative revaluation booked
      1,500 − 2,400 = −900
```

So from the second month onward, do **not** read the FIFO-vs-GL difference as "gain the
books are hiding". It is that figure net of everything revaluation has already caught.

---

# Part 4 — For developers

| File | Purpose |
|---|---|
| `crystal_alluminium_works/forex_fifo.py` | The ledger. Pure FIFO core (`consume`, `replay`) with no frappe dependency, then the Payment Entry reader and desk entry points |
| `crystal_alluminium_works/public/js/payment_entry_forex_fifo.js` | Read-only panel on the Payment Entry form |
| `crystal_alluminium_works/exchange_rate_revaluation_handler.py` | Blocks blank rates; recomputes `new_balance_in_base_currency` server-side |
| `crystal_alluminium_works/report/forex_fifo_ledger/` | Movement history report |
| `crystal_alluminium_works/report/forex_fifo_holdings/` | Current lots and cost basis |
| `patches/add_payment_entry_forex_fifo_fields.py` | Creates the panel's custom fields |
| `patches/use_manual_cbk_exchange_rates.py` | Disables rate fetching |
| `patches/setup_unrealized_exchange_account.py` | Creates and wires the unrealised account |

Custom fields on Payment Entry: `custom_forex_fifo_section`, `custom_forex_fifo_html`. Both
are in `fixtures/custom_field.json` — run `bench export-fixtures` and check the diff before
committing changes to them.

**The guard on the revaluation handler is worth understanding before touching it.**
`new_balance_in_base_currency` — the number gain/loss is actually derived from — is
normally calculated in client script when the rate field changes. Anything that does not
run that script (the API, a data import, a browser hiccup) leaves it at 0 while the rate
reads fine, producing a full write-off that passes a rate-only check. The handler
recomputes it server-side so the server is authoritative.

**Known gap: no rate validation on Payment Entry.** Core makes the rate field required so
it cannot be empty, but a typo — 13.15 for 131.50 — passes. Because lots are costed from
`base_received_amount`, a bad rate on a *purchase* corrupts the cost basis of every payment
that later consumes that lot. There is currently no `doc_events` hook for Payment Entry.

**Current state:** everything above is wired, migrated and verified against a simulated
history, but as of this writing the site has **0 submitted Payment Entries and 0 Exchange
Rate Revaluations**. None of it has run on real data.
