const SE_STOCK_CATEGORIES = ['Aluminium', 'Glass', 'Fittings', 'Ceiling', 'Rubber', 'Silicone'];

frappe.pages['caw-stock-entry'].on_page_load = function(wrapper) {
	let page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Stock Entry (Stock In)',
		single_column: true
	});

	page.se_rows = [];
	page.se_options = { suppliers: [], warehouses: [], sheet_sizes: [], default_warehouse: '' };
	page.se_sheet_map = {};

	page.set_secondary_action('Back to Dashboard', function() {
		frappe.set_route('crystal-aluminium-wo');
	});

	page.add_button('Recent Stock Entries', function() {
		frappe.set_route('recent-stock-entries');
	}, { icon: 'history' });

	$(page.body).html(get_stock_entry_html());
	bind_stock_entry_events(page);
	load_stock_entry_options(page);
};

function load_stock_entry_options(page) {
	frappe.call({
		method: 'crystal_alluminium_works.api.get_stock_entry_options',
		freeze: true,
		freeze_message: 'Loading...',
		callback: function(r) {
			let opt = r.message || {};
			page.se_options = opt;
			page.se_sheet_map = {};
			(opt.sheet_sizes || []).forEach(s => { page.se_sheet_map[s.size] = flt(s.sft); });

			let $supplier = $(page.body).find('.se-supplier');
			$supplier.empty().append('<option value="">Select Supplier...</option>');
			(opt.suppliers || []).forEach(s => {
				$supplier.append(`<option value="${frappe.utils.escape_html(s.name)}">${frappe.utils.escape_html(s.supplier_name || s.name)}</option>`);
			});

			let $wh = $(page.body).find('.se-warehouse');
			$wh.empty();
			(opt.warehouses || []).forEach(w => {
				$wh.append(`<option value="${frappe.utils.escape_html(w)}">${frappe.utils.escape_html(w)}</option>`);
			});
			if (opt.default_warehouse) $wh.val(opt.default_warehouse);

			let now = frappe.datetime.now_datetime(); // "YYYY-MM-DD HH:MM:SS"
			$(page.body).find('.se-posting-datetime').val(now.slice(0, 16).replace(' ', 'T'));
		}
	});
}

function bind_stock_entry_events(page) {
	$(page.body).on('click', '.se-add-item-btn', function() {
		open_add_item_dialog(page);
	});

	$(page.body).on('click', '.se-remove-row', function() {
		let idx = parseInt($(this).data('idx'), 10);
		page.se_rows.splice(idx, 1);
		render_stock_rows(page);
	});

	$(page.body).on('click', '.se-submit-btn', function() {
		submit_stock_entry(page);
	});
}

function open_add_item_dialog(page) {
	let d = new frappe.ui.Dialog({
		title: 'Add Item',
		fields: [
			{
				fieldtype: 'Select',
				fieldname: 'category',
				label: 'Category',
				options: SE_STOCK_CATEGORIES.join('\n'),
				reqd: 1
			},
			{
				fieldtype: 'Link',
				fieldname: 'item_code',
				label: 'Item',
				options: 'Item',
				reqd: 1,
				depends_on: 'eval:doc.category',
				description: 'Select from the list or type to search.',
				get_query: function() {
					let category = d.get_value('category');
					let filters = { is_stock_item: 1, disabled: 0, item_group: category };
					if (category === 'Glass') filters.custom_glass_type = ['!=', 'Laminated'];
					return { filters: filters };
				}
			},
			{ fieldtype: 'Data', fieldname: 'stock_uom', label: 'Stock UOM', read_only: 1 },
			{ fieldtype: 'Section Break' },
			{
				fieldtype: 'Select', fieldname: 'sheet_size', label: 'Sheet Size',
				options: '', depends_on: "eval:doc.category=='Glass'",
				mandatory_depends_on: "eval:doc.category=='Glass'"
			},
			{
				fieldtype: 'Float', fieldname: 'pcs', label: 'Pieces',
				depends_on: "eval:doc.category=='Glass' || doc.category=='Ceiling'"
			},
			{
				// sft per sheet (Glass) or sqm per piece (Ceiling); hidden, drives recompute
				fieldtype: 'Float', fieldname: 'unit_factor', hidden: 1, default: 0
			},
			{
				fieldtype: 'Data', fieldname: 'computed_area', label: 'Total Quantity (computed)', read_only: 1,
				depends_on: "eval:doc.category=='Glass' || doc.category=='Ceiling'"
			},
			{
				fieldtype: 'Column Break'
			},
			{
				fieldtype: 'Float', fieldname: 'qty', label: 'Quantity',
				depends_on: "eval:doc.category!='Glass' && doc.category!='Ceiling'"
			},
			{ fieldtype: 'Currency', fieldname: 'rate', label: 'Rate (KES, optional)', default: 0 },
			{ fieldtype: 'Currency', fieldname: 'amount', label: 'Total Amount (KES)', read_only: 1, default: 0 },
			{ fieldtype: 'Section Break' },
			{ fieldtype: 'Small Text', fieldname: 'remarks', label: 'Remarks', description: 'Optional note for this item.' }
		],
		primary_action_label: 'Add',
		primary_action: function(values) {
			let row = build_row_from_values(page, values);
			if (!row) return;
			page.se_rows.push(row);
			render_stock_rows(page);
			d.hide();
		}
	});

	// Populate sheet sizes
	let size_opts = ['', ...(page.se_options.sheet_sizes || []).map(s => s.size)].join('\n');
	d.set_df_property('sheet_size', 'options', size_opts);

	const rate_label = (category) => {
		if (category === 'Glass') return 'Rate per Sheet (KES)';
		if (category === 'Ceiling') return 'Rate per Piece (KES)';
		return 'Rate (KES, optional)';
	};

	// Changing category clears whatever item was picked under the old category
	d.fields_dict.category.df.onchange = function() {
		d.set_value('item_code', '');
		d.set_value('stock_uom', '');
		d.set_value('unit_factor', 0);
		d.set_df_property('rate', 'label', rate_label(d.get_value('category')));
	};

	// When item selected, fetch its stock UOM; for Ceiling also fetch the
	// per-piece area (sqm) so pieces -> qty can be computed.
	d.fields_dict.item_code.df.onchange = function() {
		let code = d.get_value('item_code');
		if (!code) return;
		frappe.db.get_value('Item', code, ['stock_uom']).then(res => {
			let v = res.message || {};
			d.set_value('stock_uom', v.stock_uom || '');
		});
		if (d.get_value('category') === 'Ceiling') {
			frappe.call({
				method: 'crystal_alluminium_works.api.get_ceiling_piece_area',
				args: { item_code: code },
				callback: function(r) {
					d.set_value('unit_factor', flt(r.message || 0));
					recompute();
				}
			});
		}
	};

	const recompute = () => {
		let category = d.get_value('category');
		let qty, amount;
		let rate = flt(d.get_value('rate') || 0);
		if (category === 'Glass') {
			let sft = flt(page.se_sheet_map[d.get_value('sheet_size')] || 0);
			d.set_value('unit_factor', sft);
			let pcs = flt(d.get_value('pcs') || 0);
			qty = flt(sft * pcs);
			amount = flt(pcs * rate); // rate = price per sheet
			d.set_value('computed_area', `${flt(qty, 4)} SFT (${flt(sft, 4)}/sheet)`);
		} else if (category === 'Ceiling') {
			let factor = flt(d.get_value('unit_factor') || 0);
			let pcs = flt(d.get_value('pcs') || 0);
			qty = flt(factor * pcs);
			amount = flt(pcs * rate); // rate = price per piece
			d.set_value('computed_area', `${flt(qty, 4)} ${d.get_value('stock_uom') || 'Sq.M'} (${flt(factor, 4)}/pc)`);
		} else {
			qty = flt(d.get_value('qty') || 0);
			amount = flt(qty * rate); // rate = price per stock UOM
		}
		d.set_value('amount', amount);
	};
	['sheet_size', 'pcs', 'qty', 'rate'].forEach(f => {
		if (d.fields_dict[f] && d.fields_dict[f].$input) d.fields_dict[f].$input.on('change keyup', recompute);
	});

	d.show();
}

function build_row_from_values(page, values) {
	let category = values.category;
	if (category === 'Glass') {
		let sft = flt(page.se_sheet_map[values.sheet_size] || 0);
		let pcs = flt(values.pcs || 0);
		if (!values.sheet_size || sft <= 0 || pcs <= 0) {
			frappe.msgprint('Select a sheet size and enter pieces.');
			return null;
		}
		let rate = flt(values.rate || 0); // price per sheet
		let qty = flt(sft * pcs);
		return {
			item_code: values.item_code,
			category: category,
			sheet_size: values.sheet_size,
			unit_factor: sft,
			pcs: pcs,
			qty: qty,
			stock_uom: values.stock_uom,
			rate: rate,
			amount: flt(pcs * rate),
			remarks: values.remarks || ''
		};
	}
	if (category === 'Ceiling') {
		let factor = flt(values.unit_factor || 0);
		let pcs = flt(values.pcs || 0);
		if (factor <= 0 || pcs <= 0) {
			frappe.msgprint('Enter pieces for this ceiling item.');
			return null;
		}
		let rate = flt(values.rate || 0); // price per piece
		let qty = flt(factor * pcs);
		return {
			item_code: values.item_code,
			category: category,
			sheet_size: '',
			unit_factor: factor,
			pcs: pcs,
			qty: qty,
			stock_uom: values.stock_uom,
			rate: rate,
			amount: flt(pcs * rate),
			remarks: values.remarks || ''
		};
	}
	let qty = flt(values.qty || 0);
	if (qty <= 0) {
		frappe.msgprint('Enter a quantity.');
		return null;
	}
	let rate = flt(values.rate || 0);
	return {
		item_code: values.item_code,
		category: category,
		sheet_size: '',
		unit_factor: 0,
		pcs: 0,
		qty: qty,
		stock_uom: values.stock_uom,
		rate: rate,
		amount: flt(qty * rate),
		remarks: values.remarks || ''
	};
}

function render_stock_rows(page) {
	let $body = $(page.body).find('.se-rows-body');
	$body.empty();
	if (!page.se_rows.length) {
		$body.html('<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text-muted);">No items added yet.</td></tr>');
		$(page.body).find('.se-submit-btn').prop('disabled', true);
		$(page.body).find('.se-grand-total').text(format_currency(0, 'KES'));
		return;
	}
	$(page.body).find('.se-submit-btn').prop('disabled', false);
	let total = 0;
	page.se_rows.forEach((row, idx) => {
		let detail = '&mdash;';
		let rate_suffix = '';
		if (row.category === 'Glass') {
			detail = `${row.pcs} pcs &times; ${frappe.utils.escape_html(row.sheet_size)} (${row.unit_factor} SFT)`;
			rate_suffix = ' /sheet';
		} else if (row.category === 'Ceiling') {
			detail = `${row.pcs} pcs &times; ${row.unit_factor} ${frappe.utils.escape_html(row.stock_uom || 'Sq.M')}/pc`;
			rate_suffix = ' /pc';
		}
		let amount = flt(row.amount || 0);
		total += amount;
		let item_title = row.remarks ? ` title="${frappe.utils.escape_html(row.remarks)}"` : '';
		$body.append(`
			<tr>
				<td style="padding:10px 14px;"${item_title}>${frappe.utils.escape_html(row.item_code)}${row.remarks ? ' <span style="color:var(--text-muted);">&#128172;</span>' : ''}</td>
				<td style="padding:10px 14px;">${frappe.utils.escape_html(row.category || '')}</td>
				<td style="padding:10px 14px;">${detail}</td>
				<td style="padding:10px 14px;">${row.pcs > 0 ? flt(row.pcs) : flt(row.qty)}</td>
				<td style="padding:10px 14px;">${flt(row.qty, 4)}</td>
				<td style="padding:10px 14px;">${frappe.utils.escape_html(row.stock_uom || '')}</td>
				<td style="padding:10px 14px;">${format_currency(row.rate, 'KES')}<span style="color:var(--text-muted);">${rate_suffix}</span></td>
				<td style="padding:10px 14px;">${format_currency(amount, 'KES')}</td>
				<td style="padding:10px 14px;text-align:center;">
					<button class="btn btn-xs btn-danger se-remove-row" data-idx="${idx}">Remove</button>
				</td>
			</tr>
		`);
	});
	$(page.body).find('.se-grand-total').text(format_currency(total, 'KES'));
}

function submit_stock_entry(page) {
	let supplier = $(page.body).find('.se-supplier').val();
	let warehouse = $(page.body).find('.se-warehouse').val();
	let posting_datetime = $(page.body).find('.se-posting-datetime').val(); // "YYYY-MM-DDTHH:MM"
	let posting_date = posting_datetime ? posting_datetime.split('T')[0] : '';
	let posting_time = posting_datetime && posting_datetime.includes('T')
		? `${posting_datetime.split('T')[1]}:00`
		: '';

	if (!supplier) {
		frappe.msgprint('Select a supplier.');
		return;
	}
	if (!page.se_rows.length) {
		frappe.msgprint('Add at least one item.');
		return;
	}

	frappe.confirm(`Receive ${page.se_rows.length} item(s) into stock?`, function() {
		frappe.call({
			method: 'crystal_alluminium_works.api.create_stock_receipt',
			args: {
				payload: JSON.stringify({
					supplier: supplier,
					warehouse: warehouse,
					posting_date: posting_date,
					posting_time: posting_time,
					items: page.se_rows
				})
			},
			freeze: true,
			freeze_message: 'Creating stock receipt...',
			callback: function(r) {
				if (!r.exc && r.message) {
					frappe.show_alert({ message: `Stock received: ${r.message.name}`, indicator: 'green' });
					page.se_rows = [];
					render_stock_rows(page);
					frappe.set_route('recent-stock-entries');
				}
			}
		});
	});
}

function get_stock_entry_html() {
	return `
	<style>
		.se-container { max-width: calc(1400px + 1rem); margin: 0 auto; padding: 20px 16px; font-family: var(--font-stack); }
		.se-table th, .se-table td { white-space: nowrap; }
		.se-card { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px; }
		.se-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
		.se-field label { display:block; font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.4px; }
		.se-table { width: 100%; border-collapse: collapse; }
		.se-table thead th { padding: 10px 14px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border-color); background: var(--subtle-fg); }
		.se-table tbody tr:not(:last-child) td { border-bottom: 1px solid var(--border-color); }
		.se-header { display:flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
	</style>
	<div class="se-container">
		<div class="se-header">
			<h2 style="margin:0;font-weight:600;">Stock Entry &mdash; Receive Stock</h2>
			<button class="btn btn-primary se-add-item-btn">+ Add Item</button>
		</div>

		<div class="se-card">
			<div class="se-grid">
				<div class="se-field">
					<label>Supplier</label>
					<select class="form-control se-supplier"></select>
				</div>
				<div class="se-field">
					<label>Receiving Warehouse</label>
					<select class="form-control se-warehouse"></select>
				</div>
				<div class="se-field">
					<label>Posting Date &amp; Time</label>
					<input type="datetime-local" class="form-control se-posting-datetime">
				</div>
			</div>
		</div>

		<div class="se-card" style="padding:0;overflow:hidden;">
			<table class="se-table">
				<thead>
					<tr>
						<th style="text-align:left;">Item</th>
						<th style="text-align:left;">Category</th>
						<th style="text-align:left;">Item Detail</th>
						<th style="text-align:left;">Stock Qty</th>
						<th style="text-align:left;">Total UOM</th>
						<th style="text-align:left;">UOM</th>
						<th style="text-align:left;">Rate</th>
						<th style="text-align:left;">Amount</th>
						<th style="text-align:center;">Action</th>
					</tr>
				</thead>
				<tbody class="se-rows-body">
					<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text-muted);">No items added yet.</td></tr>
				</tbody>
			</table>
		</div>

		<div style="display:flex;justify-content:flex-end;align-items:center;gap:24px;margin-bottom:16px;">
			<div style="font-weight:600;">Total: <span class="se-grand-total">${format_currency(0, 'KES')}</span></div>
		</div>

		<div style="text-align:right;">
			<button class="btn btn-primary se-submit-btn" disabled>Receive Stock</button>
		</div>
	</div>
	`;
}
