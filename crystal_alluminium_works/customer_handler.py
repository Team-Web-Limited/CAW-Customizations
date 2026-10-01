import frappe


def normalize_kra_pin(value):
    """KRA PINs compared case- and space-insensitively ("p000603526m " == "P000603526M")."""
    return "".join((value or "").split()).upper()


def normalize_phone(value):
    """Phone numbers compared on their digits only ("0712 345-678" == "0712345678")."""
    return "".join(ch for ch in (value or "") if ch.isdigit())


def assert_unique_customer_phone(phone, exclude=None):
    """One Customer per mobile number — the same reason as the PIN rule below: a second record
    for the same person splits their quotations, payments and balances."""
    phone = normalize_phone(phone)
    if not phone:
        return
    existing = frappe.db.sql(
        """
        SELECT name
        FROM `tabCustomer`
        WHERE REPLACE(REPLACE(REPLACE(IFNULL(mobile_no, ''), ' ', ''), '-', ''), '+', '') = %(phone)s
          AND name != %(name)s
        LIMIT 1
        """,
        {"phone": phone, "name": exclude or ""},
    )
    if existing:
        frappe.throw(
            f"Mobile number {frappe.bold(phone)} is already used by customer "
            f"{frappe.utils.get_link_to_form('Customer', existing[0][0])}.",
            title="Duplicate Mobile Number",
        )


def validate(doc, method):
    """One Customer per KRA PIN, and per mobile number (see assert_unique_customer_phone).

    Customers were being registered again under a slightly different name ("- 1", or "LIMITED"
    for an imported "LTD"), splitting their quotations, invoices and balances across two records.
    Same names are allowed; a KRA PIN already on another Customer is not. Checked only when a
    Customer is created or its PIN changes, so the pairs that already share a PIN stay editable.
    """
    before = doc.get_doc_before_save()
    # Like the PIN, only checked when the number is new or changed, so existing pairs stay editable.
    if normalize_phone(doc.mobile_no) and (not before or normalize_phone(before.mobile_no) != normalize_phone(doc.mobile_no)):
        assert_unique_customer_phone(doc.mobile_no, exclude=doc.name)

    pin = normalize_kra_pin(doc.tax_id)
    if not pin:
        return
    doc.tax_id = pin

    # Compared normalised, so tidying a stored "p000603526m " doesn't count as a new PIN.
    if before and normalize_kra_pin(before.tax_id) == pin:
        return

    existing = frappe.db.sql(
        """
        SELECT name
        FROM `tabCustomer`
        WHERE UPPER(REPLACE(REPLACE(REPLACE(TRIM(IFNULL(tax_id, '')), ' ', ''), '\t', ''), '\n', '')) = %(pin)s
          AND name != %(name)s
        LIMIT 1
        """,
        {"pin": pin, "name": doc.name or ""},
    )
    if existing:
        frappe.throw(
            f"KRA PIN {frappe.bold(pin)} is already used by customer "
            f"{frappe.utils.get_link_to_form('Customer', existing[0][0])}. "
            "Use that customer instead of registering it again.",
            title="Duplicate KRA PIN",
        )
