/* Render every Sales Invoice linked to a glass stock row. Cut/custom & laminated glass
   is deducted once at JC Operations but billed across several partial/final invoices, so
   a single row can list multiple invoices; falls back to the singular field for older payloads. */
function gsl_invoice_links(row) {
	let invoices = (row.sales_invoices && row.sales_invoices.length)
		? row.sales_invoices
		: (row.sales_invoice ? [row.sales_invoice] : []);
	if (!invoices.length) return '';
	let links = invoices.map(inv =>
		`<a href="/desk/sales-invoice-manager/${encodeURIComponent(inv)}" style="font-size:11px;color:var(--primary);font-weight:600;">${frappe.utils.escape_html(inv)}</a>`
	).join(', ');
	return `<div style="margin-top:2px;">${links}</div>`;
}

frappe.pages['glass-stock-ledger'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Glass Stock Ledger',
		single_column: true
	});

	wrapper.page = page;
};

frappe.pages['glass-stock-ledger'].on_page_show = function(wrapper) {
	let page = wrapper.page || (wrapper.control ? wrapper.control.page : null);

	if (!page) {
		page = $(wrapper).data('page');
	}

	render_glass_stock_ledger_page(page);
};

function render_glass_stock_ledger_page(page) {
	let $body = $(page.body);
	
	let html = `
	<style>
		.gsl-page { width:100%; max-width: 1400px; margin: 0 auto; padding: 24px 16px; }
		.gsl-card { background: var(--fg-color); border: 1px solid var(--border-color); border-radius: 8px; box-shadow: var(--shadow-xs); overflow: hidden; margin-bottom: 20px; }
		.gsl-card-header { padding: 14px 18px; font-size: 15px; font-weight: 700; color: var(--heading-color); border-bottom: 1px solid var(--border-color); background: var(--subtle-fg); display: flex; align-items: center; gap: 10px; }
		.gsl-filters { padding:16px 18px; border-bottom:1px solid var(--border-color); background:var(--fg-color); }
		.gsl-filter-grid { display:grid; grid-template-columns:minmax(200px, 1fr) minmax(200px, 1fr) minmax(150px, .8fr) minmax(150px, .8fr) auto; gap:12px; align-items:end; }
		.gsl-filter-field label { display:block; margin-bottom:6px; color:var(--text-muted); font-size:12px; font-weight:600; }
		.gsl-filter-actions { display:flex; gap:8px; }
		
		.gsl-summary { padding:16px 18px; background:var(--subtle-fg); border-bottom:1px solid var(--border-color); display:flex; gap:20px; flex-wrap:wrap; }
		.gsl-summary-card { background:var(--fg-color); border:1px solid var(--border-color); border-radius:6px; padding:12px 16px; min-width:140px; }
		.gsl-summary-label { font-size:11px; font-weight:600; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px; }
		.gsl-summary-value { font-size:18px; font-weight:700; color:var(--text-color); }
		
		.gsl-table-scroll { height:560px; overflow:auto; }
		.gsl-table { width: 100%; min-width: 1050px; border-collapse: separate; border-spacing:0; }
		.gsl-table th { position:sticky; top:0; z-index:2; padding: 11px 14px; font-size: 12px; font-weight: 700; color: var(--text-muted); text-align: left; border-bottom: 1px solid var(--border-color); background: var(--subtle-fg); white-space: nowrap; }
		.gsl-table td { padding: 12px 14px; font-size: 13px; color: var(--text-color); border-bottom: 1px solid var(--border-color); vertical-align: top; white-space: nowrap; }
		.gsl-table tbody tr:last-child td { border-bottom: 0; }
		.gsl-muted { color: var(--text-muted); }
		
		.gsl-sheet-badge { display:inline-flex; align-items:center; padding:2px 6px; background:#e2e8f0; border-radius:4px; font-size:11px; font-weight:600; color:#475569;}
		.gsl-sheet-badge.in { background:#dcfce7; color:#166534; }
		.gsl-sheet-badge.out { background:#fee2e2; color:#991b1b; }
		
		@media (max-width: 900px) {
			.gsl-filter-grid { grid-template-columns:repeat(2, minmax(0, 1fr)); }
			.gsl-filter-actions { grid-column:1 / -1; }
			.gsl-table-scroll { height:480px; }
		}
		@media (max-width: 560px) {
			.gsl-filter-grid { grid-template-columns:1fr; }
			.gsl-filter-actions { grid-column:auto; }
		}
	</style>

	<div class="gsl-page">
		<div class="gsl-card">
			<div class="gsl-card-header">
				Glass Stock Ledger
			</div>
			<div class="gsl-filters">
				<div class="gsl-filter-grid">
					<div class="gsl-filter-field">
						<label>Item</label>
						<div id="filter-item-code"></div>
					</div>
					<div class="gsl-filter-field">
						<label>Warehouse</label>
						<div id="filter-warehouse"></div>
					</div>
					<div class="gsl-filter-field">
						<label>From Date</label>
						<input type="date" class="form-control" data-filter="from_date">
					</div>
					<div class="gsl-filter-field">
						<label>To Date</label>
						<input type="date" class="form-control" data-filter="to_date">
					</div>
					<div class="gsl-filter-actions">
						<button class="btn btn-primary gsl-filter-apply">Search</button>
						<button class="btn btn-default gsl-filter-clear">Clear</button>
					</div>
				</div>
			</div>
			<div class="gsl-summary" style="display:none;"></div>
			<div class="gsl-table-scroll">
				<table class="gsl-table">
					<thead>
						<tr>
							<th>Date</th>
							<th>Voucher</th>
							<th style="text-align:right;">SFT In/Out</th>
							<th style="text-align:right;">Invoice SFT</th>
							<th style="text-align:right;">Balance (SFT)</th>
							<th>Sheets In</th>
							<th>Sheets Out</th>
							<th>Running Sheet Balance</th>
						</tr>
					</thead>
					<tbody class="gsl-table-body">
						<tr><td colspan="8" class="gsl-muted" style="text-align:center;padding:32px;">Select an Item and Warehouse to view ledger.</td></tr>
					</tbody>
				</table>
			</div>
		</div>
	</div>
	`;

	$body.html(html);
	
	page.item_filter = frappe.ui.form.make_control({
		df: {
			fieldtype: 'Link',
			options: 'Item',
			fieldname: 'item_code',
			placeholder: 'Select Glass Item...',
			only_select: true,
			get_query: function() {
				return { filters: { item_group: 'Glass' } };
			}
		},
		parent: $body.find('#filter-item-code'),
		render_input: true
	});
	
	page.warehouse_filter = frappe.ui.form.make_control({
		df: {
			fieldtype: 'Link',
			options: 'Warehouse',
			fieldname: 'warehouse',
			placeholder: 'Select Warehouse...',
			only_select: true,
			default: frappe.defaults.get_user_default("Warehouse")
		},
		parent: $body.find('#filter-warehouse'),
		render_input: true
	});

	bind_gsl_events(page, $body);
}

function bind_gsl_events(page, $body) {
	$body.off('.gslPage');

	$body.on('click.gslPage', '.gsl-filter-apply', function() {
		load_gsl_records(page);
	});

	$body.on('click.gslPage', '.gsl-filter-clear', function() {
		page.item_filter.set_value('');
		page.warehouse_filter.set_value('');
		$body.find('[data-filter="from_date"]').val('');
		$body.find('[data-filter="to_date"]').val('');
		$body.find('.gsl-table-body').html(`<tr><td colspan="8" class="gsl-muted" style="text-align:center;padding:32px;">Select an Item and Warehouse to view ledger.</td></tr>`);
		$body.find('.gsl-summary').hide();
	});

	$body.on('keydown.gslPage', '.gsl-filters input', function(event) {
		if (event.key === 'Enter') {
			load_gsl_records(page);
		}
	});
}

function format_sheets_badges(sheets_dict, type) {
	if (!sheets_dict || Object.keys(sheets_dict).length === 0) return '-';
	let keys = Object.keys(sheets_dict);
	let title_text = keys.map(size => `${size}: ${sheets_dict[size]}`).join('\n');
	
	let badges = keys.slice(0, 2).map(size => {
		return `<span class="gsl-sheet-badge ${type}">${frappe.utils.escape_html(size)}: ${sheets_dict[size]}</span>`;
	});
	
	if (keys.length > 2) {
		badges.push(`<span class="gsl-sheet-badge" style="background:transparent; border:1px dashed var(--border-color); color:var(--text-muted); cursor:help;">+${keys.length - 2} more</span>`);
	}
	
	return `<div style="display:inline-flex; gap:4px; align-items:center; white-space:nowrap;" title="${frappe.utils.escape_html(title_text)}">${badges.join('')}</div>`;
}

function load_gsl_records(page) {
	let $body = $(page.body);
	let item_code = page.item_filter.get_value();
	let warehouse = page.warehouse_filter.get_value();
	let from_date = $body.find('[data-filter="from_date"]').val() || '';
	let to_date = $body.find('[data-filter="to_date"]').val() || '';

	if (!item_code || !warehouse) {
		frappe.msgprint(__('Please select both Item and Warehouse.'));
		return;
	}

	if (from_date && to_date && from_date > to_date) {
		frappe.msgprint(__('From Date cannot be after To Date.'));
		return;
	}

	$body.find('.gsl-table-body').html(`
		<tr><td colspan="8" class="gsl-muted" style="text-align:center;padding:32px;">Loading ledger...</td></tr>
	`);
	$body.find('.gsl-summary').hide();

	frappe.call({
		method: 'crystal_alluminium_works.api.get_glass_stock_ledger',
		args: {
			item_code: item_code,
			warehouse: warehouse,
			from_date: from_date,
			to_date: to_date
		},
		callback: function(response) {
			let result = response.message || { ledger: [], final_sheet_balance: {}, final_sft_balance: 0 };
			let ledger = result.ledger;
			
			// Render Summary Cards
			let summary_html = `
				<div class="gsl-summary-card">
					<div class="gsl-summary-label">Total SFT Balance</div>
					<div class="gsl-summary-value">${format_number(result.final_sft_balance, null, 2)}</div>
				</div>
				<div class="gsl-summary-card">
					<div class="gsl-summary-label">Total Invoice SFT</div>
					<div class="gsl-summary-value">${format_number(result.total_invoice_sft || 0, null, 2)}</div>
				</div>
			`;
			
			if (!result.is_laminated) {
				if (Object.keys(result.final_sheet_balance).length > 0) {
					for (let [size, pcs] of Object.entries(result.final_sheet_balance)) {
						summary_html += `
							<div class="gsl-summary-card">
								<div class="gsl-summary-label">Size ${frappe.utils.escape_html(size)}</div>
								<div class="gsl-summary-value">${pcs} pcs</div>
							</div>
						`;
					}
				} else {
					summary_html += `
						<div class="gsl-summary-card">
							<div class="gsl-summary-label">Physical Sheets</div>
							<div class="gsl-summary-value gsl-muted">0 pcs</div>
						</div>
					`;
				}
			}
			$body.find('.gsl-summary').html(summary_html).show();
			
			// Render Table
			if (ledger.length === 0) {
				$body.find('.gsl-table-body').html(`
					<tr><td colspan="8" class="gsl-muted" style="text-align:center;padding:32px;">No ledger entries found for this item and warehouse.</td></tr>
				`);
				return;
			}
			
			let rows_html = [...ledger].reverse().map(row => {
				let date_str = row.posting_date ? frappe.datetime.str_to_user(row.posting_date || '') : '';
				if (row.posting_time && date_str) {
					date_str += ' ' + row.posting_time;
				}
				
				let voucher_link = `<a href="/desk/Form/${encodeURIComponent(row.voucher_type)}/${encodeURIComponent(row.voucher_no)}">${frappe.utils.escape_html(row.voucher_no)}</a>`;
				
				let qty_color = row.actual_qty > 0 ? '#166534' : (row.actual_qty < 0 ? '#991b1b' : 'inherit');

				let invoice_html = gsl_invoice_links(row);
				
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
						<td style="text-align:right;color:${qty_color};font-weight:600;">${row.actual_qty > 0 ? '+' : ''}${format_number(row.actual_qty, null, 2)}</td>
						<td style="text-align:right;">${row.invoice_sft ? format_number(row.invoice_sft, null, 2) : '-'}</td>
						<td style="text-align:right;font-weight:600;">${format_number(row.qty_after_transaction, null, 2)}</td>
				`;
				
				if (!result.is_laminated) {
					row_html += `
						<td>${format_sheets_badges(row.sheets_in, 'in')}</td>
						<td>${format_sheets_badges(row.sheets_out, 'out')}</td>
						<td>${format_sheets_badges(row.sheet_balance, '')}</td>
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
			
			$body.find('.gsl-table thead').html(headers_html);
			$body.find('.gsl-table-body').html(rows_html);
		}
	});
}
