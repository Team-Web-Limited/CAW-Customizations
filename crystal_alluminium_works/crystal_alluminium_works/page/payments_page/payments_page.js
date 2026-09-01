frappe.pages['payments-page'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Payments',
		single_column: true
	});

	wrapper.page = page;
};

frappe.pages['payments-page'].on_page_show = function(wrapper) {
	let page = wrapper.page || (wrapper.control ? wrapper.control.page : null);

	if (!page) {
		page = $(wrapper).data('page');
	}

	render_payments_page(page);
};

const PAYMENTS_PAGE_LENGTH = 30;

function get_payments_page_state(page) {
	if (!page._payments_page_state) {
		page._payments_page_state = {
			page: 1,
			page_length: PAYMENTS_PAGE_LENGTH,
			total_count: 0,
			has_next: false,
			request_serial: 0
		};
	}
	return page._payments_page_state;
}

async function render_payments_page(page) {
	let $body = $(page.body);
	page.set_primary_action(__('Create Payment'), () => open_create_payment_modal(page));
	$body.html('<div style="padding:40px;text-align:center;color:var(--text-muted);"><span class="spinner"></span> Loading...</div>');

	let mode_of_payments = await get_payment_mode_options();

	let html = `
	<style>
		.pay-page { width:100%; max-width: 1400px; margin: 0 auto; padding: 24px 16px; }
		.pay-toolbar { display: flex; justify-content: flex-end; margin-bottom: 18px; }
		.pay-card { background: var(--fg-color); border: 1px solid var(--border-color); border-radius: 8px; box-shadow: var(--shadow-xs); overflow: hidden; margin-bottom: 20px; }
		.pay-card-header { padding: 14px 18px; font-size: 15px; font-weight: 700; color: var(--heading-color); border-bottom: 1px solid var(--border-color); background: var(--subtle-fg); display: flex; align-items: center; gap: 10px; }
		.pay-card-header .pay-icon { font-size: 18px; }
		.pay-filters { padding:16px 18px; border-bottom:1px solid var(--border-color); background:var(--fg-color); }
		.pay-filter-grid { display:grid; grid-template-columns:minmax(260px, 2fr) minmax(180px, 1fr) minmax(150px, .8fr) minmax(150px, .8fr) auto; gap:12px; align-items:end; }
		.pay-filter-field label { display:block; margin-bottom:6px; color:var(--text-muted); font-size:12px; font-weight:600; }
		.pay-filter-actions { display:flex; gap:8px; }
		.pay-table-scroll { height:560px; overflow:auto; }
		.pay-table { width: 100%; min-width: 1250px; border-collapse: separate; border-spacing:0; }
		.pay-table th { position:sticky; top:0; z-index:2; padding: 11px 14px; font-size: 12px; font-weight: 700; color: var(--text-muted); text-align: left; border-bottom: 1px solid var(--border-color); background: var(--subtle-fg); }
		.pay-table td { padding: 12px 14px; font-size: 13px; color: var(--text-color); border-bottom: 1px solid var(--border-color); vertical-align: top; }
		.pay-table tbody tr:last-child td { border-bottom: 0; }
		.pay-muted { color: var(--text-muted); }
		.pay-pagination { padding:14px 18px; border-top:1px solid var(--border-color); }
		.pay-pagination-bar { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
		.pay-pagination-meta { color:var(--text-muted); font-size:13px; }
		.pay-pagination-actions { display:flex; align-items:center; gap:8px; }
		.pay-pagination-page { min-width:70px; text-align:center; color:var(--text-color); font-size:13px; }
		@media (max-width: 900px) {
			.pay-filter-grid { grid-template-columns:repeat(2, minmax(0, 1fr)); }
			.pay-filter-search, .pay-filter-actions { grid-column:1 / -1; }
			.pay-table-scroll { height:480px; }
		}
		@media (max-width: 560px) {
			.pay-filter-grid { grid-template-columns:1fr; }
			.pay-filter-search, .pay-filter-actions { grid-column:auto; }
		}
	</style>

	<div class="pay-page">
		<div class="pay-card">
			<div class="pay-card-header">
				<span class="pay-icon">#</span> Recent Payments
			</div>
			<div class="pay-filters">
				<div class="pay-filter-grid">
					<div class="pay-filter-field pay-filter-search">
						<label>Search</label>
						<input type="search" class="form-control" data-filter="search" placeholder="Customer, job card, reference, method or account">
					</div>
					<div class="pay-filter-field">
						<label>Payment Method</label>
						<select class="form-control" data-filter="payment_method">
							<option value="">All methods</option>
							${mode_of_payments.map(method => `<option value="${frappe.utils.escape_html(method)}">${frappe.utils.escape_html(method)}</option>`).join('')}
						</select>
					</div>
					<div class="pay-filter-field">
						<label>From Date</label>
						<input type="date" class="form-control" data-filter="from_date">
					</div>
					<div class="pay-filter-field">
						<label>To Date</label>
						<input type="date" class="form-control" data-filter="to_date">
					</div>
					<div class="pay-filter-actions">
						<button class="btn btn-primary pay-filter-apply">Search</button>
						<button class="btn btn-default pay-filter-clear">Clear</button>
					</div>
				</div>
			</div>
			<div class="pay-table-scroll">
				<table class="pay-table">
					<thead>
						<tr>
							<th>Date</th>
							<th style="text-align:center;">C.Type</th>
							<th>Name</th>
							<th>Customer</th>
							<th style="text-align:right;">Amount</th>
							<th>Method</th>
							<th>Deposit To</th>
							<th>Reference</th>
							<th>Quotation</th>
						</tr>
					</thead>
					<tbody class="pay-table-body"></tbody>
				</table>
			</div>
			<div class="pay-pagination"></div>
		</div>
	</div>
	`;

	$body.html(html);
	bind_payments_page_events(page, $body);
	load_payment_records(page, 1);
}

async function get_payment_mode_options() {
	try {
		let mop_response = await frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Mode of Payment',
				// Only enabled customer-receipt methods. USD TRANSFER and Petty Cash are
				// supplier / outgoing, not customer receipts.
				filters: { enabled: 1, name: ['not in', ['USD TRANSFER', 'Petty Cash']] },
				fields: ['name'],
				limit_page_length: 0,
				order_by: 'name asc'
			}
		});
		return (mop_response.message || []).map(row => row.name);
	} catch (e) {
		return ['Cash', 'Paybill', 'Bank Transfer i.e RTGS, TT', 'PESALINK', 'Cheque'];
	}
}

function render_payment_record_rows(records) {
	if (!records.length) {
		return `
			<tr>
				<td colspan="9" class="pay-muted" style="text-align:center;padding:24px;">
					No payments recorded yet.
				</td>
			</tr>
		`;
	}

	return records.map(row => {
		let quotation_cell = '<span class="pay-muted">-</span>';
		if (row.quotation) {
			quotation_cell = frappe.utils.escape_html(row.quotation);
			if (!row.job_card) {
				quotation_cell += ' <span class="pay-muted" title="No Job Card yet — held as deposit credit">(deposit)</span>';
			}
		}
		let is_cash = row.customer_type === 'Cash';
		let type_color = is_cash ? '#16a085' : '#8e44ad';
		return `
			<tr>
				<td>${frappe.utils.escape_html(row.date ? frappe.datetime.str_to_user(row.date) : '-')}</td>
				<td style="text-align:center;">
					<span style="background:${type_color}20; color:${type_color}; padding:4px 12px; border-radius:12px; font-size:12px; font-weight:600;">
						${frappe.utils.escape_html(row.customer_type || '—')}
					</span>
				</td>
				<td style="font-weight:500;">${frappe.utils.escape_html(row.display_name || '-')}</td>
				<td>${frappe.utils.escape_html(row.customer || '-')}</td>
				<td style="text-align:right;font-weight:600;">${format_currency(row.amount || 0, 'KES')}</td>
				<td>${frappe.utils.escape_html(row.payment_method || '-')}</td>
				<td>${frappe.utils.escape_html(row.deposit_to || '-')}</td>
				<td>${frappe.utils.escape_html(row.reference || '-')}</td>
				<td>${quotation_cell}</td>
			</tr>
		`;
	}).join('');
}

function bind_payments_page_events(page, $body) {
	$body.off('.paymentsPage');

	$body.on('click.paymentsPage', '.pay-filter-apply', function() {
		load_payment_records(page, 1);
	});

	$body.on('click.paymentsPage', '.pay-filter-clear', function() {
		$body.find('[data-filter]').val('');
		load_payment_records(page, 1);
	});

	$body.on('keydown.paymentsPage', '.pay-filters input', function(event) {
		if (event.key === 'Enter') {
			load_payment_records(page, 1);
		}
	});

	$body.on('input.paymentsPage', '[data-filter="search"]', function() {
		clearTimeout(page._payments_search_timer);
		page._payments_search_timer = setTimeout(function() {
			load_payment_records(page, 1);
		}, 350);
	});

	$body.on('click.paymentsPage', '.pay-pagination-prev', function() {
		let state = get_payments_page_state(page);
		if (state.page > 1) {
			load_payment_records(page, state.page - 1);
		}
	});

	$body.on('click.paymentsPage', '.pay-pagination-next', function() {
		let state = get_payments_page_state(page);
		if (state.has_next) {
			load_payment_records(page, state.page + 1);
		}
	});
}

function load_payment_records(page, page_number) {
	let state = get_payments_page_state(page);
	let $body = $(page.body);
	let from_date = $body.find('[data-filter="from_date"]').val() || '';
	let to_date = $body.find('[data-filter="to_date"]').val() || '';

	if (from_date && to_date && from_date > to_date) {
		frappe.msgprint(__('From Date cannot be after To Date.'));
		return;
	}

	state.page = page_number || 1;
	state.request_serial += 1;
	let request_serial = state.request_serial;

	$body.find('.pay-table-body').html(`
		<tr><td colspan="9" class="pay-muted" style="text-align:center;padding:32px;">Loading payments...</td></tr>
	`);

	frappe.call({
		method: 'crystal_alluminium_works.api.get_payments_page',
		args: {
			search: $body.find('[data-filter="search"]').val() || '',
			payment_method: $body.find('[data-filter="payment_method"]').val() || '',
			from_date: from_date,
			to_date: to_date,
			page: state.page,
			page_length: state.page_length
		},
		callback: function(response) {
			if (request_serial !== state.request_serial) {
				return;
			}

			let result = response.message || {};
			state.page = result.page || 1;
			state.page_length = result.page_length || PAYMENTS_PAGE_LENGTH;
			state.total_count = result.total_count || 0;
			state.has_next = !!result.has_next;

			$body.find('.pay-table-body').html(render_payment_record_rows(result.rows || []));
			render_payments_pagination(page);
			$body.find('.pay-table-scroll').scrollTop(0);
		}
	});
}

function render_payments_pagination(page) {
	let state = get_payments_page_state(page);
	let start = state.total_count ? ((state.page - 1) * state.page_length) + 1 : 0;
	let end = Math.min(state.page * state.page_length, state.total_count);
	let total_pages = Math.max(Math.ceil(state.total_count / state.page_length), 1);

	$(page.body).find('.pay-pagination').html(`
		<div class="pay-pagination-bar">
			<div class="pay-pagination-meta">Showing ${start}-${end} of ${state.total_count} payments</div>
			<div class="pay-pagination-actions">
				<button class="btn btn-default pay-pagination-prev" ${state.page <= 1 ? 'disabled' : ''}>Previous</button>
				<span class="pay-pagination-page">Page ${state.page} of ${total_pages}</span>
				<button class="btn btn-default pay-pagination-next" ${!state.has_next ? 'disabled' : ''}>Next</button>
			</div>
		</div>
	`);
}

function open_create_payment_modal(page) {
	// The dialog itself lives in the shared caw_payment_dialog.js (see app_include_js in
	// hooks.py) so other desk pages (e.g. Quotation Manager's Record/Refund Deposit) can
	// open it in place too. It also honours frappe.route_options on its own for any caller
	// that still navigates here instead of calling CAWPaymentDialog.open() directly.
	if (!window.CAWPaymentDialog) {
		frappe.msgprint(__('Payment dialog failed to load. Please refresh the page.'));
		return;
	}
	window.CAWPaymentDialog.open({
		onSaved: () => load_payment_records(page, 1)
	});
}

