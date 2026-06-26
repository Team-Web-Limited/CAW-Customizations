import frappe
from frappe.tests.utils import FrappeTestCase

from crystal_alluminium_works import api


def _ensure_customer(name="Amend Test Customer"):
    if not frappe.db.exists("Customer", name):
        frappe.get_doc({
            "doctype": "Customer",
            "customer_name": name,
            "customer_group": frappe.db.get_value("Customer Group", {"is_group": 0}, "name") or "All Customer Groups",
            "territory": "All Territories",
            "customer_type": "Company",
        }).insert(ignore_permissions=True)
    return name


def _make_submitted_quotation(customer, qty=4):
    """A minimal aluminium-only quotation (no glass/ceiling auto-rows to reason about)."""
    quo = frappe.get_doc({
        "doctype": "Quotation",
        "party_name": customer,
        "quotation_to": "Customer",
        "items": [{
            "item_code": "Sample Aluminium Profile",
            "item_name": "Sample Aluminium Profile",
            "uom": "Meter",
            "conversion_factor": 1.0,
            "qty": qty,
            "rate": 1000,
            "custom_product_category": "Aluminium",
        }],
    })
    quo.save(ignore_permissions=True)
    quo.submit()
    return quo


class TestQuotationAmendment(FrappeTestCase):
    def setUp(self):
        self.customer = _ensure_customer()

    def test_chain_resolver_walks_both_directions(self):
        quo = _make_submitted_quotation(self.customer)
        quo.cancel()
        amended_name = api.amend_quotation(quo.name)
        chain = api._resolve_quotation_chain(quo.name)
        self.assertEqual(chain[0], quo.name)
        self.assertIn(amended_name, chain)
        # resolving from the amendment finds the same chain
        self.assertEqual(api._resolve_quotation_chain(amended_name), chain)

    def test_amend_keeps_job_card_name_and_repoints(self):
        quo = _make_submitted_quotation(self.customer)
        jc_name = api.create_job_card_from_quotation(
            quotation=quo.name, customer=self.customer, payment_mode="Invoice Customer",
            payment_option="Cheque",
        )

        eligibility = api.get_quotation_amendment_eligibility(quo.name)
        self.assertTrue(eligibility["can_amend"], eligibility["reasons"])

        api.cancel_quotation(quo.name)
        amended_name = api.amend_quotation(quo.name)
        self.assertTrue(_job_card_pending(jc_name))

        amended = frappe.get_doc("Quotation", amended_name)
        # bump qty -> higher total
        amended.items[0].qty = 6
        amended.save(ignore_permissions=True)
        amended.submit()

        jc = frappe.get_doc("CAW Job Card", jc_name)
        self.assertEqual(jc.name, jc_name)              # stable name
        self.assertEqual(jc.quotation, amended_name)    # re-pointed link
        self.assertFalse(_job_card_pending(jc_name))    # unfrozen

    def test_amend_rejected_when_invoice_exists(self):
        quo = _make_submitted_quotation(self.customer)
        api.create_job_card_from_quotation(
            quotation=quo.name, customer=self.customer, payment_mode="Invoice Customer",
            payment_option="Cheque",
        )
        # fake a linked invoice marker without full settlement machinery
        inv = frappe.get_doc("Sales Invoice", api.make_sales_invoice_from_quotation(quo.name))
        inv.custom_source_quotation = quo.name
        inv.save(ignore_permissions=True)

        eligibility = api.get_quotation_amendment_eligibility(quo.name)
        self.assertFalse(eligibility["can_amend"])
        self.assertTrue(any("invoice" in r.lower() for r in eligibility["reasons"]))


def _job_card_pending(jc_name):
    jc = frappe.get_doc("CAW Job Card", jc_name)
    return api._job_card_quotation_amendment_pending(jc)
