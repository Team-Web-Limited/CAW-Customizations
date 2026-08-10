"""Make Exchange Rate Revaluation safe when rates are typed rather than fetched.

CBK rates are entered by hand here -- Currency Exchange Settings is disabled and
there are no Currency Exchange records, so `get_exchange_rate` returns 0 rather
than inventing a rate (see patches/use_manual_cbk_exchange_rates.py). That is
the intended behaviour on entry, but it leaves the New Exchange Rate column
pre-filled with 0, and submitting it that way values the whole foreign currency
position at nil: revaluing the USD accounts would book their entire KES balance
as a loss and show dollars worth nothing on the balance sheet. Month-end is
exactly when nobody looks closely, so this is worth making impossible rather
than merely unlikely.

Two things happen here, and the second matters more than it looks.

`new_balance_in_base_currency` -- the number the gain/loss is actually derived
from -- is calculated in client script when the rate field changes. Anything
that does not run that script (the API, a data import, a browser hiccup) leaves
it at 0 while the rate reads fine, which produces a full write-off that passes
a rate-only check. So the balance is recomputed from the rate server-side and
the totals refreshed, making the server authoritative instead of trusting
whatever the form submitted.

Rows flagged `zero_balance` are left alone: ERPNext sets their rate to 0 on
purpose when squaring off an account holding a balance in one currency but not
the other, so a zero there is a deliberate instruction, not a missing rate.
"""

import frappe
from frappe import _
from frappe.utils import flt


def validate_rates(doc, method=None):
	_require_rates(doc)
	_recompute_from_rates(doc)


def _require_rates(doc):
	missing = [
		row
		for row in doc.get("accounts", [])
		if not row.zero_balance and not flt(row.new_exchange_rate)
	]
	if not missing:
		return

	frappe.throw(
		_(
			"Enter the CBK exchange rate for {0} before submitting. Rates are not fetched "
			"automatically on this site, so a blank New Exchange Rate is read as zero and "
			"would revalue the balance to nothing."
		).format(", ".join(frappe.bold(row.account) for row in missing)),
		title=_("Exchange Rate Missing"),
	)


def _recompute_from_rates(doc):
	"""Derive the revalued balance from the typed rate, then refresh the totals."""
	changed = False

	for row in doc.get("accounts", []):
		if row.zero_balance:
			continue

		expected = flt(
			flt(row.balance_in_account_currency) * flt(row.new_exchange_rate),
			row.precision("new_balance_in_base_currency"),
		)
		if flt(row.new_balance_in_base_currency, row.precision("new_balance_in_base_currency")) != expected:
			row.new_balance_in_base_currency = expected
			changed = True

	if changed:
		# gain_loss and the document totals are derived from the figures just
		# corrected, so they have to be rebuilt from them.
		doc.set_total_gain_loss()
