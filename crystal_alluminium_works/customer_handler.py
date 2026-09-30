import frappe


def normalize_kra_pin(value):
    """KRA PINs compared case- and space-insensitively ("p000603526m " == "P000603526M")."""
    return "".join((value or "").split()).upper()


def validate(doc, method):
    """One Customer per KRA PIN.

    Customers were being registered again under a slightly different name ("- 1", or "LIMITED"
    for an imported "LTD"), splitting their quotations, invoices and balances across two records.
    Same names are allowed; a KRA PIN already on another Customer is not. Checked only when a
    Customer is created or its PIN changes, so the pairs that already share a PIN stay editable.
    """
    pin = normalize_kra_pin(doc.tax_id)
    if not pin:
        return
    doc.tax_id = pin

    # Compared normalised, so tidying a stored "p000603526m " doesn't count as a new PIN.
    before = doc.get_doc_before_save()
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
