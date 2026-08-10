"""Give unrealised exchange differences their own account, and point the company at it.

Exchange Rate Revaluation refuses to run without
Company.unrealized_exchange_gain_loss_account, so month-end translation of the
USD bank accounts is blocked until this exists.

Realised and unrealised differences are kept in separate accounts deliberately.
Realised amounts are settled cash outcomes -- dollars actually spent or sold at
a rate different from what they cost. Unrealised amounts are a translation of
currency still sitting in the bank, and reverse out as soon as the next
revaluation runs. Sharing one account merges a real trading result with a
reporting adjustment and makes it impossible to see how the business actually
did on foreign currency.

Both sit under Indirect Expenses alongside ERPNext's standard Exchange
Gain/Loss, following its convention that a gain appears as a credit to (that
is, a negative) expense.
"""

import frappe

ACCOUNT_NAME = "Unrealized Exchange Gain/Loss"
PARENT = "Indirect Expenses"


def execute():
	for company in frappe.get_all("Company", pluck="name"):
		account = _ensure_account(company)
		if not account:
			continue

		if not frappe.db.get_value("Company", company, "unrealized_exchange_gain_loss_account"):
			frappe.db.set_value("Company", company, "unrealized_exchange_gain_loss_account", account)


def _ensure_account(company):
	abbr = frappe.get_cached_value("Company", company, "abbr")
	name = f"{ACCOUNT_NAME} - {abbr}"
	if frappe.db.exists("Account", name):
		return name

	parent = f"{PARENT} - {abbr}"
	if not frappe.db.exists("Account", parent):
		# Chart of accounts differs per company; skip rather than guess at a home
		# for the account.
		return None

	account = frappe.new_doc("Account")
	account.update(
		{
			"account_name": ACCOUNT_NAME,
			"parent_account": parent,
			"company": company,
			"root_type": "Expense",
			"report_type": "Profit and Loss",
			"account_currency": frappe.get_cached_value("Company", company, "default_currency"),
			"is_group": 0,
		}
	)
	account.insert(ignore_permissions=True)
	return account.name
