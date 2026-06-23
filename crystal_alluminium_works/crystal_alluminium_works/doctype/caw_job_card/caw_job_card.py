import json

import frappe
from frappe.model.document import Document


JOB_CARD_HISTORY_FIELDS = (
	"quotation",
	"customer",
	"customer_name",
	"payment_mode",
	"payment_option",
	"customer_pin",
	"phone_number",
	"quotation_amount",
	"payment_amount",
	"balance_amount",
	"status",
)


class CAWJobCard(Document):
	def before_save(self):
		if self.status == "Cancelled":
			return

		payment_amount = frappe.utils.flt(self.payment_amount)
		quotation_amount = frappe.utils.flt(self.quotation_amount)
		balance_amount = frappe.utils.flt(self.balance_amount)

		if quotation_amount > 0 and (balance_amount <= 0 or payment_amount >= quotation_amount):
			self.status = "Completed"
		elif payment_amount > 0:
			self.status = "In Progress"
		else:
			self.status = "Draft"

	def after_insert(self):
		self.create_history_record("Created")
		self.flags.caw_job_card_created_history = True

	def on_update(self):
		if self.flags.caw_job_card_created_history:
			return

		self.create_history_record("Updated")

	def on_trash(self):
		frappe.db.delete("CAW Job Card History", {"job_card": self.name})

	def create_history_record(self, change_type):
		if not frappe.db.exists("DocType", "CAW Job Card History"):
			return

		snapshot = {fieldname: self.get(fieldname) for fieldname in JOB_CARD_HISTORY_FIELDS}
		previous_doc = None if change_type == "Created" else self.get_doc_before_save()
		previous_payment_amount = frappe.utils.flt(previous_doc.payment_amount if previous_doc else 0)
		current_payment_amount = frappe.utils.flt(self.payment_amount or 0)
		amount_paid = current_payment_amount if change_type == "Created" else current_payment_amount - previous_payment_amount
		if amount_paid <= 0:
			return

		history = frappe.new_doc("CAW Job Card History")
		history.job_card = self.name
		history.changed_by = frappe.session.user
		history.change_type = change_type
		history.amount_paid = amount_paid
		history.snapshot_json = json.dumps(snapshot, default=str, indent=2)

		for fieldname, value in snapshot.items():
			history.set(fieldname, value)

		history.insert(ignore_permissions=True)
