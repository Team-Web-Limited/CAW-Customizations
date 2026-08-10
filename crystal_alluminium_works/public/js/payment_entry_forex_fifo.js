// FIFO cost-basis panel on Payment Entry.
//
// Shows what this entry did to the foreign-currency lot ledger: which lots it
// consumed, what they cost, and the gain or loss that fell out. Read-only --
// the figures are reported, not posted, and the GL keeps ERPNext's own
// treatment. See crystal_alluminium_works/forex_fifo.py.

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

		const gl = row.realized_gain_loss || 0;
		const colour = gl > 0 ? "var(--green-600)" : gl < 0 ? "var(--red-500)" : "inherit";
		const label = gl >= 0 ? __("Realised gain") : __("Realised loss");

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
			<div style="margin-bottom:8px">
				${__("Paid out at")} <b>${format_number(row.txn_rate, null, 4)}</b>
				${__("against FIFO cost")} <b>${format_number(row.avg_cost_rate, null, 4)}</b>
				&nbsp;&rarr;&nbsp;
				<span style="color:${colour}"><b>${label}: ${format_currency(Math.abs(gl))}</b></span>
			</div>`;
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
