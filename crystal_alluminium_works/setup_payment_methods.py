import frappe

# ERPNext ships several default Modes of Payment this business never uses for customer
# receipts. Leaving them enabled only adds noise to the selectors and risks the job-card
# mode-of-payment fallback picking the wrong one.
UNUSED_MODES_OF_PAYMENT = ["Bank Draft", "Credit Card", "Wire Transfer"]

# The bank-type Mode of Payment whose deposit account doubles as the company default bank.
DEFAULT_BANK_SOURCE_MODE = "Bank Transfer i.e RTGS, TT"


def _ensure_mode_of_payment_account(mode_of_payment, company, account):
    if frappe.db.exists("Mode of Payment Account", {"parent": mode_of_payment, "company": company}):
        return
    mop = frappe.get_doc("Mode of Payment", mode_of_payment)
    mop.append("accounts", {"company": company, "default_account": account})
    mop.save(ignore_permissions=True)


def run_setup():
    company = (
        frappe.defaults.get_global_default("company")
        or frappe.db.get_single_value("Global Defaults", "default_company")
        or frappe.db.get_value("Company", {}, "name")
    )
    if not company:
        return

    # 1. The "Cash" Mode of Payment had no deposit account configured — point it at the
    #    company's default cash account so receipts have a home instead of relying on a fallback.
    cash_account = frappe.db.get_value("Company", company, "default_cash_account")
    if cash_account and frappe.db.exists("Mode of Payment", "Cash"):
        _ensure_mode_of_payment_account("Cash", company, cash_account)

    # 2. Set the company default bank account (was empty) to match the bank-transfer method's
    #    account — some ERPNext flows fall back to it.
    if not frappe.db.get_value("Company", company, "default_bank_account"):
        bank_account = frappe.db.get_value(
            "Mode of Payment Account",
            {"parent": DEFAULT_BANK_SOURCE_MODE, "company": company},
            "default_account",
        )
        if bank_account:
            frappe.db.set_value("Company", company, "default_bank_account", bank_account)

    # 3. Disable the unused ERPNext default Modes of Payment.
    for mode_of_payment in UNUSED_MODES_OF_PAYMENT:
        if frappe.db.exists("Mode of Payment", mode_of_payment) and frappe.db.get_value(
            "Mode of Payment", mode_of_payment, "enabled"
        ):
            frappe.db.set_value("Mode of Payment", mode_of_payment, "enabled", 0)

    frappe.db.commit()


if __name__ == "__main__":
    run_setup()
