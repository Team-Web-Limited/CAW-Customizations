import frappe
from frappe.utils import flt

@frappe.whitelist()
def get_items_for_adjustment(item_group, warehouse):
	items = frappe.get_all(
		"Item",
		filters={"item_group": item_group, "disabled": 0, "is_stock_item": 1},
		fields=["name as item_code", "item_name as description", "stock_uom"],
		order_by="name asc"
	)

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

	return items

@frappe.whitelist()
def submit_stock_reconciliation(payload):
	data = frappe.parse_json(payload)
	warehouse = data.get("warehouse")
	items = data.get("items", [])
	
	if not warehouse:
		frappe.throw("Warehouse is required.")

	if not items:
		frappe.throw("No items to adjust.")

	sr = frappe.new_doc("Stock Reconciliation")
	sr.purpose = "Stock Reconciliation"
	sr.set_posting_time = 1
	
	for row in items:
		sr.append("items", {
			"item_code": row.get("item_code"),
			"warehouse": warehouse,
			"qty": flt(row.get("new_qty"))
		})
		
	sr.insert()
	sr.submit()
	
	return sr.name
