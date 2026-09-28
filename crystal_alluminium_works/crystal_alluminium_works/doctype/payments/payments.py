# Copyright (c) 2026, Venum and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document


class Payments(Document):
	def validate(self):
		from crystal_alluminium_works.mpesa_link import link_payment_to_mpesa

		link_payment_to_mpesa(self)
