"""
One-off script: assign random Kenyan mobile numbers to ~3/4 of invoice customers.
Run with:
    bench --site crystal-alluminium-works execute \
        crystal_alluminium_works.assign_mobile_numbers.run
"""

import random
import frappe


def run():
    # ── Fetch ALL invoice customers (those with a tax_id / PIN) ──────────────
    all_invoice_customers = frappe.get_all(
        "Customer",
        filters=[["tax_id", "!=", ""]],
        fields=["name", "mobile_no"],
        order_by="creation asc",
        limit_page_length=0,
    )

    total = len(all_invoice_customers)
    target_count = round(total * 3 / 4)          # 3/4 of total

    print(f"Total invoice customers  : {total}")
    print(f"Will assign phone numbers: {target_count}")

    # Kenyan mobile prefixes (Safaricom, Airtel, Telkom)
    prefixes = [
        "0700", "0701", "0702", "0703", "0704", "0705", "0706", "0707", "0708", "0709",
        "0710", "0711", "0712", "0713", "0714", "0715", "0716", "0717", "0718", "0719",
        "0720", "0721", "0722", "0723", "0724", "0725", "0726", "0727", "0728", "0729",
        "0740", "0741", "0742", "0743", "0745", "0746",
        "0768", "0769", "0757", "0758",
    ]

    def random_kenyan_number():
        prefix = random.choice(prefixes)
        suffix = "".join([str(random.randint(0, 9)) for _ in range(6)])
        return f"{prefix}{suffix}"

    # Shuffle so the selection is random across the list
    shuffled = list(all_invoice_customers)
    random.shuffle(shuffled)
    to_update = shuffled[:target_count]

    updated = 0
    skipped = 0
    for customer in to_update:
        existing = (customer.get("mobile_no") or "").strip()
        if existing:
            # Already has a number — keep it, count as done
            skipped += 1
            print(f"  –  {customer['name'][:55]:<55}  (already has: {existing})")
            continue

        number = random_kenyan_number()
        frappe.db.set_value("Customer", customer["name"], "mobile_no", number)
        updated += 1
        print(f"  ✓  {customer['name'][:55]:<55}  →  {number}")

    frappe.db.commit()
    print(f"\nDone. Updated: {updated}  |  Already had number (skipped): {skipped}")
