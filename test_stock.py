import frappe
def main():
    entry = frappe.get_doc('Stock Entry', 'MAT-STE-2026-00011')
    for item in entry.items:
        print(f"{item.item_code} | qty: {item.qty} | s_warehouse: {item.s_warehouse} | desc: {item.description}")
