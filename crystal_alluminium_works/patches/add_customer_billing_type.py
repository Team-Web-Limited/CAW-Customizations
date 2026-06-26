import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

from crystal_alluminium_works.create_custom_fields import CUSTOMER_BILLING_TYPE_OPTIONS


def execute():
    field_existed = bool(
        frappe.db.exists(
            "Custom Field",
            {"dt": "Customer", "fieldname": "custom_customer_billing_type"},
        )
    )

    create_custom_fields(
        {
            "Customer": [
                {
                    "fieldname": "custom_customer_billing_type",
                    "label": "Customer Billing Type",
                    "fieldtype": "Select",
                    "options": CUSTOMER_BILLING_TYPE_OPTIONS,
                    "default": "Cash Customer",
                    "insert_after": "customer_type",
                    "reqd": 1,
                    "in_standard_filter": 1,
                    "module": "Crystal Alluminium Works",
                }
            ]
        },
        update=True,
    )

    # Adding a Select with a default may prefill every existing row with the
    # default before this patch reaches the backfill. Detect that initial state
    # so legacy PIN-bearing customers still become Invoice Customers. Once the
    # data contains explicit classifications, reruns only repair blank values.
    invoice_count = frappe.db.count(
        "Customer", {"custom_customer_billing_type": "Invoice Customer"}
    )
    pin_count = frappe.db.sql(
        "SELECT COUNT(*) FROM `tabCustomer` WHERE IFNULL(TRIM(tax_id), '') != ''"
    )[0][0]
    should_backfill_all = not field_existed or (pin_count and not invoice_count)
    where_clause = "" if should_backfill_all else "WHERE IFNULL(TRIM(custom_customer_billing_type), '') = ''"

    frappe.db.sql(
        f"""
        UPDATE `tabCustomer`
        SET custom_customer_billing_type = CASE
            WHEN IFNULL(TRIM(tax_id), '') != '' THEN 'Invoice Customer'
            ELSE 'Cash Customer'
        END
        {where_clause}
        """
    )
    frappe.clear_cache(doctype="Customer")
