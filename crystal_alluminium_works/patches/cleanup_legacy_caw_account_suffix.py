"""Repair dangling "- CAW" Account/Cost Center/Warehouse references.

The company abbreviation was changed from CAW to CA at some point, but a
number of Company default-account fields, Cost Centers, Warehouses, and
already-posted transactions (GL Entry, Payment Ledger Entry, tax templates,
etc.) were left pointing at the old "- CAW" names, which no longer exist as
Accounts. This breaks Sales Invoice creation (and anything else that
resolves accounts from company defaults) with a "Could not find Debit To /
Income Account / Expense Account" error.

This patch is idempotent: every step checks whether work is still needed
and whether the "- CA" target already exists before touching anything, so
it is safe to run again (e.g. on a site that was already fixed by hand).
"""

import frappe

OLD_SUFFIX = " - CAW"
NEW_SUFFIX = " - CA"


def execute():
	_rename_cost_centers()
	_rename_warehouses()
	_fix_company_account_fields()
	_fix_dangling_account_references()


def _rename_cost_centers():
	# Leaf cost centers before their parent group, so the tree stays valid mid-rename.
	for old in frappe.get_all(
		"Cost Center", filters={"name": ["like", f"%{OLD_SUFFIX}"]}, pluck="name", order_by="is_group asc"
	):
		new = old[: -len(OLD_SUFFIX)] + NEW_SUFFIX
		if frappe.db.exists("Cost Center", new):
			continue
		frappe.rename_doc("Cost Center", old, new, force=True)
		frappe.db.commit()


def _rename_warehouses():
	for old in frappe.get_all(
		"Warehouse", filters={"name": ["like", f"%{OLD_SUFFIX}"]}, pluck="name", order_by="is_group asc"
	):
		new = old[: -len(OLD_SUFFIX)] + NEW_SUFFIX
		if frappe.db.exists("Warehouse", new):
			continue
		frappe.rename_doc("Warehouse", old, new, force=True)
		frappe.db.commit()


def _fix_company_account_fields():
	account_fields = [
		df.fieldname
		for df in frappe.get_meta("Company").get("fields", {"fieldtype": "Link", "options": "Account"})
	]

	for company in frappe.get_all("Company", pluck="name"):
		for fieldname in account_fields:
			current = frappe.db.get_value("Company", company, fieldname)
			if not current or not current.endswith(OLD_SUFFIX):
				continue
			target = current[: -len(OLD_SUFFIX)] + NEW_SUFFIX
			if frappe.db.exists("Account", target):
				frappe.db.set_value("Company", company, fieldname, target, update_modified=False)

	frappe.db.commit()


def _fix_dangling_account_references():
	"""Repoint any remaining Link(Account) column from a missing "- CAW" account
	to its existing "- CA" equivalent, across every doctype (including
	already-posted ledger/transaction rows)."""

	columns = []
	for d in frappe.get_all(
		"DocField", filters={"fieldtype": "Link", "options": "Account"}, fields=["parent", "fieldname"]
	):
		columns.append((d.parent, d.fieldname))
	for d in frappe.get_all(
		"Custom Field", filters={"fieldtype": "Link", "options": "Account"}, fields=["dt", "fieldname"]
	):
		columns.append((d.dt, d.fieldname))

	present = []
	caw_values = set()
	for doctype, fieldname in columns:
		try:
			if not frappe.db.has_column(doctype, fieldname):
				continue
			rows = frappe.db.sql(
				f"select distinct `{fieldname}` from `tab{doctype}` where `{fieldname}` like %s",
				(f"%{OLD_SUFFIX}",),
			)
		except Exception:
			continue
		if rows:
			present.append((doctype, fieldname))
			caw_values.update(v for (v,) in rows)

	mapping = {}
	missing = []
	for value in caw_values:
		target = value[: -len(OLD_SUFFIX)] + NEW_SUFFIX
		if frappe.db.exists("Account", target):
			mapping[value] = target
		else:
			missing.append((value, target))

	if missing:
		details = "; ".join(f"{v} -> {t} (target not found)" for v, t in missing)
		frappe.log_error(
			title="cleanup_legacy_caw_account_suffix: skipped values with no CA target",
			message=details,
		)

	for doctype, fieldname in present:
		for old_value, new_value in mapping.items():
			frappe.db.sql(
				f"update `tab{doctype}` set `{fieldname}`=%s where `{fieldname}`=%s",
				(new_value, old_value),
			)

	frappe.db.commit()
