frappe.pages['stock-ledger'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Stock Ledger',
		single_column: true
	});
	wrapper.page = page;
};

frappe.pages['stock-ledger'].on_page_show = function(wrapper) {
	let page = wrapper.page;
	if (!page) page = $(wrapper).data('page');
	render_stock_ledger_page(page);
};

/* Render every Sales Invoice linked to a stock row. Glass deducted early at JC
   Operations maps to several invoices (partial + final releases); everything else
   maps to exactly one. Falls back to the singular field for older payloads. */
function sl_invoice_links(row) {
	let invoices = (row.sales_invoices && row.sales_invoices.length)
		? row.sales_invoices
		: (row.sales_invoice ? [row.sales_invoice] : []);
	if (!invoices.length) return '';
	let links = invoices.map(inv =>
		`<a href="/desk/sales-invoice-manager/${encodeURIComponent(inv)}" style="font-size:11px;color:var(--primary);font-weight:600;">${frappe.utils.escape_html(inv)}</a>`
	).join(', ');
	return `<div style="margin-top:2px;">${links}</div>`;
}

/* ── State ───────────────────────────────────────────────────── */
let SL_STATE = {
	category: '',   // Item Group
	item: '',       // Item Code
	warehouse: '',
	from_date: '',
	to_date: '',
	view: 'category' // 'category' | 'detail'
};

/* ── Main render ─────────────────────────────────────────────── */
function render_stock_ledger_page(page) {
	let $body = $(page.body);

	$body.html(`
	<style>
		/* ── Layout ─────────────────────────────────── */
		.sl-page { width:100%; max-width:1400px; margin:0 auto; padding:20px 16px; }
		.sl-card { background:var(--fg-color); border:1px solid var(--border-color); border-radius:8px; box-shadow:var(--shadow-xs); }

		/* ── Toolbar ────────────────────────────────── */
		.sl-toolbar { padding:14px 18px; border-bottom:1px solid var(--border-color); background:var(--subtle-fg); display:flex; gap:12px; align-items:end; flex-wrap:wrap; }
		.sl-toolbar-field { min-width:170px; }
		.sl-toolbar-field label { display:block; margin-bottom:5px; font-size:11px; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:.3px; }
		.sl-toolbar-field .frappe-control { margin:0 !important; }

		/* ── Date filters (hidden by default) ────── */
		.sl-date-filters { display:none; gap:12px; align-items:end; margin-left:12px; border-left:1px solid var(--border-color); padding-left:24px; }
		.sl-date-filters.visible { display:flex; }
		.sl-date-field { min-width:150px; }
		.sl-date-field label { display:block; margin-bottom:5px; font-size:11px; font-weight:600; color:var(--text-muted); text-transform:uppercase; }

		/* ── Summary ────────────────────────────────── */
		.sl-summary { padding:14px 18px; background:var(--subtle-fg); border-bottom:1px solid var(--border-color); display:none; gap:16px; flex-wrap:wrap; }
		.sl-summary.visible { display:flex; }
		.sl-summary-card { background:var(--fg-color); border:1px solid var(--border-color); border-radius:6px; padding:10px 14px; min-width:120px; }
		.sl-summary-label { font-size:10px; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:3px; letter-spacing:.3px; }
		.sl-summary-value { font-size:17px; font-weight:700; color:var(--text-color); }

		/* ── Table ──────────────────────────────────── */
		.sl-table-scroll { height:620px; overflow:auto; }
		.sl-table { width:100%; min-width:700px; border-collapse:separate; border-spacing:0; }
		.sl-table th { position:sticky; top:0; z-index:2; padding:10px 14px; font-size:11px; font-weight:700; color:var(--text-muted); text-align:left; border-bottom:1px solid var(--border-color); background:var(--subtle-fg); text-transform:uppercase; letter-spacing:.3px; white-space:nowrap; }
		.sl-table td { padding:10px 14px; font-size:13px; color:var(--text-color); border-bottom:1px solid var(--border-color); vertical-align:top; white-space:nowrap; }
		.sl-table tbody tr:last-child td { border-bottom:0; }
		.sl-table tbody tr:hover { background:var(--subtle-fg); }
		.sl-table tbody tr.sl-clickable { cursor:pointer; }
		.sl-muted { color:var(--text-muted); }

		/* ── Sheet badges (glass view) ──────────── */
		.sl-sheet-badge { display:inline-flex; align-items:center; padding:2px 6px; background:#e2e8f0; border-radius:4px; font-size:11px; font-weight:600; color:#475569; }
		.sl-sheet-badge.in { background:#dcfce7; color:#166534; }
		.sl-sheet-badge.out { background:#fee2e2; color:#991b1b; }

		/* ── Stock indicator colors ─────────────── */
		.sl-qty-positive { color:#28a745 !important; font-weight:600; }
		.sl-qty-negative { color:#dc3545 !important; font-weight:600; }
		.sl-qty-zero { color:var(--text-muted) !important; }

		/* ── Responsive ─────────────────────────── */
		@media (max-width: 768px) {
			.sl-toolbar { flex-direction:column; }
			.sl-toolbar .btn-clear-filters { margin-left:0; }
			.sl-table-scroll { max-height:480px; }
		}
	</style>

	<div class="sl-page">
		<div class="sl-card" style="margin-bottom: 20px;">
			<!-- Toolbar: Category + Item + Clear -->
			<div class="sl-toolbar" style="border-bottom: none;">
				<div class="sl-toolbar-field" id="sl-filter-category"></div>
				<div class="sl-toolbar-field" id="sl-filter-item" style="min-width:240px;"></div>
				<div class="sl-toolbar-field" id="sl-filter-warehouse"></div>
				
				<!-- Date range (shown only in detail view) -->
				<div class="sl-date-filters">
					<div class="sl-date-field">
						<label>From Date</label>
						<input type="date" class="form-control form-control-sm" data-filter="from_date">
					</div>
					<div class="sl-date-field">
						<label>To Date</label>
						<input type="date" class="form-control form-control-sm" data-filter="to_date">
					</div>
					<button class="btn btn-primary btn-sm sl-btn-search">Search</button>
				</div>

				<div class="sl-toolbar-field" style="margin-left:auto; min-width:auto;">
					<label style="visibility:hidden;">Clear</label>
					<button class="btn btn-primary btn-sm btn-clear-filters">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
						Clear
					</button>
				</div>
			</div>
		</div>

		<!-- Summary cards -->
		<div class="sl-summary" style="margin-bottom: 20px; border: 1px solid var(--border-color); border-radius: 8px;"></div>

		<div class="sl-card">
			<!-- Data table -->
			<div class="sl-table-scroll">
				<div class="sl-table-container"></div>
			</div>
		</div>
	</div>
	`);

	/* ── Create filter controls ─────────────────────── */
	page.sl_category = frappe.ui.form.make_control({
		df: {
			fieldtype: 'Select',
			fieldname: 'product_category',
			label: 'Product Category',
			options: '\nGlass\nAluminium\nFittings\nCeiling\nRubber\nSilicone\nConsumable\nRaw Material\nProducts\nSub Assemblies\nServices',
			placeholder: 'All Categories'
		},
		parent: $body.find('#sl-filter-category'),
		render_input: true
	});

	page.sl_item = frappe.ui.form.make_control({
		df: {
			fieldtype: 'Link',
			options: 'Item',
			fieldname: 'item_code',
			label: 'Item',
			placeholder: 'Search item...',
			only_select: true,
			get_query: function() {
				let cat = page.sl_category.get_value();
				if (cat) {
					return { filters: { item_group: cat } };
				}
				return {};
			}
		},
		parent: $body.find('#sl-filter-item'),
		render_input: true
	});

	page.sl_warehouse = frappe.ui.form.make_control({
		df: {
			fieldtype: 'Link',
			options: 'Warehouse',
			fieldname: 'warehouse',
			label: 'Warehouse',
			placeholder: 'All Warehouses',
			only_select: true
		},
		parent: $body.find('#sl-filter-warehouse'),
		render_input: true
	});

	/* ── Bind events ───────────────────────────────── */
	sl_bind_events(page, $body);

	/* ── Show default: all balances ────────────────── */
	sl_load_category_view(page);
}

/* ══════════════════════════════════════════════════════════════ */
/* ── EVENTS                                                  ── */
/* ══════════════════════════════════════════════════════════════ */
function sl_bind_events(page, $body) {
	$body.off('.slPage');

	// Category change → reload category view (or detail view if item selected)
	page.sl_category.$input && page.sl_category.$input.on('change.slPage', function() {
		let cat = page.sl_category.get_value();
		SL_STATE.category = cat;
		// Clear item when category changes
		page.sl_item.set_value('');
		SL_STATE.item = '';
		sl_load_category_view(page);
	});

	// Item change → switch to detail view
	page.sl_item.$input && page.sl_item.$input.on('change.slPage', function() {
		let item = page.sl_item.get_value();
		if (item) {
			SL_STATE.item = item;
			sl_load_detail_view(page);
		}
	});

	// Warehouse change
	page.sl_warehouse.$input && page.sl_warehouse.$input.on('change.slPage', function() {
		SL_STATE.warehouse = page.sl_warehouse.get_value();
		if (SL_STATE.item) {
			sl_load_detail_view(page);
		} else {
			sl_load_category_view(page);
		}
	});

	// Clear button
	$body.on('click.slPage', '.btn-clear-filters', function() {
		page.sl_category.set_value('');
		page.sl_item.set_value('');
		page.sl_warehouse.set_value('');
		$body.find('[data-filter="from_date"]').val('');
		$body.find('[data-filter="to_date"]').val('');
		SL_STATE = { category: '', item: '', warehouse: '', from_date: '', to_date: '', view: 'category' };
		sl_load_category_view(page);
	});

	// Date search button
	$body.on('click.slPage', '.sl-btn-search', function() {
		SL_STATE.from_date = $body.find('[data-filter="from_date"]').val() || '';
		SL_STATE.to_date = $body.find('[data-filter="to_date"]').val() || '';
		sl_load_detail_view(page);
	});

	// Date enter key
	$body.on('keydown.slPage', '.sl-date-filters input', function(e) {
		if (e.key === 'Enter') {
			SL_STATE.from_date = $body.find('[data-filter="from_date"]').val() || '';
			SL_STATE.to_date = $body.find('[data-filter="to_date"]').val() || '';
			sl_load_detail_view(page);
		}
	});

	// Row click in category view → drill down to item
	$body.on('click.slPage', '.sl-clickable', function() {
		let item_code = $(this).data('item');
		let item_group = $(this).data('group');
		let warehouse = $(this).data('warehouse');
		
		if (item_code) {
			// Set the category first if not already set
			if (item_group && !page.sl_category.get_value()) {
				page.sl_category.set_value(item_group);
				SL_STATE.category = item_group;
			}
			
			// Set the warehouse so the glass ledger doesn't complain
			if (warehouse) {
				page.sl_warehouse.set_value(warehouse);
				SL_STATE.warehouse = warehouse;
			}
			
			page.sl_item.set_value(item_code);
			SL_STATE.item = item_code;
			sl_load_detail_view(page);
		}
	});
}

/* ══════════════════════════════════════════════════════════════ */
/* ── CATEGORY VIEW (stock balances table)                    ── */
/* ══════════════════════════════════════════════════════════════ */
function sl_load_category_view(page) {
	SL_STATE.view = 'category';
	let $body = $(page.body);

	// Hide date filters & summary
	$body.find('.sl-date-filters').removeClass('visible');
	$body.find('.sl-summary').removeClass('visible');

	// Show loading
	$body.find('.sl-table-container').html(`
		<table class="sl-table"><tbody>
			<tr><td class="sl-muted" style="text-align:center;padding:32px;">Loading stock balances...</td></tr>
		</tbody></table>
	`);

	frappe.call({
		method: 'crystal_alluminium_works.api.get_category_stock_balance',
		args: {
			item_group: SL_STATE.category || undefined,
			warehouse: SL_STATE.warehouse || undefined
		},
		callback: function(r) {
			let data = r.message || [];
			sl_render_category_table(page, data);
		}
	});
}

function sl_render_category_table(page, data) {
	let $container = $(page.body).find('.sl-table-container');

	if (!data.length) {
		$container.html(`
			<table class="sl-table"><tbody>
				<tr><td class="sl-muted" style="text-align:center;padding:48px;">No stock found${SL_STATE.category ? ' for <strong>' + frappe.utils.escape_html(SL_STATE.category) + '</strong>' : ''}.</td></tr>
			</tbody></table>
		`);
		return;
	}

	let rows_html = data.map(row => {
		let qty_class = row.actual_qty > 0 ? 'sl-qty-positive' : (row.actual_qty < 0 ? 'sl-qty-negative' : 'sl-qty-zero');
		
		return `
			<tr class="sl-clickable" data-item="${frappe.utils.escape_html(row.item_code)}" data-group="${frappe.utils.escape_html(row.item_group)}" data-warehouse="${frappe.utils.escape_html(row.warehouse)}">
				<td><strong>${frappe.utils.escape_html(row.item_code)}</strong></td>
				<td>${frappe.utils.escape_html(row.item_name || '')}</td>
				<td>${frappe.utils.escape_html(row.item_group || '')}</td>
				<td>${frappe.utils.escape_html(row.warehouse || '')}</td>
				<td style="text-align:right;">
					<div class="${qty_class}">${format_number(row.actual_qty, null, 2)} ${frappe.utils.escape_html(row.stock_uom || '')}</div>
				</td>
			</tr>
		`;
	}).join('');

	$container.html(`
		<table class="sl-table">
			<thead>
				<tr>
					<th>Item Code</th>
					<th>Item Name</th>
					<th>Category</th>
					<th>Warehouse</th>
					<th style="text-align:right;">Stock Balance</th>
				</tr>
			</thead>
			<tbody>${rows_html}</tbody>
		</table>
	`);
}

/* ══════════════════════════════════════════════════════════════ */
/* ── DETAIL VIEW                                             ── */
/* ══════════════════════════════════════════════════════════════ */
function sl_load_detail_view(page) {
	SL_STATE.view = 'detail';
	let $body = $(page.body);

	// Show date filters
	$body.find('.sl-date-filters').addClass('visible');

	// Loading state
	$body.find('.sl-summary').removeClass('visible');
	$body.find('.sl-table-container').html(`
		<table class="sl-table"><tbody>
			<tr><td class="sl-muted" style="text-align:center;padding:32px;">Loading ledger...</td></tr>
		</tbody></table>
	`);

	// Determine if this is a Glass item
	let is_glass = (SL_STATE.category === 'Glass');

	// If no category set, we need to look it up
	if (!SL_STATE.category && SL_STATE.item) {
		frappe.db.get_value('Item', SL_STATE.item, 'item_group', function(r) {
			if (r && r.item_group) {
				SL_STATE.category = r.item_group;
				page.sl_category.set_value(r.item_group);
			}
			_load_detail_data(page, r && r.item_group === 'Glass');
		});
	} else {
		_load_detail_data(page, is_glass);
	}
}

function _load_detail_data(page, is_glass) {
	if (is_glass) {
		_load_glass_detail(page);
	} else {
		_load_standard_detail(page);
	}
}

/* ── Standard ledger ─────────────────────────────────────── */
function _load_standard_detail(page) {
	frappe.call({
		method: 'crystal_alluminium_works.api.get_standard_stock_ledger',
		args: {
			item_code: SL_STATE.item,
			warehouse: SL_STATE.warehouse || undefined,
			from_date: SL_STATE.from_date || undefined,
			to_date: SL_STATE.to_date || undefined
		},
		callback: function(r) {
			let entries = r.message || [];
			sl_render_standard_detail(page, entries);
		}
	});
}

function sl_render_standard_detail(page, entries) {
	let $body = $(page.body);
	let $container = $body.find('.sl-table-container');
	let $summary = $body.find('.sl-summary');

	// Summary: last balance
	let last_balance = entries.length ? entries[entries.length - 1].qty_after_transaction : 0;
	let uom = entries.length ? (entries[0].stock_uom || '') : '';
	$summary.html(`
		<div class="sl-summary-card">
			<div class="sl-summary-label">Current Balance</div>
			<div class="sl-summary-value">${format_number(last_balance, null, 2)} ${frappe.utils.escape_html(uom)}</div>
		</div>
		<div class="sl-summary-card">
			<div class="sl-summary-label">Transactions</div>
			<div class="sl-summary-value">${entries.length}</div>
		</div>
	`).addClass('visible');

	if (!entries.length) {
		$container.html(`
			<table class="sl-table"><tbody>
				<tr><td colspan="5" class="sl-muted" style="text-align:center;padding:48px;">No ledger entries found for <strong>${frappe.utils.escape_html(SL_STATE.item)}</strong>.</td></tr>
			</tbody></table>
		`);
		return;
	}

	let rows_html = [...entries].reverse().map(row => {
		let date_str = row.posting_date ? frappe.datetime.str_to_user(row.posting_date) : '';
		let voucher_link = `<a href="/app/${encodeURIComponent(row.voucher_type.toLowerCase().replace(/ /g, '-'))}/${encodeURIComponent(row.voucher_no)}">${frappe.utils.escape_html(row.voucher_no)}</a>`;
		let qty_class = row.actual_qty > 0 ? 'sl-qty-positive' : (row.actual_qty < 0 ? 'sl-qty-negative' : 'sl-qty-zero');
		let qty_prefix = row.actual_qty > 0 ? '+' : '';

		let invoice_html = sl_invoice_links(row);

		return `
			<tr>
				<td>
					<div>${frappe.utils.escape_html(date_str)}</div>
					${invoice_html}
				</td>
				<td>
					<div style="font-size:11px;color:var(--text-muted);">${frappe.utils.escape_html(row.voucher_type)}</div>
					<div>${voucher_link}</div>
				</td>
				<td style="text-align:right;" class="${qty_class}">${qty_prefix}${format_number(row.actual_qty, null, 2)}</td>
				<td style="text-align:right;font-weight:600;">${format_number(row.qty_after_transaction, null, 2)}</td>
			</tr>
		`;
	}).join('');

	$container.html(`
		<table class="sl-table">
			<thead>
				<tr>
					<th>Date / Invoice</th>
					<th>Voucher</th>
					<th style="text-align:right;">Qty In/Out</th>
					<th style="text-align:right;">Balance</th>
				</tr>
			</thead>
			<tbody>${rows_html}</tbody>
		</table>
	`);
}

/* ── Glass ledger (with sheet tracking) ──────────────────── */
function _load_glass_detail(page) {
	let warehouse = SL_STATE.warehouse;
	if (!warehouse) {
		// For glass, warehouse is required
		frappe.msgprint(__('Please select a Warehouse for glass ledger.'));
		return;
	}

	frappe.call({
		method: 'crystal_alluminium_works.api.get_glass_stock_ledger',
		args: {
			item_code: SL_STATE.item,
			warehouse: warehouse,
			from_date: SL_STATE.from_date || undefined,
			to_date: SL_STATE.to_date || undefined
		},
		callback: function(r) {
			let result = r.message || { ledger: [], final_sheet_balance: {}, final_sft_balance: 0 };
			sl_render_glass_detail(page, result);
		}
	});
}

function sl_render_glass_detail(page, result) {
	let $body = $(page.body);
	let $container = $body.find('.sl-table-container');
	let $summary = $body.find('.sl-summary');
	let ledger = result.ledger || [];

	// Summary cards
	let summary_html = `
		<div class="sl-summary-card">
			<div class="sl-summary-label">Total SFT Balance</div>
			<div class="sl-summary-value">${format_number(result.final_sft_balance, null, 2)}</div>
		</div>
		<div class="sl-summary-card">
			<div class="sl-summary-label">Total Invoice SFT</div>
			<div class="sl-summary-value">${format_number(result.total_invoice_sft || 0, null, 2)}</div>
		</div>
	`;

	if (!result.is_laminated) {
		let sheet_bal = result.final_sheet_balance || {};
		if (Object.keys(sheet_bal).length > 0) {
			for (let [size, pcs] of Object.entries(sheet_bal)) {
				summary_html += `
					<div class="sl-summary-card">
						<div class="sl-summary-label">Size ${frappe.utils.escape_html(size)}</div>
						<div class="sl-summary-value">${pcs} pcs</div>
					</div>
				`;
			}
		} else {
			summary_html += `
				<div class="sl-summary-card">
					<div class="sl-summary-label">Physical Sheets</div>
					<div class="sl-summary-value sl-muted">0 pcs</div>
				</div>
			`;
		}
	}

	$summary.html(summary_html).addClass('visible');

	if (!ledger.length) {
		$container.html(`
			<table class="sl-table"><tbody>
				<tr><td colspan="8" class="sl-muted" style="text-align:center;padding:48px;">No ledger entries found for <strong>${frappe.utils.escape_html(SL_STATE.item)}</strong>.</td></tr>
			</tbody></table>
		`);
		return;
	}

	let rows_html = [...ledger].reverse().map(row => {
		let date_str = row.posting_date ? frappe.datetime.str_to_user(row.posting_date) : '';
		if (row.posting_time && date_str) {
			date_str += ' ' + row.posting_time;
		}
		let voucher_link = `<a href="/app/${encodeURIComponent(row.voucher_type.toLowerCase().replace(/ /g, '-'))}/${encodeURIComponent(row.voucher_no)}">${frappe.utils.escape_html(row.voucher_no)}</a>`;
		let qty_class = row.actual_qty > 0 ? 'sl-qty-positive' : (row.actual_qty < 0 ? 'sl-qty-negative' : 'sl-qty-zero');
		let qty_prefix = row.actual_qty > 0 ? '+' : '';

		let invoice_html = sl_invoice_links(row);

		let row_html = `
			<tr>
				<td>
					<div>${frappe.utils.escape_html(date_str)}</div>
					${invoice_html}
				</td>
				<td>
					<div style="font-size:11px;color:var(--text-muted);">${frappe.utils.escape_html(row.voucher_type)}</div>
					<div>${voucher_link}</div>
				</td>
				<td style="text-align:right;" class="${qty_class}">${qty_prefix}${format_number(row.actual_qty, null, 2)}</td>
				<td style="text-align:right;">${row.invoice_sft ? format_number(row.invoice_sft, null, 2) : '-'}</td>
				<td style="text-align:right;font-weight:600;">${format_number(row.qty_after_transaction, null, 2)}</td>
		`;
		
		if (!result.is_laminated) {
			row_html += `
				<td>${sl_format_sheet_badges(row.sheets_in, 'in')}</td>
				<td>${sl_format_sheet_badges(row.sheets_out, 'out')}</td>
				<td>${sl_format_sheet_badges(row.sheet_balance, '')}</td>
			`;
		}
		row_html += `</tr>`;
		return row_html;
	}).join('');

	let headers_html = `
		<tr>
			<th>Date / Invoice</th>
			<th>Voucher</th>
			<th style="text-align:right;">SFT In/Out</th>
			<th style="text-align:right;">Invoice SFT</th>
			<th style="text-align:right;">Balance (SFT)</th>
	`;
	
	if (!result.is_laminated) {
		headers_html += `
			<th>Sheets In</th>
			<th>Sheets Out</th>
			<th>Running Sheet Balance</th>
		`;
	}
	headers_html += `</tr>`;

	$container.html(`
		<table class="sl-table">
			<thead>
				${headers_html}
			</thead>
			<tbody>${rows_html}</tbody>
		</table>
	`);
}

/* ── Helpers ─────────────────────────────────────────────── */
function sl_format_sheet_badges(sheets_dict, type) {
	if (!sheets_dict || Object.keys(sheets_dict).length === 0) return '<span class="sl-muted">-</span>';
	let keys = Object.keys(sheets_dict);
	let title_text = keys.map(size => `${size}: ${sheets_dict[size]}`).join('\n');
	
	let badges = keys.slice(0, 2).map(size => {
		return `<span class="sl-sheet-badge ${type}">${frappe.utils.escape_html(size)}: ${sheets_dict[size]}</span>`;
	});
	
	if (keys.length > 2) {
		badges.push(`<span class="sl-sheet-badge" style="background:transparent; border:1px dashed var(--border-color); color:var(--text-muted); cursor:help;">+${keys.length - 2} more</span>`);
	}
	
	return `<div style="display:inline-flex; gap:4px; align-items:center; white-space:nowrap;" title="${frappe.utils.escape_html(title_text)}">${badges.join('')}</div>`;
}
