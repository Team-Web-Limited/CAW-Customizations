// Derive the exchange rate on money leaving a foreign-currency bank account.
//
// The rate is what the dollars being spent cost, oldest lots first -- not a
// figure anyone types. This script only keeps the form honest while the entry is
// being written; the authority is crystal_alluminium_works/payment_entry_forex_rate.py,
// which recomputes the same number on every save. A rate read here can be stale
// by the time the document saves, because another entry may have taken the lots
// in between.

frappe.ui.form.on("Payment Entry", {
	paid_from(frm) {
		apply_cost_rate(frm);
	},
	paid_amount(frm) {
		apply_cost_rate(frm);
	},
	posting_date(frm) {
		apply_cost_rate(frm);
	},
	company(frm) {
		apply_cost_rate(frm);
	},
});

function apply_cost_rate(frm) {
	if (frm.doc.docstatus !== 0) return;
	if (!frm.doc.company || !frm.doc.paid_from || !frm.doc.paid_amount) return;

	frappe.call({
		method: "crystal_alluminium_works.forex_fifo.get_payment_cost_rate",
		args: {
			company: frm.doc.company,
			account: frm.doc.paid_from,
			qty: frm.doc.paid_amount,
			posting_date: frm.doc.posting_date,
		},
		callback(r) {
			const detail = r.message;
			// Not a foreign-currency holding: ERPNext's own handling applies.
			if (!detail || !detail.tracked) return;

			show_shortfall(frm, detail);
			if (!detail.rate) return;

			frm.set_value("source_exchange_rate", detail.rate);
			// Same-currency move: both halves carry the cost across intact.
			if (frm.doc.paid_from_account_currency === frm.doc.paid_to_account_currency) {
				frm.set_value("target_exchange_rate", detail.rate);
			}
		},
	});
}

// Say it here rather than letting the save throw be the first anyone hears of
// it -- the fix is to record the missing currency, which is not a quick edit.
function show_shortfall(frm, detail) {
	if (!detail.shortfall) {
		frm.dashboard.clear_headline();
		return;
	}

	frm.dashboard.set_headline(
		__("{0} {1} of this payment has no recorded cost — {2} holds only {3} {1} the FIFO ledger has seen. This cannot be submitted until the missing currency is recorded.", [
			format_number(detail.shortfall, null, 2),
			detail.currency,
			frm.doc.paid_from,
			format_number(detail.available_qty, null, 2),
		]),
		"orange"
	);
}
