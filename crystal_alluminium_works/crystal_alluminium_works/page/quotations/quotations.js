frappe.pages['quotations'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Quotations',
		single_column: true
	});

	page.set_secondary_action('Back to Dashboard', function() {
		frappe.set_route('crystal-aluminium-wo');
	});

	wrapper.quotations_page = page;
	$(page.body).html(get_quotations_html());
	bind_quotations_events(page);
	load_quotations(page, 1);
};

function get_quotations_state(page) {
	if (!page.quotations_state) {
		page.quotations_state = {
			page: 1,
			page_length: 20
		};
	}
	return page.quotations_state;
}

function bind_quotations_events(page) {
	let $body = $(page.body);

	$body.on('click', '.quo-list-apply', function() {
		load_quotations(page, 1);
	});

	$body.on('click', '.quo-list-clear', function() {
		$body.find('[data-filter="search"]').val('');
		$body.find('[data-filter="customer"]').val('');
		$body.find('[data-filter="status"]').val('All');
		$body.find('[data-filter="from_date"]').val('');
		$body.find('[data-filter="to_date"]').val('');
		load_quotations(page, 1);
	});

	$body.on('keydown', '.quo-list-filters input', function(e) {
		if (e.key === 'Enter') {
			load_quotations(page, 1);
		}
	});

	$body.on('click', '.quo-list-prev', function() {
		let state = get_quotations_state(page);
		if (state.page > 1) {
			load_quotations(page, state.page - 1);
		}
	});

	$body.on('click', '.quo-list-next', function() {
		let state = get_quotations_state(page);
		if (state.has_next) {
			load_quotations(page, state.page + 1);
		}
	});

	$body.on('click', '.quo-list-row', function() {
		let name = $(this).data('name');
		if (name) {
			frappe.set_route('quotation-manager', name);
		}
	});
}

function load_quotations(page, page_number) {
	let state = get_quotations_state(page);
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

	$body.find('.quo-list-body').html(`
		<tr>
			<td colspan="5" style="padding:24px; text-align:center; color:var(--text-muted);">
				Loading quotations...
			</td>
		</tr>
	`);

	frappe.call({
		method: 'crystal_alluminium_works.api.get_quotations_page',
		args: filters,
		callback: function(r) {
			let message = r.message || {};
			let rows = message.rows || [];

			state.page = message.page || 1;
			state.page_length = message.page_length || state.page_length;
			state.total_count = message.total_count || 0;
			state.has_next = !!message.has_next;

			render_quotations_table(page, rows);
			render_quotations_pagination(page);
		}
	});
}

function render_quotations_table(page, rows) {
	let $body = $(page.body).find('.quo-list-body');

	if (!rows.length) {
		$body.html(`
			<tr>
				<td colspan="5" style="padding:24px; text-align:center; color:var(--text-muted);">
					No quotations match the current filters.
				</td>
			</tr>
		`);
		return;
	}

	let html = rows.map(function(quotation) {
		let status_color = {
			'Draft': '#f39c12',
			'Open': '#3498db',
			'Partially Ordered': '#16a085',
			'Ordered': '#2ecc71',
			'Lost': '#e74c3c',
			'Expired': '#95a5a6',
			'Cancelled': '#7f8c8d'
		}[quotation.status] || '#7f8c8d';

		return `
			<tr class="quo-list-row" data-name="${quotation.name}" style="cursor:pointer;">
				<td style="padding:12px 16px; font-weight:600; color:var(--primary);">${quotation.name}</td>
				<td style="padding:12px 16px; font-weight:500;">${quotation.customer_name || quotation.party_name || '—'}</td>
				<td style="padding:12px 16px;">${quotation.transaction_date ? frappe.datetime.str_to_user(quotation.transaction_date) : '—'}</td>
				<td style="padding:12px 16px; text-align:right; font-weight:600;">${format_currency(quotation.grand_total || 0, quotation.currency || 'KES')}</td>
				<td style="padding:12px 16px; text-align:center;">
					<span style="background:${status_color}20; color:${status_color}; padding:4px 12px; border-radius:12px; font-size:12px; font-weight:600;">
						${quotation.status || '—'}
					</span>
				</td>
			</tr>
		`;
	}).join('');

	$body.html(html);
}

function render_quotations_pagination(page) {
	let state = get_quotations_state(page);
	let start = state.total_count ? ((state.page - 1) * state.page_length) + 1 : 0;
	let end = Math.min(state.page * state.page_length, state.total_count || 0);

	$(page.body).find('.quo-list-pagination').html(`
		<div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
			<div style="font-size:13px; color:var(--text-muted);">
				Showing ${start}-${end} of ${state.total_count || 0} quotations
			</div>
			<div style="display:flex; align-items:center; gap:8px;">
				<button class="btn btn-default quo-list-prev" ${state.page <= 1 ? 'disabled' : ''}>Previous</button>
				<span style="font-size:13px; color:var(--text-color);">Page ${state.page}</span>
				<button class="btn btn-default quo-list-next" ${!state.has_next ? 'disabled' : ''}>Next</button>
			</div>
		</div>
	`);
}

function get_quotations_html() {
	return `
	<style>
		.quo-list-page {
			max-width: 1100px;
			margin: 0 auto;
			padding: 20px 16px;
			font-family: var(--font-stack);
		}

		.quo-list-hero {
			margin-bottom: 24px;
		}

		.quo-list-hero h2 {
			margin: 0 0 8px;
			font-size: 26px;
			font-weight: 700;
			color: var(--heading-color);
		}

		.quo-list-hero p {
			margin: 0;
			color: var(--text-muted);
			font-size: 14px;
		}

		.quo-list-filters,
		.quo-list-table-wrap {
			background: var(--card-bg);
			border: 1px solid var(--border-color);
			border-radius: 12px;
			box-shadow: var(--shadow-sm);
		}

		.quo-list-filters {
			padding: 18px;
			margin-bottom: 20px;
		}

		.quo-list-filter-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
			gap: 12px;
		}

		.quo-list-filter-actions {
			display: flex;
			justify-content: flex-end;
			gap: 10px;
			margin-top: 14px;
		}

		.quo-list-table {
			width: 100%;
			min-width: 860px;
			border-collapse: collapse;
		}

		.quo-list-table thead th {
			padding: 12px 16px;
			font-size: 12px;
			font-weight: 600;
			color: var(--text-muted);
			text-transform: uppercase;
			letter-spacing: 0.5px;
			background: var(--subtle-fg);
			border-bottom: 1px solid var(--border-color);
			position: sticky;
			top: 0;
			z-index: 1;
		}

		.quo-list-table tbody tr:not(:last-child) td {
			border-bottom: 1px solid var(--border-color);
		}

		.quo-list-table tbody tr:hover {
			background: var(--subtle-fg);
		}

		.quo-list-pagination {
			padding: 16px 18px;
			border-top: 1px solid var(--border-color);
		}

		.quo-list-table-scroll {
			overflow: auto;
			max-height: 60vh;
			border-radius: 12px 12px 0 0;
		}
	</style>

	<div class="quo-list-page">
		<div class="quo-list-hero">
			<h2>Quotations</h2>
		</div>

		<div class="quo-list-filters">
			<div class="quo-list-filter-grid">
				<div>
					<label class="control-label">Search</label>
					<input type="text" class="form-control" data-filter="search" placeholder="Quotation, customer, order type">
				</div>
				<div>
					<label class="control-label">Customer</label>
					<input type="text" class="form-control" data-filter="customer" placeholder="Exact party ID">
				</div>
				<div>
					<label class="control-label">Status</label>
					<select class="form-control" data-filter="status">
						<option>All</option>
						<option>Draft</option>
						<option>Open</option>
						<option>Partially Ordered</option>
						<option>Ordered</option>
						<option>Lost</option>
						<option>Expired</option>
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
			<div class="quo-list-filter-actions">
				<button class="btn btn-default quo-list-clear">Clear</button>
				<button class="btn btn-primary quo-list-apply">Apply Filters</button>
			</div>
		</div>

		<div class="quo-list-table-wrap">
			<div class="quo-list-table-scroll">
				<table class="quo-list-table">
					<thead>
						<tr>
							<th>Quotation</th>
							<th>Customer</th>
							<th>Date</th>
							<th style="text-align:right;">Total</th>
							<th style="text-align:center;">Status</th>
						</tr>
					</thead>
					<tbody class="quo-list-body">
						<tr>
							<td colspan="5" style="padding:24px; text-align:center; color:var(--text-muted);">
								Loading quotations...
							</td>
						</tr>
					</tbody>
				</table>
			</div>
			<div class="quo-list-pagination"></div>
		</div>
	</div>
	`;
}
