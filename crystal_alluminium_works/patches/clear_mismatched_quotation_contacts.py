import frappe

from crystal_alluminium_works.api import CLEARED_PARTY_CONTACT


def execute():
    """Draft quotations whose Contact Person belongs to another customer (left behind when the
    Builder switched the customer) cannot be submitted. Clear it, keeping the person's name and
    phone in the quotation's own contact fields when those are empty."""
    rows = frappe.db.sql(
        """select q.name, q.contact_person, q.custom_contact_name, q.custom_contact_phone
        from `tabQuotation` q
        where q.docstatus = 0 and q.quotation_to = 'Customer' and ifnull(q.contact_person, '') != ''
            and not exists (select 1 from `tabDynamic Link` d where d.parenttype = 'Contact'
                and d.parent = q.contact_person and d.link_doctype = 'Customer' and d.link_name = q.party_name)""",
        as_dict=True,
    )
    for row in rows:
        contact = frappe.db.get_value("Contact", row.contact_person, ["first_name", "last_name", "mobile_no"], as_dict=True) or {}
        values = dict(CLEARED_PARTY_CONTACT)
        if not row.custom_contact_name:
            values["custom_contact_name"] = " ".join(filter(None, [contact.get("first_name"), contact.get("last_name")])) or None
        if not row.custom_contact_phone:
            values["custom_contact_phone"] = contact.get("mobile_no") or None
        frappe.db.set_value("Quotation", row.name, values, update_modified=False)
