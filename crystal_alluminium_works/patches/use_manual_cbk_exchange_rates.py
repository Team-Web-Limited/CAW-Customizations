"""Stop fetching exchange rates automatically; CBK rates are entered by hand.

The books need the Central Bank of Kenya mean rate, which has no public feed
ERPNext can call. Currency Exchange Settings previously pointed at
api.frankfurter.dev, which quietly supplied a *different* market rate as the
default on every Payment Entry -- close enough to look right, wrong enough to
misstate the USD position.

With fetching disabled and no Currency Exchange records,
`erpnext.setup.utils.get_exchange_rate` returns 0, so a rate is never invented:
whoever enters the document has to type the CBK rate. That is the intended
behaviour, not a gap.

Deliberately no Currency Exchange records are created. Accounts Settings has
allow_stale = 1, which makes get_exchange_rate match on `date <= transaction_date`
with no lower bound -- a single record would silently become the rate for every
later date and never be reconsulted. Month-end Exchange Rate Revaluation takes
the CBK rate the same way, by typing it into the editable New Exchange Rate
column.
"""

import frappe


def execute():
	if not frappe.db.exists("Currency Exchange Settings", "Currency Exchange Settings"):
		return

	frappe.db.set_single_value("Currency Exchange Settings", "disabled", 1)
	frappe.clear_cache()
