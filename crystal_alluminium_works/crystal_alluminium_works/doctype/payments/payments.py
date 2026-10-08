# Copyright (c) 2026, Venum and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class Payments(Document):
	def validate(self):
		from crystal_alluminium_works.mpesa_link import check_duplicate_bank_reference, link_payment_to_mpesa

		# Cash has no transaction reference; one here is a leftover typed for another method
		# (e.g. an M-Pesa code before switching to Cash) and would mislead reconciliation.
		if self.reference and frappe.db.get_value("Mode of Payment", self.payment_method, "type") == "Cash":
			self.reference = None

		link_payment_to_mpesa(self)
		check_duplicate_bank_reference(self)
