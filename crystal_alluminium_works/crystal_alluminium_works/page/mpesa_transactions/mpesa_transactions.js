frappe.pages['mpesa-transactions'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'M-Pesa Transactions',
		single_column: true
	});

	wrapper.page = page;
};

frappe.pages['mpesa-transactions'].on_page_show = function(wrapper) {
	let page = wrapper.page || (wrapper.control ? wrapper.control.page : null);

	if (!page) {
		page = $(wrapper).data('page');
	}

	render_mpesa_transactions_page(page);
};

const MPESA_TRANSACTIONS_PAGE_LENGTH = 30;

function get_mpesa_transactions_state(page) {
	if (!page._mpesa_transactions_state) {
		page._mpesa_transactions_state = {
			page: 1,
			page_length: MPESA_TRANSACTIONS_PAGE_LENGTH,
			total_count: 0,
			has_next: false,
			request_serial: 0
		};
	}
	return page._mpesa_transactions_state;
}

function render_mpesa_transactions_page(page) {
	let $body = $(page.body);
	// Same default as the Payments page: today's transactions, not the whole history.
	let today = frappe.datetime.get_today();

	$body.html(`
	<style>
		.mpx-page { width:100%; max-width: 1400px; margin: 0 auto; padding: 24px 16px; }
		.mpx-card { background: var(--fg-color); border: 1px solid var(--border-color); border-radius: 8px; box-shadow: var(--shadow-xs); overflow: hidden; }
		.mpx-card-header { padding: 14px 18px; font-size: 15px; font-weight: 700; color: var(--heading-color); border-bottom: 1px solid var(--border-color); background: var(--subtle-fg); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
		.mpx-totals { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
		.mpx-pill { background: var(--fg-color); border: 1px solid var(--border-color); border-radius: 14px; padding: 5px 12px; font-size: 12px; font-weight: 600; color: var(--text-color); white-space: nowrap; }
		.mpx-pill .mpx-pill-label { color: var(--text-muted); margin-right: 5px; }
		.mpx-pill-warn { background: #fdf2e3; border-color: #f3c98b; color: #9a5b00; }
		.mpx-pill-warn .mpx-pill-label { color: #9a5b00; }
		.mpx-pill-total { background: #2c3e50; border-color: #2c3e50; color: #fff; }
		.mpx-pill-total .mpx-pill-label { color: rgba(255,255,255,.75); }
		.mpx-filters { padding:16px 18px; border-bottom:1px solid var(--border-color); }
		.mpx-filter-grid { display:grid; grid-template-columns:minmax(240px, 2fr) minmax(160px, 1fr) minmax(140px, .8fr) minmax(140px, .8fr) auto; gap:12px; align-items:end; }
		.mpx-filter-field label { display:block; margin-bottom:6px; color:var(--text-muted); font-size:12px; font-weight:600; }
		.mpx-filter-actions { display:flex; gap:8px; }
		.mpx-table-scroll { height:560px; overflow:auto; }
		.mpx-table { width: 100%; min-width: 980px; border-collapse: separate; border-spacing:0; }
		.mpx-table th { position:sticky; top:0; z-index:2; padding: 11px 14px; font-size: 12px; font-weight: 700; color: var(--text-muted); text-align: left; border-bottom: 1px solid var(--border-color); background: var(--subtle-fg); }
		.mpx-table td { padding: 12px 14px; font-size: 13px; color: var(--text-color); border-bottom: 1px solid var(--border-color); vertical-align: middle; }
		.mpx-table tbody tr:last-child td { border-bottom: 0; }
		.mpx-muted { color: var(--text-muted); }
		.mpx-code { font-family: var(--font-stack-monospace, monospace); font-weight: 600; letter-spacing: .5px; }
		.mpx-copy { border: 0; background: none; color: var(--text-muted); cursor: pointer; padding: 0 0 0 6px; }
		.mpx-copy:hover { color: var(--text-color); }
		.mpx-badge { padding:4px 12px; border-radius:12px; font-size:12px; font-weight:600; white-space:nowrap; }
		.mpx-badge-recorded { background:#16a08520; color:#16a085; }
		.mpx-badge-unrecorded { background:#f39c1220; color:#b9770e; }
		.mpx-link { cursor:pointer; color: var(--text-color); }
		.mpx-link:hover { text-decoration: underline; }
		.mpx-pagination { padding:14px 18px; border-top:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
		.mpx-pagination-meta { color:var(--text-muted); font-size:13px; }
		.mpx-pagination-actions { display:flex; align-items:center; gap:8px; }
		@media (max-width: 900px) {
			.mpx-filter-grid { grid-template-columns:repeat(2, minmax(0, 1fr)); }
			.mpx-filter-search, .mpx-filter-actions { grid-column:1 / -1; }
		}
	</style>

	<div class="mpx-page">
		<div class="mpx-card">
			<div class="mpx-card-header">
				<span>M-Pesa Paybill Payments</span>
				<div class="mpx-totals"></div>
			</div>
			<div class="mpx-filters">
				<div class="mpx-filter-grid">
					<div class="mpx-filter-field mpx-filter-search">
						<label>Search</label>
						<input type="search" class="form-control" data-filter="search" placeholder="M-Pesa code, account number (QTN…) or payer name">
					</div>
					<div class="mpx-filter-field">
						<label>Status</label>
						<select class="form-control" data-filter="status">
							<option value="">All</option>
							<option value="unrecorded">Not recorded</option>
							<option value="recorded">Recorded</option>
						</select>
					</div>
					<div class="mpx-filter-field">
						<label>From Date</label>
						<input type="date" class="form-control" data-filter="from_date" value="${today}">
					</div>
					<div class="mpx-filter-field">
						<label>To Date</label>
						<input type="date" class="form-control" data-filter="to_date" value="${today}">
					</div>
					<div class="mpx-filter-actions">
						<button class="btn btn-primary mpx-filter-apply">Search</button>
						<button class="btn btn-default mpx-filter-clear">Clear</button>
					</div>
				</div>
			</div>
			<div class="mpx-table-scroll">
				<table class="mpx-table">
					<thead>
						<tr>
							<th>Received</th>
							<th>M-Pesa Code</th>
							<th style="text-align:right;">Amount</th>
							<th>Account No.</th>
							<th>Quotation</th>
							<th>Paid By</th>
							<th>Status</th>
						</tr>
					</thead>
					<tbody class="mpx-table-body"></tbody>
				</table>
			</div>
			<div class="mpx-pagination"></div>
		</div>
	</div>
	`);

	bind_mpesa_transactions_events(page, $body);
	load_mpesa_transactions(page, 1);
}

function render_mpesa_transaction_rows(rows) {
	if (!rows.length) {
		return `
			<tr>
				<td colspan="7" class="mpx-muted" style="text-align:center;padding:24px;">
					No M-Pesa payments for these filters.
				</td>
			</tr>
		`;
	}

	let esc = frappe.utils.escape_html;
	return rows.map(row => {
		let quotation_cell = row.quotation
			? `<a class="mpx-link" data-route="quotation-manager" data-name="${esc(row.quotation)}">${esc(row.quotation)}</a>`
			: '<span class="mpx-muted">—</span>';

		// Recorded = a live Payments row claimed this code (see mpesa_link.py). Link to the
		// job card it paid, or to the Payments page when it's still an unallocated deposit.
		let status_cell;
		if (row.payment) {
			let target = row.job_card
				? `<a class="mpx-link" data-route="job-card-detail" data-name="${esc(row.job_card)}">${esc(row.job_card)}</a>`
				: `<a class="mpx-link" data-route="payments-page">Payment #${esc(row.payment)}</a>`;
			status_cell = `<span class="mpx-badge mpx-badge-recorded">Recorded</span> <span class="mpx-muted" style="margin-left:6px;">${target}</span>`;
		} else {
			status_cell = '<span class="mpx-badge mpx-badge-unrecorded">Not recorded</span>';
		}

		return `
			<tr>
				<td style="white-space:nowrap;">${esc(row.received_at ? frappe.datetime.str_to_user(row.received_at) : '-')}</td>
				<td style="white-space:nowrap;">
					<span class="mpx-code">${esc(row.mpesa_code || '-')}</span>
					${row.mpesa_code ? `<button class="mpx-copy" data-code="${esc(row.mpesa_code)}" title="Copy M-Pesa code"><i class="fa fa-copy"></i></button>` : ''}
				</td>
				<td style="text-align:right;font-weight:600;white-space:nowrap;">${format_currency(row.amount || 0, 'KES')}</td>
				<td>${esc(row.account_number || '-')}</td>
				<td>${quotation_cell}</td>
				<td>${esc(row.paid_by || '-')}</td>
				<td style="white-space:nowrap;">${status_cell}</td>
			</tr>
		`;
	}).join('');
}

function render_mpesa_transaction_totals(page, totals) {
	totals = totals || {};
	let pills = [];
	if (totals.unrecorded_count) {
		pills.push(`<span class="mpx-pill mpx-pill-warn"><span class="mpx-pill-label">Not recorded (${totals.unrecorded_count})</span>${format_currency(totals.unrecorded_amount || 0, 'KES')}</span>`);
	}
	pills.push(`<span class="mpx-pill mpx-pill-total"><span class="mpx-pill-label">Received (${totals.count || 0})</span>${format_currency(totals.amount || 0, 'KES')}</span>`);
	$(page.body).find('.mpx-totals').html(pills.join(''));
}

function bind_mpesa_transactions_events(page, $body) {
	$body.off('.mpesaTransactions');

	$body.on('click.mpesaTransactions', '.mpx-filter-apply', function() {
		load_mpesa_transactions(page, 1);
	});

	$body.on('click.mpesaTransactions', '.mpx-filter-clear', function() {
		let today = frappe.datetime.get_today();
		$body.find('[data-filter="search"]').val('');
		$body.find('[data-filter="status"]').val('');
		$body.find('[data-filter="from_date"]').val(today);
		$body.find('[data-filter="to_date"]').val(today);
		load_mpesa_transactions(page, 1);
	});

	$body.on('change.mpesaTransactions', '[data-filter="status"], [data-filter="from_date"], [data-filter="to_date"]', function() {
		load_mpesa_transactions(page, 1);
	});

	$body.on('keydown.mpesaTransactions', '.mpx-filters input', function(event) {
		if (event.key === 'Enter') {
			load_mpesa_transactions(page, 1);
		}
	});

	$body.on('input.mpesaTransactions', '[data-filter="search"]', function() {
		clearTimeout(page._mpesa_search_timer);
		page._mpesa_search_timer = setTimeout(function() {
			load_mpesa_transactions(page, 1);
		}, 350);
	});

	$body.on('click.mpesaTransactions', '.mpx-copy', function() {
		frappe.utils.copy_to_clipboard($(this).attr('data-code'));
	});

	$body.on('click.mpesaTransactions', '.mpx-link', function(event) {
		event.preventDefault();
		let route = $(this).attr('data-route');
		let name = $(this).attr('data-name');
		name ? frappe.set_route(route, name) : frappe.set_route(route);
	});

	$body.on('click.mpesaTransactions', '.mpx-pagination-prev', function() {
		let state = get_mpesa_transactions_state(page);
		if (state.page > 1) {
			load_mpesa_transactions(page, state.page - 1);
		}
	});

	$body.on('click.mpesaTransactions', '.mpx-pagination-next', function() {
		let state = get_mpesa_transactions_state(page);
		if (state.has_next) {
			load_mpesa_transactions(page, state.page + 1);
		}
	});
}

function load_mpesa_transactions(page, page_number) {
	let state = get_mpesa_transactions_state(page);
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

	$body.find('.mpx-table-body').html(`
		<tr><td colspan="7" class="mpx-muted" style="text-align:center;padding:32px;">Loading M-Pesa payments...</td></tr>
	`);

	frappe.call({
		method: 'crystal_alluminium_works.mpesa_link.get_mpesa_transactions_page',
		args: {
			search: $body.find('[data-filter="search"]').val() || '',
			status: $body.find('[data-filter="status"]').val() || '',
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
			state.page_length = result.page_length || MPESA_TRANSACTIONS_PAGE_LENGTH;
			state.total_count = result.total_count || 0;
			state.has_next = !!result.has_next;

			$body.find('.mpx-table-body').html(render_mpesa_transaction_rows(result.rows || []));
			render_mpesa_transaction_totals(page, result.totals);
			render_mpesa_transactions_pagination(page);
			$body.find('.mpx-table-scroll').scrollTop(0);
		}
	});
}

function render_mpesa_transactions_pagination(page) {
	let state = get_mpesa_transactions_state(page);
	let start = state.total_count ? ((state.page - 1) * state.page_length) + 1 : 0;
	let end = Math.min(state.page * state.page_length, state.total_count);
	let total_pages = Math.max(Math.ceil(state.total_count / state.page_length), 1);

	$(page.body).find('.mpx-pagination').html(`
		<div class="mpx-pagination-meta">Showing ${start}-${end} of ${state.total_count} M-Pesa payments</div>
		<div class="mpx-pagination-actions">
			<button class="btn btn-default mpx-pagination-prev" ${state.page <= 1 ? 'disabled' : ''}>Previous</button>
			<span class="mpx-muted" style="min-width:70px;text-align:center;">Page ${state.page} of ${total_pages}</span>
			<button class="btn btn-default mpx-pagination-next" ${!state.has_next ? 'disabled' : ''}>Next</button>
		</div>
	`);
}
