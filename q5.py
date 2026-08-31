ss = frappe.get_single("System Settings")
for f in ("currency_precision","float_precision","number_format","rounded_total_precision","country","language","time_zone"):
    print("SS", f, "=", repr(ss.get(f)))
print("--- default currency:", frappe.db.get_default("currency"))
for c in frappe.get_all("Company", fields=["name","default_currency","country"]):
    print("Company:", c)
