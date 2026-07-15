frappe.pages['recent-stock-entries'].on_page_load = function(wrapper) {
	let page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Recent Stock Entries',
		single_column: true
	});

	page.set_secondary_action('Back to Stock Entry', function() {
		frappe.set_route('caw-stock-entry');
	});

	page.add_button('Refresh', function() {
		load_recent_stock_entries(page);
	}, { icon: 'refresh' });

	$(page.body).html(get_recent_stock_entries_html());
	bind_recent_stock_entries_events(page);
	load_filter_options(page);
	load_recent_stock_entries(page);
};

function load_filter_options(page) {
	frappe.call({
		method: 'crystal_alluminium_works.api.get_stock_entry_options',
		callback: function(r) {
			let opt = r.message || {};
			let $supplier = $(page.body).find('.rse-filter-supplier');
			$supplier.empty().append('<option value="">All Suppliers</option>');
			(opt.suppliers || []).forEach(s => {
				$supplier.append(`<option value="${frappe.utils.escape_html(s.name)}">${frappe.utils.escape_html(s.supplier_name || s.name)}</option>`);
			});

			let $wh = $(page.body).find('.rse-filter-warehouse');
			$wh.empty().append('<option value="">All Warehouses</option>');
			(opt.warehouses || []).forEach(w => {
				$wh.append(`<option value="${frappe.utils.escape_html(w)}">${frappe.utils.escape_html(w)}</option>`);
			});
		}
	});
}

function get_filters(page) {
	return {
		supplier: $(page.body).find('.rse-filter-supplier').val() || '',
		warehouse: $(page.body).find('.rse-filter-warehouse').val() || '',
		from_date: $(page.body).find('.rse-filter-from-date').val() || '',
		to_date: $(page.body).find('.rse-filter-to-date').val() || '',
		item_search: ($(page.body).find('.rse-filter-item').val() || '').trim()
	};
}

function bind_recent_stock_entries_events(page) {
	$(page.body).on('click', '.rse-row', function() {
		frappe.set_route('Form', 'Purchase Receipt', $(this).data('name'));
	});

	$(page.body).on('change', '.rse-filter-supplier, .rse-filter-warehouse, .rse-filter-from-date, .rse-filter-to-date', function() {
		load_recent_stock_entries(page);
	});

	let item_search_timer = null;
	$(page.body).on('input', '.rse-filter-item', function() {
		clearTimeout(item_search_timer);
		item_search_timer = setTimeout(() => load_recent_stock_entries(page), 300);
	});

	$(page.body).on('click', '.rse-clear-filters-btn', function() {
		$(page.body).find('.rse-filter-supplier, .rse-filter-warehouse').val('');
		$(page.body).find('.rse-filter-from-date, .rse-filter-to-date, .rse-filter-item').val('');
		load_recent_stock_entries(page);
	});
}

function load_recent_stock_entries(page) {
	let $body = $(page.body).find('.rse-body');
	$body.html('<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-muted);">Loading...</td></tr>');
	frappe.call({
		method: 'crystal_alluminium_works.api.get_recent_stock_entries',
		args: Object.assign({ limit: 50 }, get_filters(page)),
		freeze: true,
		freeze_message: 'Loading...',
		callback: function(r) {
			let rows = r.message || [];
			$body.empty();
			if (!rows.length) {
				$body.html('<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-muted);">No stock entries match these filters.</td></tr>');
				return;
			}
			rows.forEach(row => {
				let full_title = frappe.utils.escape_html(row.items_full || row.items_summary || '');
				$body.append(`
					<tr class="rse-row" data-name="${frappe.utils.escape_html(row.name)}" style="cursor:pointer;">
						<td style="padding:12px 16px;font-weight:500;">${frappe.utils.escape_html(row.name)}</td>
						<td style="padding:12px 16px;">${frappe.datetime.str_to_user(row.posting_date)}</td>
						<td style="padding:12px 16px;">${frappe.utils.escape_html(row.supplier || '')}</td>
						<td class="rse-items-cell" title="${full_title}">
							<span class="rse-items-text">${frappe.utils.escape_html(row.items_summary || '')}</span>
							<span style="color:var(--text-muted);">(${row.item_count} item${row.item_count === 1 ? '' : 's'})</span>
						</td>
						<td style="padding:12px 16px;text-align:right;">${format_currency(row.grand_total, 'KES')}</td>
					</tr>
				`);
			});
		}
	});
}

function get_recent_stock_entries_html() {
	return `
	<style>
		.rse-container { max-width: calc(1100px + 6rem); margin: 0 auto; padding: 20px 16px; font-family: var(--font-stack); }
		.rse-card { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; overflow: hidden; }
		.rse-filter-card { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px; }
		.rse-filter-grid { display: grid; grid-template-columns: repeat(5, 1fr) auto; gap: 16px; align-items: end; }
		.rse-field label { display:block; font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.4px; }
		.rse-table { width: 100%; border-collapse: collapse; }
		.rse-table thead th { padding: 12px 16px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border-color); background: var(--subtle-fg); }
		.rse-table tbody tr:not(:last-child) td { border-bottom: 1px solid var(--border-color); }
		.rse-table tbody tr:hover { background: var(--subtle-fg); }
		.rse-items-cell { padding:12px 16px; max-width: 280px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
		.rse-items-text { overflow: hidden; text-overflow: ellipsis; }
	</style>
	<div class="rse-container">
		<div class="rse-filter-card">
			<div class="rse-filter-grid">
				<div class="rse-field">
					<label>Supplier</label>
					<select class="form-control rse-filter-supplier"><option value="">All Suppliers</option></select>
				</div>
				<div class="rse-field">
					<label>Warehouse</label>
					<select class="form-control rse-filter-warehouse"><option value="">All Warehouses</option></select>
				</div>
				<div class="rse-field">
					<label>From Date</label>
					<input type="date" class="form-control rse-filter-from-date">
				</div>
				<div class="rse-field">
					<label>To Date</label>
					<input type="date" class="form-control rse-filter-to-date">
				</div>
				<div class="rse-field">
					<label>Item</label>
					<input type="text" class="form-control rse-filter-item" placeholder="Search item code...">
				</div>
				<div class="rse-field">
					<label>&nbsp;</label>
					<button class="btn btn-default btn-sm rse-clear-filters-btn" style="white-space:nowrap;">Clear Filters</button>
				</div>
			</div>
		</div>

		<div class="rse-card">
			<table class="rse-table">
				<thead>
					<tr>
						<th style="text-align:left;">Receipt</th>
						<th style="text-align:left;">Date</th>
						<th style="text-align:left;">Supplier</th>
						<th style="text-align:left;">Items</th>
						<th style="text-align:right;">Total</th>
					</tr>
				</thead>
				<tbody class="rse-body">
					<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-muted);">Loading...</td></tr>
				</tbody>
			</table>
		</div>
	</div>
	`;
}
