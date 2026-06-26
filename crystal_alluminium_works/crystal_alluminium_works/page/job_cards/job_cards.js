frappe.pages['job-cards'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Job Cards',
		single_column: true
	});

	page.set_primary_action('New Job Card', function() {
		frappe.new_doc('CAW Job Card');
	});
	page.set_secondary_action('Back to Dashboard', function() {
		frappe.set_route('crystal-aluminium-wo');
	});

	$(page.body).html(get_job_cards_html());
	bind_job_cards_events(page);
	load_job_cards(page, 1);
};

function bind_job_cards_events(page) {
	let $body = $(page.body);

	$body.on('click', '.jc-list-apply', function() {
		load_job_cards(page, 1);
	});

	$body.on('keydown', '.jc-list-filters input', function(e) {
		if (e.key === 'Enter') {
			e.preventDefault();
			load_job_cards(page, 1);
		}
	});

	$body.on('click', '.jc-list-clear', function() {
		$body.find('[data-filter="search"]').val('');
		$body.find('[data-filter="status"]').val('All');
		load_job_cards(page, 1);
	});

	$body.on('change', '[data-filter="status"]', function() {
		load_job_cards(page, 1);
	});

	$body.on('click', '.jc-row', function() {
		let name = $(this).attr('data-name');
		if (name) {
			frappe.set_route('job-card-detail', name);
		}
	});

	$body.on('click', '.btn-paging', function() {
		let page_no = cint($(this).attr('data-page') || 1);
		load_job_cards(page, page_no);
	});
}

function load_job_cards(page, page_no) {
	let $body = $(page.body);
	let $tbody = $body.find('.jc-list-body');
	let filters = {
		search: $body.find('[data-filter="search"]').val() || '',
		status: $body.find('[data-filter="status"]').val() || 'All',
		page: page_no,
		page_length: 30
	};

	$tbody.html('<tr><td colspan="9" style="padding:24px;text-align:center;color:var(--text-muted);">Loading job cards...</td></tr>');

	frappe.call({
		method: 'crystal_alluminium_works.api.get_job_cards_page',
		args: filters,
		callback: function(r) {
			let message = r.message || {};
			let rows = message.rows || [];

			if (!rows.length) {
				$tbody.html('<tr><td colspan="9" style="padding:24px;text-align:center;color:var(--text-muted);">No job cards found.</td></tr>');
				$body.find('.jc-list-pagination').html('');
				return;
			}

			$tbody.html(rows.map(row => render_job_card_row(row)).join(''));
			render_job_card_pagination($body, message);
		}
	});
}

function render_job_card_row(row) {
	return `
		<tr class="jc-row" data-name="${frappe.utils.escape_html(row.name || '')}">
			<td style="font-weight:600;">${frappe.utils.escape_html(row.name || '')}</td>
			<td>${frappe.utils.escape_html(row.quotation || '-')}</td>
			<td>${frappe.utils.escape_html(row.customer_name || row.customer || '-')}</td>
			<td>${frappe.utils.escape_html(row.payment_mode || '-')}</td>
			<td>${frappe.utils.escape_html(row.payment_option || '-')}</td>
			<td style="text-align:right;">${format_currency(row.quotation_amount || 0, 'KES')}</td>
			<td style="text-align:right;">${format_currency(row.payment_amount || 0, 'KES')}</td>
			<td style="text-align:right;font-weight:600;">${format_currency(row.balance_amount || 0, 'KES')}</td>
			<td>${render_job_card_status_pill(row.status)}</td>
		</tr>
	`;
}

function render_job_card_status_pill(status) {
	let label = status || 'Draft';
	let colors = get_job_card_status_colors(label);

	return `
		<span class="jc-status-pill" style="background:${colors.background}; color:${colors.text};">
			<span class="jc-status-dot" style="background:${colors.dot};"></span>
			${frappe.utils.escape_html(label)}
		</span>
	`;
}

function get_job_card_status_colors(status) {
	let palette = {
		'Draft': {
			background: '#fef3c7',
			text: '#b45309',
			dot: '#f59e0b'
		},
		'In Progress': {
			background: '#dbeafe',
			text: '#1d4ed8',
			dot: '#3b82f6'
		},
		'Completed': {
			background: '#dcfce7',
			text: '#166534',
			dot: '#22c55e'
		},
		'Cancelled': {
			background: '#fee2e2',
			text: '#b91c1c',
			dot: '#ef4444'
		}
	};

	return palette[status] || {
		background: 'var(--subtle-fg)',
		text: 'var(--text-color)',
		dot: 'var(--text-muted)'
	};
}

function render_job_card_pagination($body, message) {
	let html = '';
	let page_no = cint(message.page || 1);
	if (page_no > 1) {
		html += `<button class="btn btn-default btn-sm btn-paging" data-page="${page_no - 1}">Previous</button> `;
	}
	if (message.has_next) {
		html += `<button class="btn btn-default btn-sm btn-paging" data-page="${page_no + 1}">Next</button>`;
	}
	$body.find('.jc-list-pagination').html(html);
}

function get_job_cards_html() {
	return `
	<style>
		.jc-list-page { max-width: 100%; margin: 0 auto; padding: 24px 16px; }
		.jc-list-hero { margin-bottom: 24px; }
		.jc-list-hero h2 { margin: 0 0 6px; font-size: 24px; font-weight: 700; color: var(--heading-color); }
		.jc-list-hero p { margin: 0; font-size: 14px; color: var(--text-muted); }
		.jc-list-filters { padding: 18px; margin-bottom: 24px; background: var(--fg-color); border: 1px solid var(--border-color); border-radius: 8px; box-shadow: var(--shadow-xs); }
		.jc-list-filter-grid { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(220px, 1fr) auto; align-items: end; gap: 16px; }
		.jc-list-filter-actions { display: flex; justify-content: flex-end; gap: 12px; white-space: nowrap; }
		.jc-list-table-wrap { background: var(--fg-color); border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; box-shadow: var(--shadow-xs); }
		.jc-list-table-scroller { height: 660px; overflow: auto; }
		.jc-list-table { width: 100%; min-width: 980px; border-collapse: separate; border-spacing: 0; }
		.jc-list-table th { position: sticky; top: 0; z-index: 2; padding: 12px 16px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; text-align: left; letter-spacing: 0.5px; background: var(--subtle-fg); border-bottom: 1px solid var(--border-color); }
		.jc-list-table td { padding: 12px 16px; font-size: 14px; color: var(--text-color); vertical-align: middle; }
		.jc-list-table tbody tr { cursor: pointer; }
		.jc-list-table tbody tr:hover { background: var(--subtle-fg); }
		.jc-list-table tbody tr:not(:last-child) td { border-bottom: 1px solid var(--border-color); }
		.jc-status-pill { display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:999px; font-size:12px; font-weight:700; line-height:1.2; white-space:nowrap; }
		.jc-status-dot { width:8px; height:8px; border-radius:50%; flex:0 0 auto; }
		.jc-list-pagination { padding: 16px 18px; border-top: 1px solid var(--border-color); text-align: center; }
		@media (max-width: 767px) { .jc-list-filter-grid { grid-template-columns: 1fr; } .jc-list-filter-actions { justify-content: flex-start; } }
	</style>

	<div class="jc-list-page">
		<div class="jc-list-hero">
			<h2>Job Cards</h2>
		</div>

		<div class="jc-list-filters">
			<div class="jc-list-filter-grid">
				<div>
					<label class="form-label">Search</label>
					<input type="text" class="form-control" data-filter="search" placeholder="Job card, quotation, customer">
				</div>
				<div>
					<label class="form-label">Status</label>
					<select class="form-control" data-filter="status">
						<option>All</option>
						<option>Draft</option>
						<option>In Progress</option>
						<option>Completed</option>
						<option>Cancelled</option>
					</select>
				</div>
				<div class="jc-list-filter-actions">
					<button class="btn btn-default jc-list-clear">Clear</button>
					<button class="btn btn-primary jc-list-apply">Apply Filters</button>
				</div>
			</div>
		</div>

		<div class="jc-list-table-wrap">
			<div class="jc-list-table-scroller">
				<table class="jc-list-table">
					<thead>
						<tr>
							<th>Job Card</th>
							<th>Quotation</th>
							<th>Customer</th>
							<th>Payment Mode</th>
							<th>Payment Option</th>
							<th style="text-align:right;">Quotation Amount</th>
							<th style="text-align:right;">Payment</th>
							<th style="text-align:right;">Balance</th>
							<th>Status</th>
						</tr>
					</thead>
					<tbody class="jc-list-body">
						<tr><td colspan="9" style="padding:24px;text-align:center;color:var(--text-muted);">Loading job cards...</td></tr>
					</tbody>
				</table>
			</div>
			<div class="jc-list-pagination"></div>
		</div>
	</div>
	`;
}
