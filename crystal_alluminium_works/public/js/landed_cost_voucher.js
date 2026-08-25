// Fill a Landed Cost Voucher from the Ship No as it is keyed.
//
// One shipment is spread across several invoices -- the stock-updating ones the
// cost lands on, and the freight/clearing/duty invoices being spread -- all tied
// together by the Ship No. Typing it rebuilds Vouchers, Vendor Invoices and
// Landed Cost in one go; the split between those tables is decided server side,
// in crystal_alluminium_works/landed_cost_handler.py.
//
// The tables are rebuilt, not appended to, so re-keying a Ship No corrects a
// mistyped one instead of stacking the two shipments on top of each other.

frappe.ui.form.on("Landed Cost Voucher", {
	custom_ship_no(frm) {
		fetch_shipment(frm);
	},
	company(frm) {
		if (frm.doc.custom_ship_no) fetch_shipment(frm);
	},
});

function fetch_shipment(frm) {
	if (frm.doc.docstatus !== 0) return;

	const ship_no = (frm.doc.custom_ship_no || "").trim();
	// Clearing the field leaves whatever is in the tables alone -- emptying them
	// would throw away rows added by hand.
	if (!ship_no) return;

	frappe.call({
		method: "crystal_alluminium_works.landed_cost_handler.get_ship_no_documents",
		args: { ship_no: ship_no, company: frm.doc.company },
		callback(r) {
			const data = r.message;
			if (!data) return;

			const counts = {
				purchase_receipts: data.purchase_receipts.length,
				vendor_invoices: data.vendor_invoices.length,
				taxes: data.taxes.length,
			};

			if (!counts.purchase_receipts && !counts.vendor_invoices) {
				frappe.show_alert({
					message: __("No submitted invoices found for Ship No {0}", [ship_no]),
					indicator: "orange",
				});
				return;
			}

			["purchase_receipts", "vendor_invoices", "taxes"].forEach((field) => {
				frm.clear_table(field);
				data[field].forEach((row) => {
					Object.assign(frm.add_child(field), row);
				});
				frm.refresh_field(field);
			});

			// Receipt Items follows from the Vouchers table; pulling it now means
			// the charges have something to distribute over without a second click.
			const pull_items = counts.purchase_receipts
				? frm.call("get_items_from_purchase_receipts").then(() => frm.refresh_field("items"))
				: Promise.resolve();

			pull_items.then(() => {
				frappe.show_alert({
					message: __("Ship No {0}: {1} receipt(s), {2} vendor invoice(s), {3} charge(s)", [
						ship_no,
						counts.purchase_receipts,
						counts.vendor_invoices,
						counts.taxes,
					]),
					indicator: "green",
				});
			});
		},
	});
}
