const STOCK_CATEGORIES = ['Aluminium', 'Glass', 'Fittings', 'Ceiling', 'Rubber', 'Silicone'];

frappe.pages['stock_adjustment'].on_page_load = function(wrapper) {
	let page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Stock Adjustment',
		single_column: true
	});

	page.se_options = { warehouses: [], sheet_sizes: [], default_warehouse: 'Stores - CA' };
	page.se_sheet_map = {};
	page.adjustment_items = [];

	page.set_secondary_action('Back to Dashboard', function() {
		frappe.set_route('crystal-aluminium-wo');
	});

	$(page.body).html(get_stock_adjustment_html());
	bind_events(page);
	load_options(page);
};

function load_options(page) {
	frappe.call({
		method: 'crystal_alluminium_works.api.get_stock_entry_options',
		freeze: true,
		freeze_message: 'Loading...',
		callback: function(r) {
			let opt = r.message || {};
			page.se_options = opt;
			page.se_sheet_map = {};
			(opt.sheet_sizes || []).forEach(s => { page.se_sheet_map[s.size] = flt(s.sft); });

			let $wh = $(page.body).find('.sa-warehouse');
			$wh.empty();
			(opt.warehouses || []).forEach(w => {
				$wh.append(`<option value="${frappe.utils.escape_html(w)}">${frappe.utils.escape_html(w)}</option>`);
			});
			if (opt.default_warehouse) {
				$wh.val(opt.default_warehouse);
			} else {
				$wh.val('Stores - CA');
			}
			
			let $ig = $(page.body).find('.sa-item-group');
			$ig.empty().append('<option value="">Select Item Group...</option>');
			STOCK_CATEGORIES.forEach(c => {
				$ig.append(`<option value="${frappe.utils.escape_html(c)}">${frappe.utils.escape_html(c)}</option>`);
			});
		}
	});
}

function bind_events(page) {
	$(page.body).on('click', '.sa-load-btn', function() {
		load_items(page);
	});

	$(page.body).on('click', '.sa-submit-btn', function() {
		submit_reconciliation(page);
	});
	
	$(page.body).on('change keyup', '.sa-input-new-qty, .sa-input-sheets, .sa-select-sheet-size', function() {
		let $row = $(this).closest('tr');
		let idx = $row.data('idx');
		let item = page.adjustment_items[idx];
		let is_glass = $(page.body).find('.sa-item-group').val() === 'Glass';
		
		if (is_glass) {
			let sheets_val = $row.find('.sa-input-sheets').val();
			let size = $row.find('.sa-select-sheet-size').val();
			let sft = flt(page.se_sheet_map[size] || 0);
			
			if (size && sft > 0) {
				let current_sheets = (item.sheet_balance && item.sheet_balance[size]) ? flt(item.sheet_balance[size]) : 0;
				$row.find('.sa-current-sheets').text(flt(current_sheets, 2));
				
				if (sheets_val !== '' && flt(sheets_val) >= 0) {
					let sheets = flt(sheets_val);
					let sheet_diff = sheets - current_sheets;
					
					let new_qty = flt(item.current_qty) + (sheet_diff * sft);
					item.new_qty = new_qty;
					
					$row.find('.sa-input-new-qty').val(flt(new_qty, 4));
					$row.find('.sa-sheet-diff').text(flt(sheet_diff, 2));
					if (sheet_diff > 0) $row.find('.sa-sheet-diff').css('color', 'green');
					else if (sheet_diff < 0) $row.find('.sa-sheet-diff').css('color', 'red');
					else $row.find('.sa-sheet-diff').css('color', 'inherit');
				} else {
					item.new_qty = null;
					$row.find('.sa-input-new-qty').val('');
					$row.find('.sa-sheet-diff').text('');
				}
			} else {
				$row.find('.sa-current-sheets').text('');
				item.new_qty = null;
				$row.find('.sa-input-new-qty').val('');
				$row.find('.sa-sheet-diff').text('');
			}
		} else {
			let val = $row.find('.sa-input-new-qty').val();
			if (val !== '') {
				item.new_qty = flt(val);
			} else {
				item.new_qty = null;
			}
		}
		
		if (item.new_qty !== null && item.new_qty !== undefined) {
			let diff = flt(item.new_qty - item.current_qty);
			$row.find('.sa-qty-diff').text(flt(diff, 4));
			
			if (diff > 0) $row.find('.sa-qty-diff').css('color', 'green');
			else if (diff < 0) $row.find('.sa-qty-diff').css('color', 'red');
			else $row.find('.sa-qty-diff').css('color', 'inherit');
		} else {
			$row.find('.sa-qty-diff').text('');
		}
	});
}

function load_items(page) {
	let item_group = $(page.body).find('.sa-item-group').val();
	let warehouse = $(page.body).find('.sa-warehouse').val();
	
	if (!item_group || !warehouse) {
		frappe.msgprint('Please select both Warehouse and Item Group.');
		return;
	}
	
	frappe.call({
		method: 'crystal_alluminium_works.crystal_alluminium_works.page.stock_adjustment.stock_adjustment.get_items_for_adjustment',
		args: {
			item_group: item_group,
			warehouse: warehouse
		},
		freeze: true,
		freeze_message: 'Loading items...',
		callback: function(r) {
			page.adjustment_items = r.message || [];
			render_grid(page, item_group);
		}
	});
}

function render_grid(page, item_group) {
	let $body = $(page.body).find('.sa-rows-body');
	$body.empty();
	
	let is_glass = item_group === 'Glass';
	
	let thead_html = `
		<tr>
			<th style="text-align:left;">Item</th>
			<th style="text-align:left; width:100%;">Description</th>
			<th style="text-align:right; white-space:nowrap;">Current Qty</th>
			${is_glass ? `
			<th style="text-align:right; white-space:nowrap;" class="sa-col-glass">Current Sheets</th>
			<th style="text-align:left; white-space:nowrap;" class="sa-col-glass">Sheet Size</th>
			<th style="text-align:right; white-space:nowrap;" class="sa-col-glass">New Sheets</th>
			<th style="text-align:right; white-space:nowrap;" class="sa-col-glass">Sheet Diff</th>
			` : ''}
			<th style="text-align:right; white-space:nowrap;">New Qty</th>
			<th style="text-align:right; white-space:nowrap;">Qty Difference</th>
			<th style="text-align:left; white-space:nowrap;">U/M</th>
		</tr>
	`;
	$(page.body).find('.sa-table thead').html(thead_html);
	
	if (!page.adjustment_items.length) {
		let cols = is_glass ? 10 : 6;
		$body.html(`<tr><td colspan="${cols}" style="text-align:center;padding:24px;color:var(--text-muted);">No active stock items found for this group.</td></tr>`);
		$(page.body).find('.sa-submit-btn').prop('disabled', true);
		return;
	}
	
	$(page.body).find('.sa-submit-btn').prop('disabled', false);
	
	let sheet_opts = '<option value=""></option>' + (page.se_options.sheet_sizes || []).map(s => `<option value="${frappe.utils.escape_html(s.size)}">${frappe.utils.escape_html(s.size)}</option>`).join('');
	
	page.adjustment_items.forEach((item, idx) => {
		let current_qty_display = flt(item.current_qty, 4);
		
		let glass_cols = '';
		if (is_glass) {
			glass_cols = `
				<td style="padding:10px 14px; text-align:right; font-weight:bold; color:var(--text-muted);" class="sa-col-glass sa-current-sheets"></td>
				<td style="padding:4px 8px;" class="sa-col-glass"><select class="form-control sa-select-sheet-size" style="width:120px;height:30px;padding:4px;display:inline-block;">${sheet_opts}</select></td>
				<td style="padding:4px 8px; text-align:right;" class="sa-col-glass"><input type="number" class="form-control sa-input-sheets" style="width:100px;height:30px;padding:4px;text-align:right;display:inline-block;" min="0" step="any"></td>
				<td style="padding:10px 14px; text-align:right; font-weight:bold;" class="sa-col-glass sa-sheet-diff"></td>
			`;
		}
		
		let new_qty_input = is_glass ? 
			`<input type="number" class="form-control sa-input-new-qty" style="width:100px;height:30px;padding:4px;text-align:right;background-color:var(--control-bg);display:inline-block;" disabled>` : 
			`<input type="number" class="form-control sa-input-new-qty" style="width:100px;height:30px;padding:4px;text-align:right;display:inline-block;" min="0" step="any">`;
		
		$body.append(`
			<tr data-idx="${idx}">
				<td style="padding:10px 14px;">${frappe.utils.escape_html(item.item_code)}</td>
				<td style="padding:10px 14px; white-space: normal;">${frappe.utils.escape_html(item.description || '')}</td>
				<td style="padding:10px 14px; text-align:right;">${current_qty_display}</td>
				${glass_cols}
				<td style="padding:4px 8px; text-align:right;">${new_qty_input}</td>
				<td style="padding:10px 14px; text-align:right; font-weight:bold;" class="sa-qty-diff"></td>
				<td style="padding:10px 14px;">${frappe.utils.escape_html(item.stock_uom)}</td>
			</tr>
		`);
	});
}

function submit_reconciliation(page) {
	let warehouse = $(page.body).find('.sa-warehouse').val();
	
	let modified_items = [];
	page.adjustment_items.forEach(item => {
		if (item.new_qty !== null && item.new_qty !== undefined) {
			if (flt(item.new_qty) !== flt(item.current_qty)) {
				modified_items.push({
					item_code: item.item_code,
					new_qty: item.new_qty
				});
			}
		}
	});
	
	if (!modified_items.length) {
		frappe.msgprint('No quantities were changed. Please update at least one item.');
		return;
	}
	
	frappe.confirm(`Submit Stock Reconciliation for ${modified_items.length} item(s)?`, function() {
		frappe.call({
			method: 'crystal_alluminium_works.crystal_alluminium_works.page.stock_adjustment.stock_adjustment.submit_stock_reconciliation',
			args: {
				payload: JSON.stringify({
					warehouse: warehouse,
					items: modified_items
				})
			},
			freeze: true,
			freeze_message: 'Submitting reconciliation...',
			callback: function(r) {
				if (!r.exc && r.message) {
					frappe.show_alert({ message: `Stock Reconciliation created: ${r.message}`, indicator: 'green' });
					load_items(page);
				}
			}
		});
	});
}

function get_stock_adjustment_html() {
	return `
	<style>
		.sa-container { max-width: calc(1400px + 1rem); margin: 0 auto; padding: 20px 16px; font-family: var(--font-stack); }
		.sa-table th, .sa-table td { white-space: nowrap; }
		.sa-card { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px; }
		.sa-grid { display: flex; gap: 16px; align-items: flex-end; }
		.sa-field { flex: 1; max-width: 300px; }
		.sa-field label { display:block; font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.4px; }
		.sa-table { width: 100%; border-collapse: collapse; }
		.sa-table thead th { padding: 10px 14px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border-color); background: var(--subtle-fg); }
		.sa-table tbody tr:not(:last-child) td { border-bottom: 1px solid var(--border-color); }
		.sa-header { display:flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
	</style>
	<div class="sa-container">
		<div class="sa-card">
			<div class="sa-grid">
				<div class="sa-field">
					<label>Warehouse</label>
					<select class="form-control sa-warehouse"></select>
				</div>
				<div class="sa-field">
					<label>Item Group</label>
					<select class="form-control sa-item-group"></select>
				</div>
				<div>
					<button class="btn btn-primary sa-load-btn">Load Items</button>
				</div>
			</div>
		</div>

		<div class="sa-card" style="padding:0;overflow:auto;max-height:600px;">
			<table class="sa-table">
				<thead>
					<tr>
						<th style="text-align:left;">Item</th>
						<th style="text-align:left;">Description</th>
						<th style="text-align:right;">Current Qty</th>
						<th style="text-align:right;">New Qty</th>
						<th style="text-align:right;">Qty Difference</th>
						<th style="text-align:left;">U/M</th>
					</tr>
				</thead>
				<tbody class="sa-rows-body">
					<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted);">Select Warehouse and Item Group to load items.</td></tr>
				</tbody>
			</table>
		</div>

		<div style="text-align:right;">
			<button class="btn btn-primary sa-submit-btn" disabled>Submit Reconciliation</button>
		</div>
	</div>
	`;
}