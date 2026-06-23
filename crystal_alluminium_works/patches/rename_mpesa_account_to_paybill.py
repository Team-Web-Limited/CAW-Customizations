"""Rename the Mpesa cash ledger to Paybill and backfill Account links."""

import frappe
from erpnext.accounts.doctype.account.account import update_account_number


OLD_ACCOUNT = "Mpesa - CA"
NEW_ACCOUNT = "Paybill - CA"
NEW_ACCOUNT_NAME = "Paybill"


def execute():
	if frappe.db.exists("Account", OLD_ACCOUNT):
		if frappe.db.exists("Account", NEW_ACCOUNT):
			frappe.throw(
				f"Cannot rename {OLD_ACCOUNT}: the target account {NEW_ACCOUNT} already exists."
			)

		account_number = frappe.db.get_value("Account", OLD_ACCOUNT, "account_number")
		renamed_account = update_account_number(
			OLD_ACCOUNT,
			NEW_ACCOUNT_NAME,
			account_number=account_number,
		)
		if renamed_account and renamed_account != NEW_ACCOUNT:
			frappe.throw(
				f"Expected the renamed account to be {NEW_ACCOUNT}, got {renamed_account}."
			)

	if not frappe.db.exists("Account", NEW_ACCOUNT):
		frappe.throw(f"Account {NEW_ACCOUNT} was not found after the rename.")

	_backfill_account_links()


def _backfill_account_links():
	"""Repair exact legacy values left in Account Link fields on old records.

	Frappe's rename operation normally updates these links.  The explicit pass
	also covers legacy/custom records whose metadata was unavailable when an
	earlier rename was attempted, and makes the migration safe to rerun.
	"""
	link_fields = {
		(row.parent, row.fieldname)
		for row in frappe.get_all(
			"DocField",
			filters={"fieldtype": "Link", "options": "Account"},
			fields=["parent", "fieldname"],
		)
	}
	link_fields.update(
		(row.dt, row.fieldname)
		for row in frappe.get_all(
			"Custom Field",
			filters={"fieldtype": "Link", "options": "Account"},
			fields=["dt", "fieldname"],
		)
	)

	for doctype, fieldname in link_fields:
		if not frappe.db.table_exists(doctype) or not frappe.db.has_column(doctype, fieldname):
			continue
		frappe.db.sql(
			f"update `tab{doctype}` set `{fieldname}`=%s where `{fieldname}`=%s",
			(NEW_ACCOUNT, OLD_ACCOUNT),
		)

