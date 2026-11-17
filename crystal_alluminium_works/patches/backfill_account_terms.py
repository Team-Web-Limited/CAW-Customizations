import frappe

from crystal_alluminium_works.credit_control import (
    LEGACY_INVOICE_CUSTOMER_TERM,
    PAYMENT_MUST_CLEAR,
    STATUS_ACTIVE,
)


def execute():
    """Give every existing account a term without changing how it trades today.

    Invoice Customers were releasing on credit with no limit, so they go On account 30 days with
    the limit left blank (= not set, nothing checked against it) until Accounts sets each one; new
    invoice customers start on Payment must clear (CAW Credit Settings). Cash customers are always
    Payment must clear. Open job cards keep the term their customer has now. Only blanks are
    filled, so a rerun never undoes what Accounts has set."""
    frappe.db.sql(
        """
        UPDATE `tabCustomer`
        SET custom_account_term = CASE
            WHEN custom_customer_billing_type = 'Invoice Customer' THEN %(invoice_term)s
            ELSE %(cash_term)s
        END
        WHERE IFNULL(custom_account_term, '') = ''
        """,
        {"invoice_term": LEGACY_INVOICE_CUSTOMER_TERM, "cash_term": PAYMENT_MUST_CLEAR},
    )
    frappe.db.sql(
        "UPDATE `tabCustomer` SET custom_account_status = %s WHERE IFNULL(custom_account_status, '') = ''",
        STATUS_ACTIVE,
    )
    frappe.db.sql(
        """
        UPDATE `tabCAW Job Card` jc
        JOIN `tabCustomer` c ON c.name = jc.customer
        SET jc.account_term = CASE
            WHEN jc.payment_mode = 'Cash Customer' THEN %(cash_term)s
            ELSE c.custom_account_term
        END
        WHERE IFNULL(jc.account_term, '') = ''
        """,
        {"cash_term": PAYMENT_MUST_CLEAR},
    )
    # Contacts that existed before the Active flag are active.
    frappe.db.sql("UPDATE `tabContact` SET custom_contact_active = 1 WHERE custom_contact_active IS NULL")

    settings = frappe.get_single("CAW Credit Settings")
    if not settings.new_invoice_customer_term:
        settings.new_invoice_customer_term = PAYMENT_MUST_CLEAR
        settings.save(ignore_permissions=True)
