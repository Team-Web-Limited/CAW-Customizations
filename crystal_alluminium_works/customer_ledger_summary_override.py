"""Adds a Customer Billing Type filter to ERPNext's Customer Ledger Summary report.

The report builds its party list in PartyLedgerSummaryReport.get_party_conditions and
every later step (GL entries, returns, adjustments) is scoped to that list, so one extra
condition there is enough. A standard report can't be extended through hooks, so the
method is patched in place - apply() runs from before_request / before_job and is
idempotent. The filter itself is added on the client by customer_ledger_summary_filter.js.

The class is shared with Supplier Ledger Summary, so the condition only applies to Customer.
"""

from erpnext.accounts.report.customer_ledger_summary.customer_ledger_summary import (
	PartyLedgerSummaryReport,
)


def apply(*args, **kwargs):
	if getattr(PartyLedgerSummaryReport.get_party_conditions, "_caw_patched", False):
		return

	original = PartyLedgerSummaryReport.get_party_conditions

	def get_party_conditions(self, doctype):
		conditions = original(self, doctype)
		billing_type = self.filters.get("customer_billing_type")
		if billing_type and self.filters.party_type == "Customer":
			conditions.append(doctype.custom_customer_billing_type == billing_type)
		return conditions

	get_party_conditions._caw_patched = True
	PartyLedgerSummaryReport.get_party_conditions = get_party_conditions
