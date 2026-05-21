// Client-side customizations for Sales Invoice
frappe.ui.form.on('Sales Invoice', {
	refresh: function(frm) {
		frm.set_value('update_stock', 0);
		frm.set_value('set_posting_time', 1);
		frm.set_df_property('update_stock', 'read_only', 1);
		frm.set_df_property('update_stock', 'hidden', 1);
		frm.set_df_property('set_posting_time', 'read_only', 1);
		frm.set_df_property('set_posting_time', 'hidden', 1);

		if (!frm.is_new()) {
			frm.add_custom_button('Open Custom View', function() {
				frappe.set_route('sales-invoice-manager', frm.doc.name);
			});
		}
	},

	update_stock: function(frm) {
		if (frm.doc.update_stock) {
			frappe.show_alert({
				message: __('Stock impact is disabled for Sales Invoices in this workflow.'),
				indicator: 'orange',
			});
			frm.set_value('update_stock', 0);
		}
	},

	set_posting_time: function(frm) {
		if (!frm.doc.set_posting_time) {
			frm.set_value('set_posting_time', 1);
		}
	},
});
