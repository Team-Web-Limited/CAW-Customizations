import frappe
from frappe.model.document import Document


class CAWPrintFormatConfiguration(Document):
    def validate(self):
        if not self.document_type and self.print_format:
            self.document_type = frappe.db.get_value("Print Format", self.print_format, "doc_type")
