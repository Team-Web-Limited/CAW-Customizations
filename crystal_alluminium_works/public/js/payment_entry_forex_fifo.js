// FIFO cost-basis panel on Payment Entry.
//
// Shows what this entry did to the foreign-currency lot ledger: which lots it
// consumed and what they cost. Read-only, and mostly an explanation of the
// exchange rate on the document above it -- that rate is the blended cost of
// these lots, which is why it matches no market quote.
//
// Gain appears only where currency was genuinely converted back to shillings.
// Paying a dollar invoice out of a dollar account converts nothing, so it shows
// a cost and no gain. See crystal_alluminium_works/forex_fifo.py.

frappe.ui.form.on("Payment Entry", {
	refresh(frm) {
		render_fifo_panel(frm);
	},
});

function render_fifo_panel(frm) {
	const wrapper = frm.get_field("custom_forex_fifo_html");
	if (!wrapper) return;

	// Only submitted entries have a place in the ledger; a draft has not moved
	// any currency yet, so there is nothing truthful to show.
	if (frm.doc.docstatus !== 1) {
		wrapper.$wrapper.empty();
		return;
	}

	frappe.call({
		method: "crystal_alluminium_works.forex_fifo.get_payment_entry_detail",
		args: { payment_entry: frm.doc.name },
		callback(r) {
			const rows = (r.message && r.message.rows) || [];
			if (!rows.length) {
				wrapper.$wrapper.empty();
				return;
			}
			wrapper.$wrapper.html(build_html(rows));
		},
	});
}

function build_html(rows) {
	return rows.map(build_account_block).join("");
}

function build_account_block(row) {
	const fcy = row.currency;
	const inbound = row.qty_in > 0;

	const header = `
		<div style="margin-bottom:4px">
			<b>${frappe.utils.escape_html(row.account)}</b>
			<span class="text-muted"> &middot; ${frappe.utils.escape_html(row.movement_type)}</span>
		</div>`;

	let body;
	if (inbound) {
		body = `
			<div class="text-muted" style="margin-bottom:8px">
				${__("Added {0} {1} to the lot ledger at {2}. Inbound currency realises no gain — it enters at the rate the ledger booked it.",
					[format_number(row.qty_in, null, 2), fcy, format_number(row.txn_rate, null, 4)])}
			</div>`;
	} else {
		const allocations = (row.allocations || [])
			.map(
				(a) => `
				<tr>
					<td>${frappe.datetime.str_to_user(a.date)}</td>
					<td>${frappe.utils.get_form_link("Payment Entry", a.voucher, true)}</td>
					<td class="text-right">${format_number(a.qty, null, 2)}</td>
					<td class="text-right">${format_number(a.rate, null, 4)}</td>
					<td class="text-right">${format_currency(a.value)}</td>
				</tr>`
			)
			.join("");

		const shortfall = row.shortfall
			? `<tr><td colspan="5" style="color:var(--red-500)">${__(
					"{0} {1} had no cost basis in this ledger and carries no gain or loss.",
					[format_number(row.shortfall, null, 2), fcy]
			  )}</td></tr>`
			: "";

		body = `
			<table class="table table-bordered table-sm" style="margin-bottom:8px">
				<thead>
					<tr>
						<th>${__("Lot Date")}</th>
						<th>${__("Acquired Via")}</th>
						<th class="text-right">${__("Qty")}</th>
						<th class="text-right">${__("Cost Rate")}</th>
						<th class="text-right">${__("Cost")}</th>
					</tr>
				</thead>
				<tbody>${allocations}${shortfall}</tbody>
			</table>
			${build_outcome(row)}`;
	}

	const footer = `
		<div class="text-muted">
			${__("Balance after this entry")}:
			<b>${format_number(row.balance_qty, null, 2)} ${fcy}</b>
			${__("at")} <b>${format_number(row.balance_rate, null, 4)}</b>
			= <b>${format_currency(row.balance_value)}</b>
		</div>`;

	return `<div style="margin-bottom:16px">${header}${body}${footer}</div>`;
}

// What the movement came to. A sale converted the currency and so has a result;
// a payment spent it at cost and has none, and saying "gain: 0" there invites
// the reader to hunt for a number that was never meant to exist.
function build_outcome(row) {
	const gl = row.realized_gain_loss || 0;

	if (!gl) {
		return `
			<div style="margin-bottom:8px">
				${__("Cost of currency paid out")}: <b>${format_currency(row.cost_out)}</b>
				${__("at")} <b>${format_number(row.avg_cost_rate, null, 4)}</b>
				<div class="text-muted" style="margin-top:4px">
					${__("This is the rate on the entry above — the blended cost of the lots listed, which is why it matches no market rate. Nothing is realised here; the currency was spent, not converted.")}
				</div>
			</div>`;
	}

	const colour = gl > 0 ? "var(--green-600)" : "var(--red-500)";
	const label = gl > 0 ? __("Realised gain") : __("Realised loss");

	return `
		<div style="margin-bottom:8px">
			${__("Sold for")} <b>${format_currency(row.proceeds)}</b>
			${__("against FIFO cost")} <b>${format_currency(row.cost_out)}</b>
			${__("at")} <b>${format_number(row.avg_cost_rate, null, 4)}</b>
			&nbsp;&rarr;&nbsp;
			<span style="color:${colour}"><b>${label}: ${format_currency(Math.abs(gl))}</b></span>
		</div>`;
}
