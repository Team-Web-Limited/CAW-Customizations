// Cheque Register: every cheque a customer has paid with, from received to cleared
// (cheque_register.py). A received cheque sits in the Cheques in Hand account; Accounts marks it
// Banked when it goes to the bank, Cleared when the bank credits it (moving the money from Cheques
// in Hand to the bank), or Bounced (the payment is reversed and the account goes on hold).
frappe.pages['cheque-register'].on_page_load = function (wrapper) {
	let page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Cheque Register',
		single_column: true,
	});
	wrapper.cheque_register_page = page;
	page.cr_status = 'Uncleared';

	page.set_secondary_action('Refresh', () => load_cheque_register(page));
	$(page.body).html(`
		<style>
			.cr-page { max-width: 1280px; margin: 0 auto; padding: 20px 16px; }
			.cr-toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 16px; }
			.cr-toolbar input { max-width: 280px; }
			.cr-table-wrap { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; box-shadow: var(--shadow-xs); overflow-x: auto; }
			.cr-table { width: 100%; min-width: 1000px; border-collapse: collapse; }
			.cr-table th { padding: 10px 14px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; text-align: left; background: var(--subtle-fg); border-bottom: 1px solid var(--border-color); }
			.cr-table td { padding: 10px 14px; font-size: 13px; vertical-align: top; border-bottom: 1px solid var(--border-color); }
			.cr-muted { color: var(--text-muted); font-size: 12px; }
			.cr-due { color: var(--red-600); font-weight: 600; }
			.cr-total { margin-top: 10px; text-align: right; color: var(--text-muted); }
		</style>
		<div class="cr-page">
			<div class="cr-toolbar">
				<button class="btn btn-sm btn-primary" data-status="Uncleared">In Hand</button>
				<button class="btn btn-sm btn-default" data-status="Cleared">Cleared</button>
				<button class="btn btn-sm btn-default" data-status="Bounced">Bounced</button>
				<button class="btn btn-sm btn-default" data-status="All">All</button>
				<input type="text" class="form-control input-sm cr-search" placeholder="Cheque no or customer">
			</div>
			<div class="cr-table-wrap">
				<table class="cr-table">
					<thead><tr>
						<th>Cheque</th><th>Customer</th><th>Cheque Date</th><th>Amount</th><th>Status</th><th>Banking</th><th></th>
					</tr></thead>
					<tbody class="cr-body"></tbody>
				</table>
			</div>
			<div class="cr-total"></div>
		</div>
	`);

	$(page.body).on('click', '[data-status]', function () {
		page.cr_status = $(this).attr('data-status');
		$(page.body).find('[data-status]').removeClass('btn-primary').addClass('btn-default');
		$(this).removeClass('btn-default').addClass('btn-primary');
		load_cheque_register(page);
	});
	$(page.body).on('keydown', '.cr-search', function (e) {
		if (e.key === 'Enter') load_cheque_register(page);
	});
	$(page.body).on('click', '[data-cr-action]', function () {
		let row = (page.cr_rows || []).find(r => r.name === $(this).attr('data-name'));
		if (row) open_cheque_action_dialog(page, row, $(this).attr('data-cr-action'));
	});
	$(page.body).on('click', '[data-open-customer]', function (e) {
		e.preventDefault();
		frappe.set_route('customer-manager', $(this).attr('data-open-customer'));
	});
};

frappe.pages['cheque-register'].on_page_show = function (wrapper) {
	if (wrapper.cheque_register_page) {
		load_cheque_register(wrapper.cheque_register_page);
	}
};

function cr_text(value) {
	return frappe.utils.escape_html(value === null || value === undefined || value === '' ? '-' : String(value));
}

function load_cheque_register(page) {
	let $body = $(page.body).find('.cr-body');
	$body.html('<tr><td colspan="7" class="cr-muted" style="text-align:center;padding:20px;">Loading...</td></tr>');
	frappe.call({
		method: 'crystal_alluminium_works.cheque_register.get_cheques',
		args: { status: page.cr_status, search: $(page.body).find('.cr-search').val() || '' },
		callback: (r) => {
			let rows = r.message || [];
			page.cr_rows = rows;
			if (!rows.length) {
				$body.html('<tr><td colspan="7" class="cr-muted" style="text-align:center;padding:20px;">No cheques.</td></tr>');
				$(page.body).find('.cr-total').text('');
				return;
			}
			$body.html(rows.map(cr_row_html).join(''));
			let total = rows.reduce((sum, row) => sum + flt(row.amount), 0);
			$(page.body).find('.cr-total').text(`${rows.length} cheque${rows.length === 1 ? '' : 's'} · ${format_currency(total)}`);
		}
	});
}

function cr_row_html(row) {
	let banking = [];
	if (row.bank_account) banking.push(`Into ${cr_text(row.bank_account)}`);
	if (row.banked_on) banking.push(`Banked ${cr_text(frappe.datetime.str_to_user(row.banked_on))}`);
	if (row.cleared_on) banking.push(`Cleared ${cr_text(frappe.datetime.str_to_user(row.cleared_on))}${row.clearing_entry ? ` (${cr_text(row.clearing_entry)})` : ''}`);
	if (row.bounced_on) banking.push(`<span class="cr-due">Bounced ${cr_text(frappe.datetime.str_to_user(row.bounced_on))}: ${cr_text(row.bounce_reason)}</span>`);

	let actions = [];
	let btn = (action, label, cls) => `<button class="btn btn-xs ${cls || 'btn-default'}" data-cr-action="${action}" data-name="${frappe.utils.escape_html(row.name)}">${label}</button>`;
	if (row.status === 'Received') actions.push(btn('banked', 'Banked'));
	if (row.status === 'Received' || row.status === 'Banked') actions.push(btn('cleared', 'Cleared', 'btn-primary'));
	if (['Received', 'Banked', 'Cleared'].includes(row.status)) actions.push(btn('bounced', 'Bounced', 'btn-danger'));

	return `
		<tr>
			<td><b>${cr_text(row.cheque_no)}</b><div class="cr-muted">${cr_text(row.drawer_bank)} · ${cr_text(row.name)} · Payment ${cr_text(row.payments)}</div></td>
			<td><a href="#" data-open-customer="${frappe.utils.escape_html(row.customer)}">${cr_text(row.customer_name || row.customer)}</a></td>
			<td class="${row.due ? 'cr-due' : ''}">${cr_text(frappe.datetime.str_to_user(row.cheque_date))}
				<div class="cr-muted">${row.is_post_dated ? 'Post-dated' : 'Current'}${row.due ? ' · ready to bank' : ''}</div></td>
			<td>${format_currency(row.amount)}</td>
			<td><b>${cr_text(row.status)}</b></td>
			<td class="cr-muted">${banking.join('<br>') || '-'}</td>
			<td style="white-space:nowrap;">${actions.join(' ')}</td>
		</tr>`;
}

function open_cheque_action_dialog(page, row, action) {
	let today = frappe.datetime.get_today();
	let bank_query = () => ({ filters: { account_type: 'Bank', is_group: 0 } });
	let config = {
		banked: {
			title: `Bank cheque ${row.cheque_no}`,
			fields: [
				{ fieldtype: 'Date', fieldname: 'banked_on', label: 'Banked On', default: today, reqd: 1 },
				{ fieldtype: 'Link', fieldname: 'bank_account', label: 'Paid Into', options: 'Account', default: row.bank_account, reqd: 1, get_query: bank_query }
			],
			method: 'mark_banked',
			args: (v) => ({ banked_on: v.banked_on, bank_account: v.bank_account }),
			done: 'Marked banked'
		},
		cleared: {
			title: `Cheque ${row.cheque_no} cleared`,
			fields: [
				{ fieldtype: 'HTML', options: `<p class="text-muted">Moves ${format_currency(row.amount)} from Cheques in Hand to the bank with a Journal Entry.</p>` },
				{ fieldtype: 'Date', fieldname: 'cleared_on', label: 'Cleared On', default: today, reqd: 1 },
				{ fieldtype: 'Link', fieldname: 'bank_account', label: 'Paid Into', options: 'Account', default: row.bank_account, reqd: 1, get_query: bank_query }
			],
			method: 'mark_cleared',
			args: (v) => ({ cleared_on: v.cleared_on, bank_account: v.bank_account }),
			done: 'Cheque cleared'
		},
		bounced: {
			title: `Cheque ${row.cheque_no} bounced`,
			fields: [
				{
					fieldtype: 'HTML',
					options: `<p class="text-muted">The payment of ${format_currency(row.amount)} is reversed${row.status === 'Cleared' ? ' (and the clearing entry cancelled)' : ''}, the job cards it paid owe again, and ${frappe.utils.escape_html(row.customer_name || row.customer)}'s account is put <b>on hold</b> until Accounts clears it.</p>`
				},
				{ fieldtype: 'Date', fieldname: 'bounced_on', label: 'Bounced On', default: today, reqd: 1 },
				{ fieldtype: 'Small Text', fieldname: 'reason', label: 'Reason (e.g. insufficient funds)', reqd: 1 }
			],
			method: 'mark_bounced',
			args: (v) => ({ bounced_on: v.bounced_on, reason: v.reason }),
			done: 'Cheque bounced; account put on hold'
		}
	}[action];

	let dialog = new frappe.ui.Dialog({
		title: config.title,
		fields: config.fields,
		primary_action_label: 'Save',
		primary_action(values) {
			frappe.call({
				method: `crystal_alluminium_works.cheque_register.${config.method}`,
				args: Object.assign({ name: row.name }, config.args(values)),
				freeze: true,
				callback: () => {
					dialog.hide();
					frappe.show_alert({ message: config.done, indicator: action === 'bounced' ? 'orange' : 'green' });
					load_cheque_register(page);
				}
			});
		}
	});
	dialog.show();
}
