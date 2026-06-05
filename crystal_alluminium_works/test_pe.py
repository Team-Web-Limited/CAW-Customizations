import frappe

def test():
    customer = frappe.get_all("Customer", limit=1)[0].name
    mop = frappe.get_all("Mode of Payment", limit=1)[0].name
    company = frappe.db.get_single_value("Global Defaults", "default_company") or frappe.get_all("Company", limit=1)[0].name
    deposit_accounts = frappe.get_all("Account", filters={"account_type": ["in", ["Bank", "Cash"]], "is_group": 0, "company": company}, limit=1)
    deposit_to = deposit_accounts[0].name
    
    # Call the api function directly
    from crystal_alluminium_works.api import record_customer_payment
    
    name = record_customer_payment(
        customer=customer,
        amount=250.50,
        date=frappe.utils.today(),
        payment_method=mop,
        deposit_to=deposit_to,
        reference="REF-API-TEST"
    )
    
    print("SUCCESSFULLY RECORDED PAYMENT DOCNAME:", name)
    
    # Retrieve it to check values
    doc = frappe.get_doc("Payments", name)
    print("RETRIEVED VALUES:")
    print("Customer:", doc.customer)
    print("Amount:", doc.amount)
    print("Date:", doc.date)
    print("Payment Method:", doc.payment_method)
    print("Deposit To:", doc.deposit_to)
    print("Reference:", doc.reference)
    
    # Delete it to clean up
    frappe.delete_doc("Payments", name)
    print("CLEANED UP PAYMENTS TEST RECORD")
