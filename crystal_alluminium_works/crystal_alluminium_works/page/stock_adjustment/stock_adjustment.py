import json

import frappe
from frappe.utils import flt, getdate, nowdate

# These are stock Items under "Glass" (so plain job-costing services could be
# priced/consumed like any other item) but aren't physical stock a warehouse
# count would ever touch — same exclusion manage_items.py applies to the Glass
# catalog view.
GLASS_SERVICE_ITEM_KEYWORDS = ("Polishing", "Drilling", "Sandblasting", "Hole", "Notching", "Notch")


@frappe.whitelist()
def get_items_for_adjustment(item_group, warehouse):
	fields = ["name as item_code", "item_name as description", "stock_uom"]
	if item_group == "Glass":
		fields.append("custom_glass_type")

	items = frappe.get_all(
		"Item",
		filters={"item_group": item_group, "disabled": 0, "is_stock_item": 1},
		fields=fields,
		order_by="name asc"
	)

	if item_group == "Glass":
		items = [
			i for i in items
			if not any(k in (i.description or "") for k in GLASS_SERVICE_ITEM_KEYWORDS)
		]

	if not items:
		return []

	item_codes = [d.item_code for d in items]
	bins = frappe.get_all(
		"Bin",
		filters={"item_code": ["in", item_codes], "warehouse": warehouse},
		fields=["item_code", "actual_qty"]
	)
	bin_map = {d.item_code: d.actual_qty for d in bins}

	if item_group == "Glass":
		from crystal_alluminium_works.api import get_glass_stock_ledger

	for item in items:
		item.current_qty = flt(bin_map.get(item.item_code, 0.0), 4)
		if item_group == "Glass":
			glass_data = get_glass_stock_ledger(item.item_code, warehouse)
			item.sheet_balance = glass_data.get("final_sheet_balance", {})

	if item_group == "Glass":
		# Laminated glass is repacked from Ordinary sheets rather than stocked by
		# sheet size directly, so get_glass_stock_ledger never tracks a sheet
		# balance for it (see the is_laminated check there) — it always shows
		# Current Sheets = 0 here. Hide it from this page for now; it'll start
		# reflecting real numbers once the repack process posts its own stock
		# moves. Only hidden while it has no sheets on record, so a Laminated
		# item that does pick up a balance some other way still surfaces here.
		items = [
			i for i in items
			if not (
				i.custom_glass_type == "Laminated"
				and sum((i.sheet_balance or {}).values()) == 0
			)
		]

	return items

@frappe.whitelist(methods=["GET"])
def download_adjustment_sheet(item_group, warehouse):
	"""Excel count sheet of the items this page lists for a warehouse and item group: current
	stock plus a blank Counted Qty column to fill in. Glass also gets its per-size sheet counts."""
	from crystal_alluminium_works.api import _stream_xlsx_file

	is_glass = item_group == "Glass"
	header = ["Item", "Description", "Current Qty"]
	if is_glass:
		header += ["Current Sheets", "Sheet Sizes"]
	header += ["Counted Qty", "U/M"]

	rows = [header]
	for item in get_items_for_adjustment(item_group, warehouse):
		line = [item.item_code, item.description or "", flt(item.current_qty, 4)]
		if is_glass:
			balance = item.get("sheet_balance") or {}
			line += [
				flt(sum(balance.values()), 2),
				"; ".join(f"{size}: {flt(pcs, 2):g}" for size, pcs in balance.items()),
			]
		line += ["", item.stock_uom]
		rows.append(line)

	return _stream_xlsx_file(f"Stock_Adjustment_{item_group}_{warehouse}", rows)


@frappe.whitelist()
def submit_stock_reconciliation(payload):
	data = frappe.parse_json(payload)
	warehouse = data.get("warehouse")
	item_group = data.get("item_group")
	items = data.get("items", [])
	posting_date = _clean_posting_date(data.get("posting_date"))
	# Optional override for the Stock Reconciliation difference account. The page does
	# not send it yet; blank means the company's Stock Adjustment account, as before.
	difference_account = data.get("difference_account") or None

	if not warehouse:
		frappe.throw("Warehouse is required.")

	if not items:
		frappe.throw("No items to adjust.")

	if item_group == "Glass":
		# Toughened Glass is cut to order, not sold from a fixed sheet catalog, so it
		# carries no sheet-count ledger to desync (see block_glass_stock_reconciliation) —
		# it's adjusted by qty just like a non-glass item. Everything else in the group
		# still needs the sheet-size-aware path.
		toughened_codes = set(frappe.get_all(
			"Item",
			filters={"name": ["in", [row.get("item_code") for row in items]], "custom_glass_type": "Toughened"},
			pluck="name",
		))
		qty_items = [row for row in items if row.get("item_code") in toughened_codes]
		sheet_items = [row for row in items if row.get("item_code") not in toughened_codes]

		entry_names = []
		if qty_items:
			entry_names.append(_submit_plain_reconciliation(warehouse, qty_items, posting_date, difference_account))
		if sheet_items:
			entry_names.append(_submit_glass_sheet_adjustment(warehouse, sheet_items, posting_date))
		return ", ".join(entry_names)

	return _submit_plain_reconciliation(warehouse, items, posting_date, difference_account)


def _clean_posting_date(value):
	"""Blank means "now" (returns None). A past date is posted at 23:59:59 so it lands
	after that day's other movements, like the 30 Sep opening entries. Future dates are refused."""
	if not value:
		return None
	date = getdate(value)
	if date > getdate(nowdate()):
		frappe.throw("Posting Date cannot be in the future.")
	return None if date == getdate(nowdate()) else date


def _apply_posting_date(doc, posting_date):
	if posting_date:
		doc.set_posting_time = 1
		doc.posting_date = posting_date
		doc.posting_time = "23:59:59"


def _submit_plain_reconciliation(warehouse, items, posting_date=None, difference_account=None):
	sr = frappe.new_doc("Stock Reconciliation")
	sr.purpose = "Stock Reconciliation"
	sr.set_posting_time = 1
	_apply_posting_date(sr, posting_date)
	if difference_account:
		sr.expense_account = difference_account

	for row in items:
		sr.append("items", {
			"item_code": row.get("item_code"),
			"warehouse": warehouse,
			"qty": flt(row.get("new_qty"))
		})

	sr.insert()
	sr.submit()

	return sr.name


def _submit_glass_sheet_adjustment(warehouse, items, posting_date=None):
	"""Glass can't go through Stock Reconciliation: crystal_alluminium_works.api.
	get_glass_stock_ledger reconstructs the per-size sheet balance only from
	Purchase Receipt and Stock Entry rows, so a Stock Reconciliation moves the
	SFT (Bin.actual_qty) balance while leaving the derived sheet counts frozen —
	exactly the bug this works around.

	Instead this posts the same kind of corrective Stock Entry the invoice-edit
	flow already uses (see crystal_alluminium_works.api._apply_invoice_edit_stock_deltas):
	a Material Issue for sizes whose counted pcs came out lower than recorded, a
	Material Receipt for sizes that came out higher, each item row tagged with
	the "Sheets Consumed:"/"Sheets Returned:" JSON description that
	get_glass_stock_ledger already knows how to parse.

	`items` is [{item_code, sheet_targets: {size: new_pcs}}, ...]. The current
	pcs per size is re-read here from get_glass_stock_ledger rather than trusted
	from the client, so a stale page (someone else adjusted stock in between)
	can't silently post the wrong delta.
	"""
	from crystal_alluminium_works.api import get_glass_sheet_configs, get_glass_stock_ledger

	sheet_map = {c.size: flt(c.sft) for c in get_glass_sheet_configs()}
	company = frappe.db.get_value("Warehouse", warehouse, "company")
	if not company:
		frappe.throw(f"Warehouse {warehouse} has no Company set.")

	issue_rows = []
	receipt_rows = []

	for row in items:
		item_code = row.get("item_code")
		targets = row.get("sheet_targets") or {}
		if not targets:
			continue

		current = get_glass_stock_ledger(item_code, warehouse).get("final_sheet_balance", {})

		consumed = []
		returned = []
		for size, new_pcs in targets.items():
			sft = flt(sheet_map.get(size))
			if sft <= 0:
				frappe.throw(f"Unknown sheet size '{size}' for {item_code}.")
			diff = flt(new_pcs) - flt(current.get(size, 0))
			if abs(diff) <= 0.0001:
				continue
			if diff < 0:
				consumed.append({"size": size, "pcs": -diff})
			else:
				returned.append({"size": size, "pcs": diff})

		if consumed:
			issue_rows.append({
				"item_code": item_code,
				"qty": sum(flt(c["pcs"]) * flt(sheet_map.get(c["size"], 0)) for c in consumed),
				"description": f"Sheets Consumed: {json.dumps(consumed)}",
			})

		if returned:
			receipt_rows.append({
				"item_code": item_code,
				"qty": sum(flt(r["pcs"]) * flt(sheet_map.get(r["size"], 0)) for r in returned),
				"description": f"Sheets Returned: {json.dumps(returned)}",
			})

	if not issue_rows and not receipt_rows:
		frappe.throw("No sheet counts were changed. Please update at least one size.")

	entry_names = []
	if issue_rows:
		entry_names.append(_create_glass_adjustment_entry("Material Issue", issue_rows, company, warehouse, posting_date))
	if receipt_rows:
		entry_names.append(_create_glass_adjustment_entry("Material Receipt", receipt_rows, company, warehouse, posting_date))

	return ", ".join(entry_names)


def _create_glass_adjustment_entry(entry_type, rows, company, warehouse, posting_date=None):
	entry = frappe.new_doc("Stock Entry")
	entry.stock_entry_type = entry_type
	entry.company = company
	entry.remarks = "Stock Adjustment: glass sheet count correction"
	_apply_posting_date(entry, posting_date)
	for r in rows:
		item_dict = {
			"item_code": r["item_code"],
			"qty": round(flt(r["qty"]), 4),
			"description": r["description"],
		}
		if entry_type == "Material Issue":
			item_dict["s_warehouse"] = warehouse
		else:
			item_dict["t_warehouse"] = warehouse
		entry.append("items", item_dict)
	entry.flags.ignore_permissions = True
	entry.insert()
	entry.submit()
	return entry.name
