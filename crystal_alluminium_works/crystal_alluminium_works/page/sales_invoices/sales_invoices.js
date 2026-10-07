frappe.pages['sales-invoices'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Invoices',
		single_column: true,
	});

	wrapper.sales_invoices_page = page;
	$(page.body).html(get_sales_invoices_html());
	// Open on today's invoices; Clear empties the dates to show everything.
	let today = frappe.datetime.get_today();
	$(page.body).find('[data-filter="from_date"], [data-filter="to_date"]').val(today);
	bind_sales_invoices_events(page);
	page.caw_skip_next_show = true;
	load_sales_invoices(page, 1);
};

// Reload when returning to this page (e.g. after converting a quotation in another page), keeping
// the current filters and page number. on_page_load already loaded the first view, so the show
// that immediately follows it is skipped.
frappe.pages['sales-invoices'].on_page_show = function(wrapper) {
	let page = wrapper.sales_invoices_page;
	if (!page) return;
	if (page.caw_skip_next_show) {
		page.caw_skip_next_show = false;
		return;
	}
	load_sales_invoices(page, get_sales_invoices_state(page).page || 1);
};


const SALES_INVOICES_VAT_RATE = 0.16;

function sales_invoice_row_uses_visual_vat(invoice) {
	return flt(invoice.total_taxes_and_charges || 0) === 0;
}

function get_sales_invoice_row_display_total(invoice) {
	let total = flt(invoice.grand_total || 0);
	return sales_invoice_row_uses_visual_vat(invoice) ? flt(total * (1 + SALES_INVOICES_VAT_RATE)) : total;
}

function get_sales_invoice_row_display_outstanding(invoice) {
	let outstanding = flt(invoice.outstanding_amount || 0);
	return sales_invoice_row_uses_visual_vat(invoice) ? flt(outstanding * (1 + SALES_INVOICES_VAT_RATE)) : outstanding;
}

function get_sales_invoices_state(page) {
	if (!page.sales_invoices_state) {
		page.sales_invoices_state = {
			page: 1,
			page_length: 20,
			filter_timer: null,
		};
	}
	return page.sales_invoices_state;
}

function bind_sales_invoices_events(page) {
	let $body = $(page.body);
	let state = get_sales_invoices_state(page);

	// Downloads what the filters currently select (all pages, not just the one shown) as a
	// Crystal-styled PDF — streamed by the server, nothing is saved.
	$body.on('click', '.si-list-download', function() {
		let args = get_sales_invoices_filters(page);
		window.open(frappe.urllib.get_full_url(
			`/api/method/crystal_alluminium_works.api.download_sales_invoices_pdf?${$.param(args)}`
		), '_blank');
	});

	$body.on('click', '.si-list-clear', function() {
		$body.find('[data-filter="search"]').val('');
		$body.find('[data-filter="status"]').val('All');
		$body.find('[data-filter="from_date"]').val('');
		$body.find('[data-filter="to_date"]').val('');
		load_sales_invoices(page, 1);
	});

	$body.on('input', '[data-filter="search"]', function() {
		clearTimeout(state.filter_timer);
		state.filter_timer = setTimeout(function() {
			load_sales_invoices(page, 1);
		}, 250);
	});

	$body.on('change', '[data-filter="status"], [data-filter="from_date"], [data-filter="to_date"]', function() {
		load_sales_invoices(page, 1);
	});

	$body.on('keydown', '.si-list-filters input', function(e) {
		if (e.key === 'Enter') {
			clearTimeout(state.filter_timer);
			load_sales_invoices(page, 1);
		}
	});

	$body.on('click', '.si-list-prev', function() {
		let state = get_sales_invoices_state(page);
		if (state.page > 1) {
			load_sales_invoices(page, state.page - 1);
		}
	});

	$body.on('click', '.si-list-next', function() {
		let state = get_sales_invoices_state(page);
		if (state.has_next) {
			load_sales_invoices(page, state.page + 1);
		}
	});

	$body.on('click', '.si-list-row', function() {
		let name = $(this).data('name');
		if (name) {
			frappe.set_route('sales-invoice-manager', name, 'Cheque');
		}
	});
}

function get_sales_invoices_filters(page) {
	let $body = $(page.body);
	return {
		search: $body.find('[data-filter="search"]').val() || '',
		status: $body.find('[data-filter="status"]').val() || 'All',
		from_date: $body.find('[data-filter="from_date"]').val() || '',
		to_date: $body.find('[data-filter="to_date"]').val() || '',
		payment_mode: 'Cheque',
	};
}

function load_sales_invoices(page, page_number) {
	let state = get_sales_invoices_state(page);
	let $body = $(page.body);

	state.page = page_number || 1;

	let filters = Object.assign(get_sales_invoices_filters(page), {
		page: state.page,
		page_length: state.page_length,
	});

	$body.find('.si-list-foot').empty();
	$body.find('.si-list-body').html(`
		<tr>
			<td colspan="7" style="padding:24px; text-align:center; color:var(--text-muted);">
				Loading invoices...
			</td>
		</tr>
	`);

	frappe.call({
		method: 'crystal_alluminium_works.api.get_sales_invoices_page',
		args: filters,
		callback: function(r) {
			let message = r.message || {};
			let rows = message.rows || [];

			state.page = message.page || 1;
			state.page_length = message.page_length || state.page_length;
			state.total_count = message.total_count || 0;
			state.has_next = !!message.has_next;
			state.total_amount = message.total_amount || 0;
			state.total_balance = message.total_balance || 0;

			render_sales_invoices_table(page, rows);
			render_sales_invoices_totals(page, rows);
			render_sales_invoices_pagination(page);
		},
	});
}

function render_sales_invoices_table(page, rows) {
	let $body = $(page.body).find('.si-list-body');

	if (!rows.length) {
		$body.html(`
		<tr>
			<td colspan="7" style="padding:24px; text-align:center; color:var(--text-muted);">
				No invoices match the current filters.
			</td>
		</tr>
		`);
		return;
	}

	let html = rows.map(function(invoice) {
		// The invoice's own status shows "Paid" once generated so warehouse staff
		// can use it to release goods, even if the Job Card behind it (this
		// company's real payment source of truth) still has a balance owing —
		// show that balance status here instead of the invoice's own status.
		let display_status = invoice.job_card_balance_status || invoice.status;
		let status_color = get_sales_invoice_status_color(display_status);
		let source = invoice.custom_source_quotation || 'Direct / Sales Order';

		return `
			<tr class="si-list-row" data-name="${invoice.name}" style="cursor:pointer;">
				<td style="padding:12px 16px;">
					<div style="font-weight:600;">${invoice.customer_name || invoice.customer || '—'}</div>
				</td>
				<td style="padding:12px 16px; font-weight:600; color:var(--primary);">${invoice.name}</td>
				<td style="padding:12px 16px;">
					<div>${invoice.posting_date ? frappe.datetime.str_to_user(invoice.posting_date) : '—'}</div>
				</td>
				<td style="padding:12px 16px; text-align:right;">
					<div style="font-weight:600;">${format_currency(get_sales_invoice_row_display_total(invoice), invoice.currency || 'KES')}</div>
				</td>
				<td style="padding:12px 16px; text-align:right;">
					<div style="font-weight:600;">${format_currency(get_sales_invoice_row_display_outstanding(invoice), invoice.currency || 'KES')}</div>
				</td>
				<td style="padding:12px 16px;">
					<div style="font-size:13px;">${invoice.pin || '—'}</div>
				</td>
				<td style="padding:12px 16px; text-align:center;">
					<span style="background:${status_color}20; color:${status_color}; padding:4px 12px; border-radius:12px; font-size:12px; font-weight:600;">
						${display_status || '—'}
					</span>
				</td>
			</tr>
		`;
	}).join('');

	$body.html(html);
}

// Totals span every page the filters match (summed server-side), lined up under their columns.
// Cancelled invoices are not counted.
function render_sales_invoices_totals(page, rows) {
	let state = get_sales_invoices_state(page);
	let $foot = $(page.body).find('.si-list-foot');
	if (!rows.length) {
		$foot.empty();
		return;
	}
	$foot.html(`
		<tr>
			<td colspan="3" style="padding:12px 16px; font-weight:700;">Total</td>
			<td style="padding:12px 16px; text-align:right; font-weight:700;">${format_currency(state.total_amount || 0, 'KES')}</td>
			<td style="padding:12px 16px; text-align:right; font-weight:700;">${format_currency(state.total_balance || 0, 'KES')}</td>
			<td colspan="2"></td>
		</tr>
	`);
}

function render_sales_invoices_pagination(page) {
	let state = get_sales_invoices_state(page);
	let start = state.total_count ? ((state.page - 1) * state.page_length) + 1 : 0;
	let end = Math.min(state.page * state.page_length, state.total_count || 0);

	$(page.body).find('.si-list-pagination').html(`
		<div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
			<div style="font-size:13px; color:var(--text-muted);">
				Showing ${start}-${end} of ${state.total_count || 0} invoices
			</div>
			<div style="display:flex; align-items:center; gap:8px;">
				<button class="btn btn-default si-list-prev" ${state.page <= 1 ? 'disabled' : ''}>Previous</button>
				<span style="font-size:13px; color:var(--text-color);">Page ${state.page}</span>
				<button class="btn btn-default si-list-next" ${!state.has_next ? 'disabled' : ''}>Next</button>
			</div>
		</div>
	`);
}

function get_sales_invoice_status_color(status) {
	return {
		'Draft': '#f39c12',
		'Submitted': '#3498db',
		'Paid': '#2ecc71',
		'Partly Paid': '#16a085',
		'Unpaid': '#e67e22',
		'Overdue': '#e74c3c',
		'Return': '#8e44ad',
		'Credit Note Issued': '#8e44ad',
		'Cancelled': '#7f8c8d',
	}[status] || '#7f8c8d';
}

function get_sales_invoices_html() {
	return `
	<style>
		.si-list-page {
			max-width: 1440px;
			margin: 0 auto;
			padding: 20px 20px 28px;
			font-family: var(--font-stack);
		}

		.si-list-hero {
			margin-bottom: 24px;
		}

		.si-list-hero h2 {
			margin: 0 0 8px;
			font-size: 26px;
			font-weight: 700;
			color: var(--heading-color);
		}

		.si-list-hero p {
			margin: 0;
			color: var(--text-muted);
			font-size: 14px;
		}

		.si-list-filters,
		.si-list-table-wrap {
			background: var(--card-bg);
			border: 1px solid var(--border-color);
			border-radius: 12px;
			box-shadow: var(--shadow-sm);
		}

		.si-list-filters {
			padding: 18px;
			margin-bottom: 20px;
		}

		.si-list-filter-row {
			display: flex;
			align-items: flex-end;
			flex-wrap: wrap;
			gap: 12px;
		}

		.si-list-filter-field {
			flex: 1 1 180px;
			min-width: 160px;
		}

		.si-list-filter-actions {
			display: flex;
			align-items: flex-end;
			gap: 10px;
			margin-left: auto;
			flex: 0 0 auto;
			padding-bottom: 1px;
		}

		.si-list-table-wrap {
			overflow: hidden;
		}

		.si-list-table-scroller {
			overflow-x: auto;
		}

		.si-list-table {
			width: 100%;
			min-width: 980px;
			border-collapse: collapse;
		}

		.si-list-table thead th {
			padding: 12px 16px;
			font-size: 12px;
			font-weight: 600;
			color: var(--text-muted);
			text-transform: uppercase;
			letter-spacing: 0.5px;
			background: var(--subtle-fg);
			border-bottom: 1px solid var(--border-color);
		}

		.si-list-table tbody tr:not(:last-child) td {
			border-bottom: 1px solid var(--border-color);
		}

		.si-list-table tbody tr:hover {
			background: var(--subtle-fg);
		}

		.si-list-foot td {
			border-top: 2px solid var(--border-color);
			background: var(--subtle-fg);
		}

		.si-list-pagination {
			padding: 16px 18px;
			border-top: 1px solid var(--border-color);
		}

		@media (max-width: 980px) {
			.si-list-page {
				padding-left: 16px;
				padding-right: 16px;
			}

			.si-list-filter-actions {
				margin-left: 0;
				width: 100%;
				justify-content: flex-end;
			}
		}
	</style>

	<div class="si-list-page">
		<div class="si-list-hero">
			<h2>Invoices</h2>
		</div>

		<div class="si-list-filters">
			<div class="si-list-filter-row">
				<div class="si-list-filter-field">
					<label class="form-label">Search</label>
					<input type="text" class="form-control" data-filter="search" placeholder="Invoice, customer, quotation">
				</div>
				<div class="si-list-filter-field">
					<label class="form-label">Status</label>
					<select class="form-control" data-filter="status">
						<option>All</option>
						<option>Draft</option>
						<option>Submitted</option>
						<option>Paid</option>
						<option>Partly Paid</option>
						<option>Unpaid</option>
						<option>Overdue</option>
						<option>Cancelled</option>
					</select>
				</div>
				<div class="si-list-filter-field">
					<label class="form-label">From Date</label>
					<input type="date" class="form-control" data-filter="from_date">
				</div>
				<div class="si-list-filter-field">
					<label class="form-label">To Date</label>
					<input type="date" class="form-control" data-filter="to_date">
				</div>
				<div class="si-list-filter-actions">
					<button class="btn btn-default si-list-clear">Clear</button>
					<button class="btn btn-primary si-list-download">Download</button>
				</div>
			</div>
		</div>

		<div class="si-list-table-wrap">
			<div class="si-list-table-scroller">
				<table class="si-list-table">
					<thead>
						<tr>
							<th>Customer</th>
							<th>Invoice Number</th>
							<th>Date</th>
							<th style="text-align:right;">Amount</th>
							<th style="text-align:right;">Balance</th>
							<th>PIN</th>
							<th style="text-align:center;">Status</th>
						</tr>
					</thead>
					<tbody class="si-list-body">
						<tr>
							<td colspan="7" style="padding:24px; text-align:center; color:var(--text-muted);">
								Loading...
							</td>
						</tr>
					</tbody>
					<tfoot class="si-list-foot"></tfoot>
				</table>
			</div>
			<div class="si-list-pagination"></div>
		</div>
	</div>
	`;
}
