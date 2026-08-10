// The Crystal Statement of Accounts print format is laid out for a portrait page.
// erpnext's Orientation field has no default, and frappe fills an empty Select with
// its first option - which here is "Landscape" - so set Portrait outright on new
// documents rather than only when the field is empty (it never is).
frappe.ui.form.on("Process Statement Of Accounts", {
	onload(frm) {
		if (frm.is_new()) {
			frm.set_value("orientation", "Portrait");
		}
	},
});
