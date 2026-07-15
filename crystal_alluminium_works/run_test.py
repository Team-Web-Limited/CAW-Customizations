import frappe
from crystal_alluminium_works.api import get_glass_stock_ledger

def main():
    res = get_glass_stock_ledger("4mmcg", "Stores - CA")
    print(f"Ledger len: {len(res['ledger'])}")
    for entry in res["ledger"]:
        if entry.voucher_no == 'MAT-STE-2026-00018':
            print(f"Found MAT-STE-2026-00018")
            print(f"sheets_out: {entry.get('sheets_out')}")
            print(f"sheet_balance: {entry.get('sheet_balance')}")
