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
	
	// Non-glass rows: New Qty is typed directly.
	$(page.body).on('change keyup', '.sa-input-new-qty', function() {
		let $row = $(this).closest('tr');
		let idx = $row.data('idx');
		let item = page.adjustment_items[idx];
		let is_glass = $(page.body).find('.sa-item-group').val() === 'Glass';
		if (is_glass) return; // Glass rows derive New Qty from the Sheet Sizes modal instead.

		let val = $(this).val();
		item.new_qty = val !== '' ? flt(val) : null;
		update_qty_diff_display($row, item);
	});

	// Glass rows: New Qty is derived from per-size sheet counts entered in the modal.
	$(page.body).on('click', '.sa-sheet-sizes-btn', function() {
		let $row = $(this).closest('tr');
		let idx = $row.data('idx');
		open_sheet_sizes_modal(page, $row, idx);
	});
}

function update_qty_diff_display($row, item) {
	if (item.new_qty !== null && item.new_qty !== undefined) {
		let diff = flt(item.new_qty - item.current_qty);
		$row.find('.sa-qty-diff').text(flt(diff, 4));
		if (diff > 0) $row.find('.sa-qty-diff').css('color', 'green');
		else if (diff < 0) $row.find('.sa-qty-diff').css('color', 'red');
		else $row.find('.sa-qty-diff').css('color', 'inherit');
	} else {
		$row.find('.sa-qty-diff').text('').css('color', 'inherit');
	}
}

// The button shows only the first sheet size — either the first one the user edited,
// or (before any edit) the first size the item currently holds stock in.
function get_primary_sheet_size(item) {
	let edited_sizes = Object.keys(item.sheet_edits || {});
	if (edited_sizes.length) return edited_sizes[0];
	let existing_sizes = Object.keys(item.sheet_balance || {});
	if (existing_sizes.length) return existing_sizes[0];
	return '';
}

function build_sheet_option_html(page, selected_size) {
	let opts = '<option value=""></option>';
	(page.se_options.sheet_sizes || []).forEach(s => {
		let selected = s.size === selected_size ? 'selected' : '';
		opts += `<option value="${frappe.utils.escape_html(s.size)}" ${selected}>${frappe.utils.escape_html(s.size)}</option>`;
	});
	return opts;
}

function open_sheet_sizes_modal(page, $row, idx) {
	let item = page.adjustment_items[idx];
	item.sheet_balance = item.sheet_balance || {};
	item.sheet_edits = item.sheet_edits || {};

	// Prior edits (if the modal is reopened) take precedence over the stock sizes,
	// so in-progress input isn't lost.
	let sizes = Object.keys(item.sheet_edits).length
		? Object.keys(item.sheet_edits)
		: Object.keys(item.sheet_balance);

	let initial_rows = sizes.map(size => ({
		size: size,
		new_sheets: item.sheet_edits[size] !== undefined ? item.sheet_edits[size] : flt(item.sheet_balance[size] || 0)
	}));
	if (!initial_rows.length) initial_rows.push({ size: '', new_sheets: '' });

	let build_row_html = (row) => `
		<tr class="sa-sheet-modal-row">
			<td>
				<div style="display:flex;align-items:center;gap:8px;">
					<select class="form-control sa-modal-sheet-size" style="flex:1;">${build_sheet_option_html(page, row.size)}</select>
					<button type="button" class="btn btn-xs btn-danger sa-modal-remove-row">✕</button>
				</div>
				<div class="sa-modal-current-hint" style="font-size:11px;color:var(--text-muted);margin-top:4px;">Current: ${flt(item.sheet_balance[row.size] || 0, 2)}</div>
			</td>
			<td><input type="number" class="form-control sa-modal-new-sheets" min="0" step="any" value="${row.new_sheets === '' || row.new_sheets === null || row.new_sheets === undefined ? '' : row.new_sheets}"></td>
		</tr>
	`;

	let d = new frappe.ui.Dialog({
		title: `Sheet Sizes — ${item.item_code}`,
		fields: [{ fieldtype: 'HTML', fieldname: 'grid' }],
		primary_action_label: 'Save',
		primary_action: function() {
			let sheet_edits = {};
			d.$wrapper.find('.sa-sheet-modal-row').each(function() {
				let size = $(this).find('.sa-modal-sheet-size').val();
				let val = $(this).find('.sa-modal-new-sheets').val();
				if (size && val !== '') {
					sheet_edits[size] = flt(val);
				}
			});

			item.sheet_edits = sheet_edits;
			apply_glass_row_update(page, $row, item);
			d.hide();
		}
	});

	d.fields_dict.grid.$wrapper.html(`
		<table class="table table-bordered sa-sheet-modal-table">
			<thead><tr><th>Sheet Size</th><th style="width:140px;">New Sheets</th></tr></thead>
			<tbody>${initial_rows.map(build_row_html).join('')}</tbody>
		</table>
		<button type="button" class="btn btn-xs btn-default sa-modal-add-row" style="margin-top:8px;">+ Add Sheet Size</button>
	`);

	d.$wrapper.on('change', '.sa-modal-sheet-size', function() {
		let $select = $(this);
		let size = $select.val();
		let current = flt(item.sheet_balance[size] || 0);
		$select.closest('td').find('.sa-modal-current-hint').text(`Current: ${flt(current, 2)}`);
		let $qty = $select.closest('tr').find('.sa-modal-new-sheets');
		if ($qty.val() === '') $qty.val(current);
	});

	d.$wrapper.on('click', '.sa-modal-add-row', function() {
		d.$wrapper.find('.sa-sheet-modal-table tbody').append(build_row_html({ size: '', new_sheets: '' }));
	});

	d.$wrapper.on('click', '.sa-modal-remove-row', function() {
		let $rows = d.$wrapper.find('.sa-sheet-modal-row');
		if ($rows.length <= 1) {
			// Always leave one row so the user can still pick a size.
			$(this).closest('tr').find('.sa-modal-sheet-size').val('');
			$(this).closest('tr').find('.sa-modal-new-sheets').val('');
			$(this).closest('tr').find('.sa-modal-current-hint').text('Current: 0');
			return;
		}
		$(this).closest('tr').remove();
	});

	d.show();
}

// Recomputes New Qty for a glass item from item.sheet_edits (net across every
// size touched) and refreshes the row's summary cells + the sheet-size button.
function apply_glass_row_update(page, $row, item) {
	let sizes = Object.keys(item.sheet_edits || {});

	let total_current_sheets = 0;
	Object.keys(item.sheet_balance || {}).forEach(size => {
		total_current_sheets += flt(item.sheet_balance[size]);
	});
	$row.find('.sa-current-sheets').text(flt(total_current_sheets, 2));

	if (!sizes.length) {
		item.new_qty = null;
		$row.find('.sa-sheet-diff').text('').css('color', 'inherit');
	} else {
		let total_diff_qty = 0;
		let total_diff_sheets = 0;
		sizes.forEach(size => {
			let sft = flt(page.se_sheet_map[size] || 0);
			let current = flt((item.sheet_balance && item.sheet_balance[size]) || 0);
			let new_sheets = flt(item.sheet_edits[size]);
			let diff = new_sheets - current;
			total_diff_sheets += diff;
			total_diff_qty += diff * sft;
		});
		item.new_qty = flt(flt(item.current_qty) + total_diff_qty);

		let $diff = $row.find('.sa-sheet-diff');
		$diff.text(flt(total_diff_sheets, 2));
		if (total_diff_sheets > 0) $diff.css('color', 'green');
		else if (total_diff_sheets < 0) $diff.css('color', 'red');
		else $diff.css('color', 'inherit');
	}

	$row.find('.sa-sheet-sizes-btn').text(get_primary_sheet_size(item) || 'Select Sizes');
	$row.find('.sa-input-new-qty').val(item.new_qty !== null && item.new_qty !== undefined ? flt(item.new_qty, 4) : '');
	update_qty_diff_display($row, item);
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
			<th style="text-align:left; white-space:nowrap;" class="sa-col-glass">Sheet Sizes</th>
			<th style="text-align:right; white-space:nowrap;" class="sa-col-glass">Sheet Diff</th>
			` : ''}
			<th style="text-align:right; white-space:nowrap;">New Qty</th>
			<th style="text-align:right; white-space:nowrap;">Qty Difference</th>
			<th style="text-align:left; white-space:nowrap;">U/M</th>
		</tr>
	`;
	$(page.body).find('.sa-table thead').html(thead_html);
	
	if (!page.adjustment_items.length) {
		let cols = is_glass ? 9 : 6;
		$body.html(`<tr><td colspan="${cols}" style="text-align:center;padding:24px;color:var(--text-muted);">No active stock items found for this group.</td></tr>`);
		$(page.body).find('.sa-submit-btn').prop('disabled', true);
		return;
	}
	
	$(page.body).find('.sa-submit-btn').prop('disabled', false);

	page.adjustment_items.forEach((item, idx) => {
		let current_qty_display = flt(item.current_qty, 4);

		let glass_cols = '';
		if (is_glass) {
			item.sheet_balance = item.sheet_balance || {};
			item.sheet_edits = {};

			let total_current_sheets = 0;
			Object.keys(item.sheet_balance).forEach(size => { total_current_sheets += flt(item.sheet_balance[size]); });
			let primary_size = get_primary_sheet_size(item);

			glass_cols = `
				<td style="padding:10px 14px; text-align:right; font-weight:bold; color:var(--text-muted);" class="sa-col-glass sa-current-sheets">${flt(total_current_sheets, 2)}</td>
				<td style="padding:8px 14px;" class="sa-col-glass"><button type="button" class="btn btn-xs btn-default sa-sheet-sizes-btn" style="min-width:110px;">${primary_size ? frappe.utils.escape_html(primary_size) : 'Select Sizes'}</button></td>
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
	let item_group = $(page.body).find('.sa-item-group').val();
	let is_glass = item_group === 'Glass';

	let modified_items = [];
	page.adjustment_items.forEach(item => {
		if (is_glass) {
			// Sent as absolute per-size targets, not net qty: two sizes on the same
			// item can shift in opposite directions and cancel out in total SFT while
			// still being a real change the sheet-count ledger needs to know about.
			let sheet_targets = {};
			let changed = false;
			Object.keys(item.sheet_edits || {}).forEach(size => {
				let current = flt((item.sheet_balance && item.sheet_balance[size]) || 0);
				let target = flt(item.sheet_edits[size]);
				sheet_targets[size] = target;
				if (Math.abs(target - current) > 0.0001) changed = true;
			});
			if (changed) {
				modified_items.push({ item_code: item.item_code, sheet_targets: sheet_targets });
			}
		} else if (item.new_qty !== null && item.new_qty !== undefined && flt(item.new_qty) !== flt(item.current_qty)) {
			modified_items.push({ item_code: item.item_code, new_qty: item.new_qty });
		}
	});

	if (!modified_items.length) {
		frappe.msgprint(is_glass ? 'No sheet counts were changed. Please update at least one size.' : 'No quantities were changed. Please update at least one item.');
		return;
	}

	frappe.confirm(`Submit Stock ${is_glass ? 'Adjustment' : 'Reconciliation'} for ${modified_items.length} item(s)?`, function() {
		frappe.call({
			method: 'crystal_alluminium_works.crystal_alluminium_works.page.stock_adjustment.stock_adjustment.submit_stock_reconciliation',
			args: {
				payload: JSON.stringify({
					warehouse: warehouse,
					item_group: item_group,
					items: modified_items
				})
			},
			freeze: true,
			freeze_message: `Submitting ${is_glass ? 'adjustment' : 'reconciliation'}...`,
			callback: function(r) {
				if (!r.exc && r.message) {
					frappe.show_alert({ message: `Stock ${is_glass ? 'Entry' : 'Reconciliation'} created: ${r.message}`, indicator: 'green' });
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