frappe.pages['sales-orders'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Sales Orders',
		single_column: true
	});

	page.set_secondary_action('Back to Dashboard', function() {
		frappe.set_route('crystal-aluminium-wo');
	});

	wrapper.sales_orders_page = page;
	$(page.body).html(get_sales_orders_html());
	bind_sales_orders_events(page);
	load_sales_orders(page, 1);
};

function get_sales_orders_state(page) {
	if (!page.sales_orders_state) {
		page.sales_orders_state = {
			page: 1,
			page_length: 20
		};
	}
	return page.sales_orders_state;
}

function bind_sales_orders_events(page) {
	let $body = $(page.body);

	$body.on('click', '.so-list-apply', function() {
		load_sales_orders(page, 1);
	});

	$body.on('click', '.so-list-clear', function() {
		$body.find('[data-filter="search"]').val('');
		$body.find('[data-filter="customer"]').val('');
		$body.find('[data-filter="status"]').val('All');
		$body.find('[data-filter="from_date"]').val('');
		$body.find('[data-filter="to_date"]').val('');
		load_sales_orders(page, 1);
	});

	$body.on('keydown', '.so-list-filters input', function(e) {
		if (e.key === 'Enter') {
			load_sales_orders(page, 1);
		}
	});

	$body.on('click', '.so-list-prev', function() {
		let state = get_sales_orders_state(page);
		if (state.page > 1) {
			load_sales_orders(page, state.page - 1);
		}
	});

	$body.on('click', '.so-list-next', function() {
		let state = get_sales_orders_state(page);
		if (state.has_next) {
			load_sales_orders(page, state.page + 1);
		}
	});

	$body.on('click', '.so-list-row', function() {
		let name = $(this).data('name');
		if (name) {
			frappe.set_route('sales-order-manager', name);
		}
	});
}

function load_sales_orders(page, page_number) {
	let state = get_sales_orders_state(page);
	let $body = $(page.body);

	state.page = page_number || 1;

	let filters = {
		search: $body.find('[data-filter="search"]').val() || '',
		customer: $body.find('[data-filter="customer"]').val() || '',
		status: $body.find('[data-filter="status"]').val() || 'All',
		from_date: $body.find('[data-filter="from_date"]').val() || '',
		to_date: $body.find('[data-filter="to_date"]').val() || '',
		page: state.page,
		page_length: state.page_length
	};

	$body.find('.so-list-body').html(`
		<tr>
			<td colspan="5" style="padding:24px; text-align:center; color:var(--text-muted);">
				Loading sales orders...
			</td>
		</tr>
	`);

	frappe.call({
		method: 'crystal_alluminium_works.api.get_sales_orders_page',
		args: filters,
		callback: function(r) {
			let message = r.message || {};
			let rows = message.rows || [];

			state.page = message.page || 1;
			state.page_length = message.page_length || state.page_length;
			state.total_count = message.total_count || 0;
			state.has_next = !!message.has_next;

			render_sales_orders_table(page, rows);
			render_sales_orders_pagination(page);
		}
	});
}

function render_sales_orders_table(page, rows) {
	let $body = $(page.body).find('.so-list-body');

	if (!rows.length) {
		$body.html(`
			<tr>
				<td colspan="5" style="padding:24px; text-align:center; color:var(--text-muted);">
					No sales orders match the current filters.
				</td>
			</tr>
		`);
		return;
	}

	let html = rows.map(function(so) {
		let status_color = {
			'Draft': '#f39c12',
			'To Deliver and Bill': '#3498db',
			'To Bill': '#2980b9',
			'Completed': '#2ecc71',
			'Cancelled': '#95a5a6',
			'Closed': '#7f8c8d'
		}[so.status] || '#7f8c8d';

		return `
			<tr class="so-list-row" data-name="${so.name}" style="cursor:pointer;">
				<td style="padding:12px 16px; font-weight:600; color:var(--primary);">${so.name}</td>
				<td style="padding:12px 16px;">
					<div style="font-weight:500;">${so.customer_name || so.customer || '—'}</div>
					<div style="font-size:12px; color:var(--text-muted);">${so.customer || ''}</div>
				</td>
				<td style="padding:12px 16px;">${so.transaction_date ? frappe.datetime.str_to_user(so.transaction_date) : '—'}</td>
				<td style="padding:12px 16px; text-align:right; font-weight:600;">${format_currency(so.grand_total || 0, so.currency || 'KES')}</td>
				<td style="padding:12px 16px; text-align:center;">
					<span style="background:${status_color}20; color:${status_color}; padding:4px 12px; border-radius:12px; font-size:12px; font-weight:600;">
						${so.status || '—'}
					</span>
				</td>
			</tr>
		`;
	}).join('');

	$body.html(html);
}

function render_sales_orders_pagination(page) {
	let state = get_sales_orders_state(page);
	let start = state.total_count ? ((state.page - 1) * state.page_length) + 1 : 0;
	let end = Math.min(state.page * state.page_length, state.total_count || 0);

	$(page.body).find('.so-list-pagination').html(`
		<div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
			<div style="font-size:13px; color:var(--text-muted);">
				Showing ${start}-${end} of ${state.total_count || 0} sales orders
			</div>
			<div style="display:flex; align-items:center; gap:8px;">
				<button class="btn btn-default so-list-prev" ${state.page <= 1 ? 'disabled' : ''}>Previous</button>
				<span style="font-size:13px; color:var(--text-color);">Page ${state.page}</span>
				<button class="btn btn-default so-list-next" ${!state.has_next ? 'disabled' : ''}>Next</button>
			</div>
		</div>
	`);
}

function get_sales_orders_html() {
	return `
	<style>
		.so-list-page {
			max-width: 1100px;
			margin: 0 auto;
			padding: 20px 16px;
			font-family: var(--font-stack);
		}

		.so-list-hero {
			margin-bottom: 24px;
		}

		.so-list-hero h2 {
			margin: 0 0 8px;
			font-size: 26px;
			font-weight: 700;
			color: var(--heading-color);
		}

		.so-list-hero p {
			margin: 0;
			color: var(--text-muted);
			font-size: 14px;
		}

		.so-list-filters,
		.so-list-table-wrap {
			background: var(--card-bg);
			border: 1px solid var(--border-color);
			border-radius: 12px;
			box-shadow: var(--shadow-sm);
		}

		.so-list-filters {
			padding: 18px;
			margin-bottom: 20px;
		}

		.so-list-filter-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
			gap: 12px;
		}

		.so-list-filter-actions {
			display: flex;
			justify-content: flex-end;
			gap: 10px;
			margin-top: 14px;
		}

		.so-list-table {
			width: 100%;
			border-collapse: collapse;
		}

		.so-list-table thead th {
			padding: 12px 16px;
			font-size: 12px;
			font-weight: 600;
			color: var(--text-muted);
			text-transform: uppercase;
			letter-spacing: 0.5px;
			background: var(--subtle-fg);
			border-bottom: 1px solid var(--border-color);
		}

		.so-list-table tbody tr:not(:last-child) td {
			border-bottom: 1px solid var(--border-color);
		}

		.so-list-table tbody tr:hover {
			background: var(--subtle-fg);
		}

		.so-list-pagination {
			padding: 16px 18px;
			border-top: 1px solid var(--border-color);
		}
	</style>

	<div class="so-list-page">
		<div class="so-list-hero">
			<h2>Sales Orders</h2>
			<p>Review customer orders without exposing the full ERPNext sales order list.</p>
		</div>

		<div class="so-list-filters">
			<div class="so-list-filter-grid">
				<div>
					<label class="control-label">Search</label>
					<input type="text" class="form-control" data-filter="search" placeholder="Sales Order, customer, PO number">
				</div>
				<div>
					<label class="control-label">Customer</label>
					<input type="text" class="form-control" data-filter="customer" placeholder="Exact customer ID">
				</div>
				<div>
					<label class="control-label">Status</label>
					<select class="form-control" data-filter="status">
						<option>All</option>
						<option>Draft</option>
						<option>To Deliver and Bill</option>
						<option>To Bill</option>
						<option>Completed</option>
						<option>Closed</option>
						<option>Cancelled</option>
					</select>
				</div>
				<div>
					<label class="control-label">From Date</label>
					<input type="date" class="form-control" data-filter="from_date">
				</div>
				<div>
					<label class="control-label">To Date</label>
					<input type="date" class="form-control" data-filter="to_date">
				</div>
			</div>
			<div class="so-list-filter-actions">
				<button class="btn btn-default so-list-clear">Clear</button>
				<button class="btn btn-primary so-list-apply">Apply Filters</button>
			</div>
		</div>

		<div class="so-list-table-wrap">
			<table class="so-list-table">
				<thead>
					<tr>
						<th>Sales Order</th>
						<th>Customer</th>
						<th>Date</th>
						<th style="text-align:right;">Total</th>
						<th style="text-align:center;">Status</th>
					</tr>
				</thead>
				<tbody class="so-list-body">
					<tr>
						<td colspan="5" style="padding:24px; text-align:center; color:var(--text-muted);">
							Loading sales orders...
						</td>
					</tr>
				</tbody>
			</table>
			<div class="so-list-pagination"></div>
		</div>
	</div>
	`;
}
