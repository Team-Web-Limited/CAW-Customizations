const MI_GLASS_CATEGORIES = ['Ordinary Glass', 'Laminated Glass', 'Ready Laminated Glass', 'Toughened Glass'];
const MI_CONFIGURABLE_GLASS_CATEGORIES = new Set(MI_GLASS_CATEGORIES);
const MI_SHEET_GLASS_CATEGORIES = new Set(['Ordinary Glass', 'Ready Laminated Glass']);
const MI_STANDARD_INTERVAL_SET = 'Standard Glass';
const MI_TOUGHENED_INTERVAL_SET = 'Toughened Glass';
const MI_ALUMINIUM_PRICE_FACTOR = 1.07;
const MI_DEFAULT_PRODUCT_CODES = {
	'Aluminium': 'A01',
	'Ordinary Glass': 'OG',
	'Laminated Glass': 'LG',
	'Ready Laminated Glass': 'RLG',
	'Toughened Glass': 'TG',
	'Fittings': 'F01',
	'Ceiling': 'C01',
	'Rubber': 'R01',
	'Silicone': 'S01'
};
const MI_TABS = [
	{ category: 'Aluminium', label: 'Aluminium' },
	{ category: 'Ordinary Glass', label: 'Ordinary Glass' },
	{ category: 'Laminated Glass', label: 'Laminated Glass' },
	{ category: 'Ready Laminated Glass', label: 'Ready Laminated Glass' },
	{ category: 'Toughened Glass', label: 'Toughened Glass' },
	{ category: 'Fittings', label: 'Fittings' },
	{ category: 'Ceiling', label: 'Ceiling' },
	{ category: 'Rubber', label: 'Rubber' },
	{ category: 'Silicone', label: 'Silicone' }
];

function is_glass_category(category) {
	return MI_CONFIGURABLE_GLASS_CATEGORIES.has(category);
}

function is_sheet_config_category(category) {
	return MI_SHEET_GLASS_CATEGORIES.has(category);
}

function get_interval_set_for_category(category) {
	return category === 'Toughened Glass' ? MI_TOUGHENED_INTERVAL_SET : MI_STANDARD_INTERVAL_SET;
}

function get_sheet_glass_type_for_category(category) {
	return category === 'Ready Laminated Glass' ? 'Ready Laminated' : 'Ordinary';
}

function get_default_product_code(category) {
	if (category === 'Aluminium') {
		return MI_DEFAULT_PRODUCT_CODES.Aluminium;
	}

	return MI_DEFAULT_PRODUCT_CODES[category] || '';
}

function get_aluminium_prices(rate_per_kg, weight_per_length) {
	let normal_price = flt(rate_per_kg) * flt(weight_per_length);
	let mill_finished_price = MI_ALUMINIUM_PRICE_FACTOR ? normal_price / MI_ALUMINIUM_PRICE_FACTOR : normal_price;
	let special_price = normal_price * MI_ALUMINIUM_PRICE_FACTOR;

	return {
		normal_price: flt(normal_price),
		mill_finished_price: flt(mill_finished_price),
		special_price: flt(special_price)
	};
}

frappe.pages['manage-items'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Manage Items',
		single_column: true
	});

	page.mi_all_items = [];
	page.mi_current_category = 'Aluminium';

	page.set_secondary_action('Back to Dashboard', function() {
		frappe.set_route('crystal-aluminium-wo');
	});

	// Inject the HTML
	$(page.body).html(get_manage_items_html());
	bind_manage_items_events(page);
	
	// Default to first tab
	load_category_tab(page, 'Aluminium');
};

function bind_manage_items_events(page) {
	let update_config_buttons = function(category) {
		let is_glass = is_glass_category(category);
		let is_aluminium = category === 'Aluminium';
		let is_sheet_glass = is_sheet_config_category(category);
		$(page.body).find('.mi-config-btn').toggle(is_glass);
		$(page.body).find('.mi-service-btn').toggle(is_glass);
		$(page.body).find('.mi-color-btn').toggle(is_aluminium);
		$(page.body).find('.mi-export-aluminium-btn').toggle(is_aluminium);
		$(page.body).find('.mi-sheets-btn').toggle(is_sheet_glass);
	};

	// Tab switching
	$(page.body).on('click', '.mi-tab', function() {
		$(page.body).find('.mi-tab').removeClass('active');
		$(this).addClass('active');
		let cat = $(this).data('category');

		update_config_buttons(cat);

		toggle_aluminium_search(page, cat);
		
		load_category_tab(page, cat);
	});

	// Configure Intervals
	$(page.body).on('click', '.mi-config-btn', function() {
		open_intervals_modal(page);
	});

	// Configure Service Rates
	$(page.body).on('click', '.mi-service-btn', function() {
		open_service_rates_modal(page);
	});

	$(page.body).on('click', '.mi-sheets-btn', function() {
		open_sheets_modal(page);
	});

	$(page.body).on('click', '.mi-color-btn', function() {
		open_aluminium_colors_modal(page);
	});

	$(page.body).on('click', '.mi-export-aluminium-btn', function() {
		export_aluminium_items();
	});

	// Add new item
	$(page.body).on('click', '.mi-add-btn', function() {
		let cat = $(page.body).find('.mi-tab.active').data('category');
		open_add_choice(page, cat);
	});

	// Edit item
	$(page.body).on('click', '.mi-edit-btn', function() {
		let cat = $(page.body).find('.mi-tab.active').data('category');
		let item = $(this).data('item');
		// Item is stored as JSON string in data attribute
		if (typeof item === 'string') {
			item = JSON.parse(decodeURIComponent(item));
		}
		open_item_modal(page, cat, item);
	});

	$(page.body).on('input', '.mi-search-input', function() {
		let query = ($(this).val() || '').trim().toLowerCase();
		let items = page.mi_all_items || [];
		let filtered = !query
			? items
			: items.filter(item => {
				let item_name = (item.item_name || '').toLowerCase();
				let item_code = (item.item_code || '').toLowerCase();
				let product_code = (item.custom_product_code || '').toLowerCase();
				return item_name.includes(query) || item_code.includes(query) || product_code.includes(query);
			});
		render_items_table(page, filtered);
	});

	// Delete item
	$(page.body).on('click', '.mi-delete-btn', function() {
		let item_code = $(this).data('item-code');
		let cat = $(page.body).find('.mi-tab.active').data('category');
		frappe.confirm(`Are you sure you want to delete item <b>${item_code}</b>?`, function() {
			frappe.call({
				method: 'crystal_alluminium_works.api.delete_items',
				args: { item_codes: [item_code] },
				freeze: true,
				freeze_message: 'Deleting item...',
				callback: function(r) {
					if (!r.exc) {
						frappe.show_alert({message: `Item deleted successfully`, indicator: 'green'});
						load_category_tab(page, cat);
					}
				}
			});
		});
	});

	// Checkbox logic
	$(page.body).on('change', '.mi-select-all', function() {
		let is_checked = $(this).prop('checked');
		$(page.body).find('.mi-select-item').prop('checked', is_checked);
		toggle_mass_delete_btn(page);
	});

	$(page.body).on('change', '.mi-select-item', function() {
		let all_checked = $(page.body).find('.mi-select-item:not(:checked)').length === 0;
		let any_checked = $(page.body).find('.mi-select-item:checked').length > 0;
		$(page.body).find('.mi-select-all').prop('checked', all_checked);
		toggle_mass_delete_btn(page);
	});

	// Mass delete
	$(page.body).on('click', '.mi-mass-delete-btn', function() {
		let cat = $(page.body).find('.mi-tab.active').data('category');
		let item_codes = [];
		$(page.body).find('.mi-select-item:checked').each(function() {
			item_codes.push($(this).data('item-code'));
		});

		if (item_codes.length === 0) return;

		frappe.confirm(`Are you sure you want to delete ${item_codes.length} selected items?`, function() {
			frappe.call({
				method: 'crystal_alluminium_works.api.delete_items',
				args: { item_codes: item_codes },
				freeze: true,
				freeze_message: 'Deleting items...',
				callback: function(r) {
					if (!r.exc) {
						frappe.show_alert({message: `${r.message} items deleted successfully`, indicator: 'green'});
						load_category_tab(page, cat);
					}
				}
			});
		});
	});

	update_config_buttons(page.mi_current_category || 'Aluminium');
}

function toggle_mass_delete_btn(page) {
	if ($(page.body).find('.mi-select-item:checked').length > 0) {
		$(page.body).find('.mi-mass-delete-btn').show();
	} else {
		$(page.body).find('.mi-mass-delete-btn').hide();
	}
}

function toggle_aluminium_search(page, category) {
	let $search = $(page.body).find('.mi-search-wrap');
	let $input = $search.find('.mi-search-input');
	let $code_head = $(page.body).find('.mi-code-head');

	$search.show();
	$code_head.show();
}

function open_add_choice(page, category) {
	let d = new frappe.ui.Dialog({
		title: `Add ${category} Items`,
		fields: [
			{
				fieldtype: 'Select',
				fieldname: 'entry_method',
				label: 'Entry Method',
				options: 'Manual\nUpload',
				default: 'Manual',
				reqd: 1
			}
		],
		primary_action_label: 'Continue',
		primary_action: function(values) {
			d.hide();
			if (values.entry_method === 'Upload') {
				open_upload_modal(page, category);
			} else {
				open_item_modal(page, category, null);
			}
		}
	});

	d.show();
}

function open_upload_modal(page, category) {
	let instructions = category === 'Aluminium'
		? `
			<div style="color:var(--text-muted);margin-bottom:12px;">
				Upload an Excel file with columns: <b>item_name</b>, <b>code</b>, <b>rate_per_kg</b>, and <b>weight_per_length</b>.
				<br><span style="font-size:12px;"><b>Normal Price</b> will be calculated as <b>rate_per_kg * weight_per_length</b>.</span>
			</div>
		`
		: `
			<div style="color:var(--text-muted);margin-bottom:12px;">
				Upload an Excel file with columns: <b>description</b>, <b>code</b>, <b>wholesale_rate</b>, <b>retail_rate</b>, and <b>special_rate</b>.
				<br><span style="font-size:12px;"><b>code</b> is the short name/search key staff use to quickly find the item.</span>
			</div>
		`;

	let d = new frappe.ui.Dialog({
		title: `Upload ${category} Items`,
		fields: [
			{
				fieldtype: 'HTML',
				fieldname: 'instructions',
				options: instructions
			},
			...(category === 'Aluminium' ? [{
				fieldtype: 'HTML',
				fieldname: 'template_download',
				options: `
					<div style="margin-bottom:12px;">
						<button type="button" class="btn btn-default btn-sm mi-download-aluminium-template">Download Aluminium Template</button>
					</div>
				`
			}] : []),
			{
				fieldtype: 'Attach',
				fieldname: 'file_url',
				label: 'Excel File',
				reqd: 1,
				options: {
					restrictions: {
						allowed_file_types: ['.xlsx', '.xls']
					}
				}
			}
		],
		primary_action_label: 'Upload Items',
		primary_action: function(values) {
			frappe.call({
				method: 'crystal_alluminium_works.api.import_category_items',
				args: { file_url: values.file_url, category: category },
				freeze: true,
				freeze_message: `Uploading ${category} items...`,
				callback: function(r) {
					if (!r.exc && r.message) {
						let summary = r.message;
						frappe.msgprint({
							title: 'Upload Complete',
							indicator: summary.errors && summary.errors.length ? 'orange' : 'green',
							message: `
								<div>Created: <b>${summary.created || 0}</b></div>
								<div>Updated: <b>${summary.updated || 0}</b></div>
								<div>Skipped: <b>${summary.skipped || 0}</b></div>
								${summary.errors && summary.errors.length ? `<hr><div>${summary.errors.map(e => frappe.utils.escape_html(e)).join('<br>')}</div>` : ''}
							`
						});
						d.hide();
						load_category_tab(page, category);
					}
				}
			});
		}
	});

	d.show();

	if (category === 'Aluminium') {
		d.$wrapper.on('click', '.mi-download-aluminium-template', function() {
			frappe.call({
				method: 'crystal_alluminium_works.api.download_aluminium_items_template',
				freeze: true,
				freeze_message: 'Preparing template...',
				callback: function(r) {
					if (!r.exc && r.message && r.message.file_url) {
						window.open(r.message.file_url, '_blank');
					}
				}
			});
		});
	}
}

function export_aluminium_items() {
	frappe.call({
		method: 'crystal_alluminium_works.api.export_aluminium_items',
		freeze: true,
		freeze_message: 'Preparing aluminium export...',
		callback: function(r) {
			if (!r.exc && r.message && r.message.file_url) {
				window.open(r.message.file_url, '_blank');
			}
		}
	});
}

function load_category_tab(page, category) {
	page.mi_current_category = category;
	update_table_headers(page, category);
	let $body = $(page.body).find('.mi-table-body');
	let colspan = 8;
	$body.html(`<tr><td colspan="${colspan}" style="text-align:center;padding:24px;color:var(--text-muted);">Loading items...</td></tr>`);
	
	frappe.call({
		method: 'crystal_alluminium_works.api.get_items_with_prices',
		args: { category: category },
		callback: function(r) {
			page.mi_all_items = r.message || [];
			let query = ($(page.body).find('.mi-search-input').val() || '').trim().toLowerCase();
			let items = page.mi_all_items;
			if (query) {
				items = items.filter(item => {
					let item_name = (item.item_name || '').toLowerCase();
					let item_code = (item.item_code || '').toLowerCase();
					let product_code = (item.custom_product_code || '').toLowerCase();
					return item_name.includes(query) || item_code.includes(query) || product_code.includes(query);
				});
			}
			render_items_table(page, items);
		}
	});
}

function update_table_headers(page, category) {
	let is_aluminium = category === 'Aluminium';
	$(page.body).find('.mi-primary-price-head').text('Retail Price');
	$(page.body).find('.mi-price-lists-head').text(is_aluminium ? 'Rate/Kg' : 'Price Lists');
}

function render_items_table(page, items) {
	let $body = $(page.body).find('.mi-table-body');
	$body.empty();
	$(page.body).find('.mi-select-all').prop('checked', false);
	$(page.body).find('.mi-mass-delete-btn').hide();
	let show_code = true;
	let colspan = show_code ? 8 : 7;
	let is_aluminium = page.mi_current_category === 'Aluminium';

	if (!items || items.length === 0) {
		$body.html(`<tr><td colspan="${colspan}" style="text-align:center;padding:24px;color:var(--text-muted);">No items found in this category.</td></tr>`);
		return;
	}

	items.forEach(item => {
		let item_json = encodeURIComponent(JSON.stringify(item));
		let item_code_esc = frappe.utils.escape_html(item.item_code);
		$body.append(`
			<tr>
				<td style="padding:12px 16px; text-align:center;">
					<input type="checkbox" class="mi-select-item" data-item-code="${item_code_esc}">
				</td>
				<td style="padding:12px 16px; font-weight:500;">
					${item.item_name || item.item_code}
				</td>
				<td style="padding:12px 16px;">${item.custom_product_code || ''}</td>
				${show_code ? `<td style="padding:12px 16px;">${item.item_code || ''}</td>` : ''}
				<td style="padding:12px 16px; text-align:center;">
					<span style="background:var(--subtle-fg);padding:2px 8px;border-radius:10px;font-size:11px;">${item.stock_uom}</span>
				</td>
				<td style="padding:12px 16px; text-align:right;">${format_currency(item.retail_rate, 'KES')}</td>
				<td style="padding:12px 16px; text-align:right;">
					${is_aluminium
						? `<div style="font-size:12px;color:var(--text-muted);">Rate/Kg: ${format_currency(item.aluminium_rate_per_kg || 0, 'KES')}</div>`
						: `
							<div style="font-size:12px;color:var(--text-muted);">Retail: ${format_currency(item.retail_rate, 'KES')}</div>
							<div style="font-size:12px;color:var(--text-muted);">Wholesale: ${format_currency(item.wholesale_rate, 'KES')}</div>
							<div style="font-size:12px;color:var(--text-muted);">Special: ${format_currency(item.special_rate || 0, 'KES')}</div>
						`
					}
				</td>
				<td style="padding:12px 16px; text-align:center;">
					<button class="btn btn-xs btn-default mi-edit-btn" data-item="${item_json}">Edit</button>
					<button class="btn btn-xs btn-danger mi-delete-btn" data-item-code="${item_code_esc}" style="margin-left:4px;">Delete</button>
				</td>
			</tr>
		`);
	});
}

function open_item_modal(page, category, existing_item) {
	let is_new = !existing_item;
	let is_aluminium = category === 'Aluminium';
	let default_product_code = existing_item && existing_item.custom_product_code
		? existing_item.custom_product_code
		: get_default_product_code(category);
	let aluminium_defaults = existing_item
		? get_aluminium_prices(existing_item.aluminium_rate_per_kg || 0, existing_item.aluminium_weight_per_length || 0)
		: { normal_price: 0, mill_finished_price: 0, special_price: 0 };
	
	let fields = [
		{ fieldtype: 'Data', fieldname: 'product_code', label: 'Product Code', read_only: 1, default: default_product_code },
		{
			fieldtype: 'Data',
			fieldname: 'item_code',
			label: 'Code / Search Key',
			description: 'Use the short code staff know the item by and can search easily.',
			reqd: 1,
			default: is_new ? '' : existing_item.item_code
		},
		{ fieldtype: 'Data', fieldname: 'item_name', label: 'Item Name (Description)', reqd: 1, default: is_new ? '' : existing_item.item_name },
	];

	if (is_aluminium) {
		fields = fields.concat([
			{ fieldtype: 'Section Break', label: 'Pricing' },
			{
				fieldtype: 'Currency',
				fieldname: 'aluminium_rate_per_kg',
				label: 'Rate / Kg (KES)',
				reqd: 1,
				default: is_new ? 0 : flt(existing_item.aluminium_rate_per_kg || 0)
			},
			{
				fieldtype: 'Float',
				fieldname: 'aluminium_weight_per_length',
				label: 'Weight / Length',
				reqd: 1,
				default: is_new ? 0 : flt(existing_item.aluminium_weight_per_length || 0)
			},
			{ fieldtype: 'Section Break', label: 'Calculated Prices' },
			{ fieldtype: 'Currency', fieldname: 'retail_rate', label: 'Normal Price (KES)', read_only: 1, default: is_new ? 0 : (existing_item.retail_rate || aluminium_defaults.normal_price) },
			{ fieldtype: 'Currency', fieldname: 'retail_exclusive', label: 'Normal Exclusive', read_only: 1, default: is_new ? 0 : flt((existing_item.retail_rate || aluminium_defaults.normal_price) / 1.16) },
			{ fieldtype: 'Column Break' },
			{ fieldtype: 'Currency', fieldname: 'wholesale_rate', label: 'Mill Finished Price (KES)', read_only: 1, default: is_new ? 0 : (existing_item.wholesale_rate || aluminium_defaults.mill_finished_price) },
			{ fieldtype: 'Currency', fieldname: 'wholesale_exclusive', label: 'Mill Finished Exclusive', read_only: 1, default: is_new ? 0 : flt((existing_item.wholesale_rate || aluminium_defaults.mill_finished_price) / 1.16) },
			{ fieldtype: 'Column Break' },
			{ fieldtype: 'Currency', fieldname: 'special_rate', label: 'Special Price (KES)', read_only: 1, default: is_new ? 0 : (existing_item.special_rate || aluminium_defaults.special_price) },
			{ fieldtype: 'Currency', fieldname: 'special_exclusive', label: 'Special Exclusive', read_only: 1, default: is_new ? 0 : flt((existing_item.special_rate || aluminium_defaults.special_price) / 1.16) }
		]);
	} else {
		fields = fields.concat([
			{ fieldtype: 'Section Break', label: 'Pricing' },
			{ fieldtype: 'Currency', fieldname: 'retail_rate', label: 'Retail Rate (KES)', default: is_new ? 0 : existing_item.retail_rate },
			{ fieldtype: 'Currency', fieldname: 'retail_exclusive', label: 'Retail Exclusive', read_only: 1, default: is_new ? 0 : flt((existing_item.retail_rate || 0) / 1.16) },
			{ fieldtype: 'Column Break' },
			{ fieldtype: 'Currency', fieldname: 'wholesale_rate', label: 'Wholesale Rate (KES)', default: is_new ? 0 : existing_item.wholesale_rate },
			{ fieldtype: 'Currency', fieldname: 'wholesale_exclusive', label: 'Wholesale Exclusive', read_only: 1, default: is_new ? 0 : flt((existing_item.wholesale_rate || 0) / 1.16) },
			{ fieldtype: 'Column Break' },
			{ fieldtype: 'Currency', fieldname: 'special_rate', label: 'Special Rate (KES)', default: is_new ? 0 : existing_item.special_rate },
			{ fieldtype: 'Currency', fieldname: 'special_exclusive', label: 'Special Exclusive', read_only: 1, default: is_new ? 0 : flt((existing_item.special_rate || 0) / 1.16) }
		]);
	}

	let d = new frappe.ui.Dialog({
		title: is_new ? `Add New ${category} Item` : `Edit ${existing_item.item_code}`,
		fields: fields,
		primary_action_label: 'Save Item',
		primary_action: function(values) {
			let g_type = 'Ordinary';
			if (category === 'Laminated Glass') g_type = 'Laminated';
			else if (category === 'Ready Laminated Glass') g_type = 'Ready Laminated';
			else if (category === 'Toughened Glass') g_type = 'Toughened';

			let payload = {
				is_new: is_new,
				category: category,
				item_code: values.item_code || values.item_name,
				original_item_code: is_new ? (values.item_code || values.item_name) : existing_item.item_code,
				item_name: values.item_name,
				glass_type: g_type,
				retail_rate: values.retail_rate,
				wholesale_rate: values.wholesale_rate,
				special_rate: values.special_rate
			};

			if (is_aluminium) {
				payload.aluminium_rate_per_kg = values.aluminium_rate_per_kg;
				payload.aluminium_weight_per_length = values.aluminium_weight_per_length;
			}

			frappe.call({
				method: 'crystal_alluminium_works.api.save_custom_item',
				args: { data: JSON.stringify(payload) },
				freeze: true,
				freeze_message: 'Saving Item...',
				callback: function(r) {
					if (!r.exc) {
						frappe.show_alert({message: `Item Saved successfully`, indicator: 'green'});
						d.hide();
						load_category_tab(page, category);
					}
				}
			});
		}
	});

	d.show();

	if (is_aluminium) {
		let has_existing_inputs = is_new || flt(existing_item.aluminium_rate_per_kg || 0) || flt(existing_item.aluminium_weight_per_length || 0);
		const set_aluminium_price_fields = (prices) => {
			d.set_value('retail_rate', flt(prices.normal_price || 0));
			d.set_value('retail_exclusive', flt((prices.normal_price || 0) / 1.16));
			d.set_value('wholesale_rate', flt(prices.mill_finished_price || 0));
			d.set_value('wholesale_exclusive', flt((prices.mill_finished_price || 0) / 1.16));
			d.set_value('special_rate', flt(prices.special_price || 0));
			d.set_value('special_exclusive', flt((prices.special_price || 0) / 1.16));
		};
		const recalc_aluminium_prices = () => {
			let prices = get_aluminium_prices(
				d.get_value('aluminium_rate_per_kg') || 0,
				d.get_value('aluminium_weight_per_length') || 0
			);
			set_aluminium_price_fields(prices);
		};

		['aluminium_rate_per_kg', 'aluminium_weight_per_length'].forEach(fieldname => {
			if (d.fields_dict[fieldname] && d.fields_dict[fieldname].$input) {
				d.fields_dict[fieldname].$input.on('input', recalc_aluminium_prices);
			}
		});

		if (has_existing_inputs) {
			let existing_prices = {
				normal_price: existing_item.retail_rate || aluminium_defaults.normal_price,
				mill_finished_price: existing_item.wholesale_rate || aluminium_defaults.mill_finished_price,
				special_price: existing_item.special_rate || aluminium_defaults.special_price
			};
			set_aluminium_price_fields(existing_prices);
			setTimeout(recalc_aluminium_prices, 0);
		}
		return;
	}

	// Bind dynamic exclusive rate calculation
	const bind_exclusive_calc = (base_field, exclusive_field) => {
		if (d.fields_dict[base_field] && d.fields_dict[exclusive_field]) {
			d.fields_dict[base_field].$input.on('input', () => {
				let val = flt(d.get_value(base_field) || 0);
				d.set_value(exclusive_field, flt(val / 1.16));
			});
		}
	};

	bind_exclusive_calc('retail_rate', 'retail_exclusive');
	bind_exclusive_calc('wholesale_rate', 'wholesale_exclusive');
	bind_exclusive_calc('special_rate', 'special_exclusive');
}

function open_intervals_modal(page) {
	let active_category = $(page.body).find('.mi-tab.active').data('category');
	let default_interval_set = get_interval_set_for_category(active_category);
	let d = new frappe.ui.Dialog({
		title: 'Glass Dimension Intervals',
		fields: [
			{
				fieldtype: 'Select',
				fieldname: 'interval_set',
				label: 'Interval Set',
				options: `${MI_STANDARD_INTERVAL_SET}\n${MI_TOUGHENED_INTERVAL_SET}`,
				default: default_interval_set,
				reqd: 1
			},
			{ fieldtype: 'HTML', fieldname: 'grid' }
		],
		primary_action_label: 'Save Intervals',
		primary_action: function() {
			let data = [];
			d.$wrapper.find('.mi-interval-row').each(function() {
				let min = $(this).find('.min_mm').val();
				let max = $(this).find('.max_mm').val();
				let ft = $(this).find('.equivalent_ft').val();
				let inches_min = $(this).find('.equivalent_inches_min').val();
				let inches_max = $(this).find('.equivalent_inches_max').val();
				if (min && max && ft && inches_min && inches_max) {
					data.push({
						min_mm: min,
						max_mm: max,
						equivalent_ft: ft,
						equivalent_inches_min: inches_min,
						equivalent_inches_max: inches_max
					});
				}
			});

			frappe.call({
				method: 'crystal_alluminium_works.api.save_dimension_intervals',
				args: {
					intervals: JSON.stringify(data),
					interval_set: d.get_value('interval_set')
				},
				freeze: true,
				callback: function(r) {
					if (!r.exc) {
						frappe.show_alert({message: 'Intervals saved!', indicator: 'green'});
						d.hide();
					}
				}
			});
		}
	});

	function render_intervals_grid(intervals) {
		let rows = intervals && intervals.length
			? intervals
			: [{
				min_mm: 150,
				max_mm: 305,
				equivalent_ft: 1.0,
				equivalent_inches_min: 5.91,
				equivalent_inches_max: 12.0
			}];

		let html = `
			<table class="table table-bordered mi-intervals-table">
				<thead>
					<tr>
						<th>Min (mm)</th>
						<th>Max (mm)</th>
						<th>Equivalent (ft)</th>
						<th>Min (in)</th>
						<th>Max (in)</th>
						<th style="width: 40px;"></th>
					</tr>
				</thead>
				<tbody>
		`;

		rows.forEach(i => {
			let minInches = i.equivalent_inches_min || i.equivalent_inches || '';
			let maxInches = i.equivalent_inches_max || i.equivalent_inches || ((i.equivalent_ft || 0) * 12);
			html += `
				<tr class="mi-interval-row">
					<td><input type="number" class="form-control min_mm" value="${i.min_mm || ''}"></td>
					<td><input type="number" class="form-control max_mm" value="${i.max_mm || ''}"></td>
					<td><input type="number" step="0.5" class="form-control equivalent_ft" value="${i.equivalent_ft || ''}"></td>
					<td><input type="number" step="0.01" class="form-control equivalent_inches_min" value="${minInches}"></td>
					<td><input type="number" step="0.01" class="form-control equivalent_inches_max" value="${maxInches}"></td>
					<td style="text-align:center;"><button class="btn btn-xs btn-danger mi-del-row">✕</button></td>
				</tr>
			`;
		});

		html += `
				</tbody>
			</table>
			<button class="btn btn-default btn-xs mi-add-row">+ Add Row</button>
		`;

		d.get_field('grid').$wrapper.html(html);
	}

	function load_interval_set(interval_set) {
		d.get_field('grid').$wrapper.html('<div style="padding:16px;color:var(--text-muted);">Loading intervals...</div>');
		frappe.call({
			method: 'crystal_alluminium_works.api.get_dimension_intervals',
			args: { interval_set: interval_set },
			callback: function(r) {
				render_intervals_grid(r.message || []);
			}
		});
	}

	d.show();
	load_interval_set(default_interval_set);

	d.fields_dict.interval_set.$input.on('change', function() {
		load_interval_set(d.get_value('interval_set'));
	});

	d.$wrapper.on('click', '.mi-add-row', function() {
		d.$wrapper.find('tbody').append(`
			<tr class="mi-interval-row">
				<td><input type="number" class="form-control min_mm"></td>
				<td><input type="number" class="form-control max_mm"></td>
				<td><input type="number" step="0.5" class="form-control equivalent_ft"></td>
				<td><input type="number" step="0.01" class="form-control equivalent_inches_min"></td>
				<td><input type="number" step="0.01" class="form-control equivalent_inches_max"></td>
				<td style="text-align:center;"><button class="btn btn-xs btn-danger mi-del-row">✕</button></td>
			</tr>
		`);
	});

	d.$wrapper.on('click', '.mi-del-row', function() {
		$(this).closest('tr').remove();
	});
}

function open_sheets_modal(page) {
	let active_category = $(page.body).find('.mi-tab.active').data('category');
	let default_glass_type = get_sheet_glass_type_for_category(active_category);

	function parse_sheet_size(size) {
		let parts = String(size || '')
			.split(/x/i)
			.map(part => (part || '').trim())
			.filter(Boolean);
		return {
			width: parts[0] || '',
			height: parts[1] || ''
		};
	}

	let d = new frappe.ui.Dialog({
		title: 'Glass Sheet Sizes',
		fields: [
			{
				fieldtype: 'Select',
				fieldname: 'glass_type',
				label: 'Glass Type',
				options: 'Ordinary\nReady Laminated',
				default: default_glass_type,
				reqd: 1
			},
			{ fieldtype: 'HTML', fieldname: 'grid' }
		],
		primary_action_label: 'Save Sheets',
		primary_action: function() {
			let rows = [];
			d.$wrapper.find('.mi-sheet-row').each(function() {
				let width = ($(this).find('.sheet_width').val() || '').trim();
				let height = ($(this).find('.sheet_height').val() || '').trim();
				let sft = $(this).find('.sheet_sft').val();
				if (width && height && sft) {
					rows.push({
						size: `${width} x ${height}`,
						sft: sft
					});
				}
			});

			frappe.call({
				method: 'crystal_alluminium_works.api.save_glass_sheet_configs',
				args: {
					rows: JSON.stringify(rows),
					glass_type: d.get_value('glass_type')
				},
				freeze: true,
				callback: function(r) {
					if (!r.exc) {
						frappe.show_alert({ message: 'Sheet sizes saved!', indicator: 'green' });
						d.hide();
					}
				}
			});
		}
	});

	function render_sheets_grid(rows) {
		let data = rows && rows.length ? rows : [{ size: '', sft: '' }];
		let html = `
			<div style="color:var(--text-muted);margin-bottom:12px;">
				Add the sheet size and its matching square foot value. Example size: <b>1220 x 1830</b>
			</div>
			<table class="table table-bordered mi-sheets-table">
				<thead>
					<tr>
						<th>Size</th>
						<th>SFT</th>
						<th style="width: 40px;"></th>
					</tr>
				</thead>
				<tbody>
		`;

		data.forEach(row => {
			let dimensions = parse_sheet_size(row.size);
			html += `
				<tr class="mi-sheet-row">
					<td>
						<div style="display:flex;align-items:center;gap:8px;">
							<input type="number" class="form-control sheet_width" placeholder="1220" value="${frappe.utils.escape_html(dimensions.width)}">
							<span style="font-weight:600;color:var(--text-muted);">x</span>
							<input type="number" class="form-control sheet_height" placeholder="1830" value="${frappe.utils.escape_html(dimensions.height)}">
						</div>
					</td>
					<td><input type="number" step="0.01" class="form-control sheet_sft" value="${row.sft || ''}"></td>
					<td style="text-align:center;"><button class="btn btn-xs btn-danger mi-del-sheet-row">✕</button></td>
				</tr>
			`;
		});

		html += `
				</tbody>
			</table>
			<button class="btn btn-default btn-xs mi-add-sheet-row">+ Add Row</button>
		`;

		d.get_field('grid').$wrapper.html(html);
	}

	function load_sheet_rows(glass_type) {
		d.get_field('grid').$wrapper.html('<div style="padding:16px;color:var(--text-muted);">Loading sheet sizes...</div>');
		frappe.call({
			method: 'crystal_alluminium_works.api.get_glass_sheet_configs',
			args: { glass_type: glass_type },
			callback: function(r) {
				render_sheets_grid(r.message || []);
			}
		});
	}

	d.show();
	load_sheet_rows(default_glass_type);

	d.fields_dict.glass_type.$input.on('change', function() {
		load_sheet_rows(d.get_value('glass_type'));
	});

	d.$wrapper.on('click', '.mi-add-sheet-row', function() {
		d.$wrapper.find('tbody').append(`
			<tr class="mi-sheet-row">
				<td>
					<div style="display:flex;align-items:center;gap:8px;">
						<input type="number" class="form-control sheet_width" placeholder="1220">
						<span style="font-weight:600;color:var(--text-muted);">x</span>
						<input type="number" class="form-control sheet_height" placeholder="1830">
					</div>
				</td>
				<td><input type="number" step="0.01" class="form-control sheet_sft"></td>
				<td style="text-align:center;"><button class="btn btn-xs btn-danger mi-del-sheet-row">✕</button></td>
			</tr>
		`);
	});

	d.$wrapper.on('click', '.mi-del-sheet-row', function() {
		$(this).closest('tr').remove();
	});
}

function open_service_rates_modal(page) {
	let d = new frappe.ui.Dialog({
		title: 'Global Glass Service Rates',
		fields: [
			{ fieldtype: 'Currency', fieldname: 'polishing_rate', label: 'Polishing Rate (per rft)', reqd: 1 },
			{ fieldtype: 'Currency', fieldname: 'polishing_exclusive', label: 'Polishing Exclusive', read_only: 1, default: 0 },
			{ fieldtype: 'Column Break' },
			{ fieldtype: 'Currency', fieldname: 'hole_rate', label: 'Hole Rate (per hole)', reqd: 1 },
			{ fieldtype: 'Currency', fieldname: 'hole_exclusive', label: 'Hole Exclusive', read_only: 1, default: 0 },
			{ fieldtype: 'Section Break' },
			{ fieldtype: 'Currency', fieldname: 'notch_rate', label: 'Notch Rate (per notch)', reqd: 1 },
			{ fieldtype: 'Currency', fieldname: 'notch_exclusive', label: 'Notch Exclusive', read_only: 1, default: 0 },
			{ fieldtype: 'Column Break' },
			{ fieldtype: 'Currency', fieldname: 'sandblast_rate', label: 'Sandblast Rate (per sqft)', reqd: 1 },
			{ fieldtype: 'Currency', fieldname: 'sandblast_exclusive', label: 'Sandblast Exclusive', read_only: 1, default: 0 }
		],
		primary_action_label: 'Save Rates',
		primary_action: function(values) {
			frappe.call({
				method: 'frappe.client.set_value',
				args: {
					doctype: 'Glass Pricing Settings',
					name: 'Glass Pricing Settings',
					fieldname: {
						polishing_rate: values.polishing_rate,
						hole_rate: values.hole_rate,
						notch_rate: values.notch_rate,
						sandblast_rate: values.sandblast_rate
					}
				},
				freeze: true,
				callback: function(r) {
					if (!r.exc) {
						frappe.show_alert({message: 'Service Rates saved!', indicator: 'green'});
						d.hide();
					}
				}
			});
		}
	});

	d.show();
	d.set_message("Loading rates...");

	// Bind dynamic exclusive rate calculation
	const bind_service_exclusive = (base_field, exclusive_field) => {
		if (d.fields_dict[base_field] && d.fields_dict[exclusive_field]) {
			d.fields_dict[base_field].$input.on('input', () => {
				let val = flt(d.get_value(base_field) || 0);
				d.set_value(exclusive_field, flt(val / 1.16));
			});
		}
	};
	bind_service_exclusive('polishing_rate', 'polishing_exclusive');
	bind_service_exclusive('hole_rate', 'hole_exclusive');
	bind_service_exclusive('notch_rate', 'notch_exclusive');
	bind_service_exclusive('sandblast_rate', 'sandblast_exclusive');

	frappe.call({
		method: 'frappe.client.get',
		args: { doctype: 'Glass Pricing Settings', name: 'Glass Pricing Settings' },
		callback: function(r) {
			if (d.clear_message) {
				d.clear_message();
			} else {
				d.hide_message(); // Fallback
			}
			
			if (r.message) {
				d.set_values({
					polishing_rate: r.message.polishing_rate || 0,
					polishing_exclusive: flt((r.message.polishing_rate || 0) / 1.16),
					hole_rate: r.message.hole_rate || 0,
					hole_exclusive: flt((r.message.hole_rate || 0) / 1.16),
					notch_rate: r.message.notch_rate || 0,
					notch_exclusive: flt((r.message.notch_rate || 0) / 1.16),
					sandblast_rate: r.message.sandblast_rate || 0,
					sandblast_exclusive: flt((r.message.sandblast_rate || 0) / 1.16)
				});
			}
		},
		error: function(r) {
			if (d.clear_message) d.clear_message();
			console.log(r);
			// Fallback to 0 if the doctype hasn't been saved yet
			d.set_values({
				polishing_rate: 0,
				polishing_exclusive: 0,
				hole_rate: 0,
				hole_exclusive: 0,
				notch_rate: 0,
				notch_exclusive: 0,
				sandblast_rate: 0,
				sandblast_exclusive: 0
			});
		}
	});
}

function open_aluminium_colors_modal(page) {
	let d = new frappe.ui.Dialog({
		title: 'Aluminium Colors',
		fields: [
			{ fieldtype: 'HTML', fieldname: 'grid' }
		],
		primary_action_label: 'Save Colors',
		primary_action: function() {
			let colors = [];
			let seen = new Set();
			let has_duplicate = false;

			d.$wrapper.find('.mi-color-row').each(function() {
				let color_name = ($(this).find('.mi-color-name').val() || '').trim();
				if (!color_name) {
					return;
				}

				let normalized = color_name.toLowerCase();
				if (seen.has(normalized)) {
					has_duplicate = true;
					return;
				}
				seen.add(normalized);
				colors.push(color_name);
			});

			if (has_duplicate) {
				frappe.msgprint('Each aluminium color should only appear once.');
				return;
			}

			frappe.call({
				method: 'crystal_alluminium_works.api.save_aluminium_colors',
				args: { colors: JSON.stringify(colors) },
				freeze: true,
				freeze_message: 'Saving colors...',
				callback: function(r) {
					if (!r.exc) {
						frappe.show_alert({message: 'Aluminium colors saved!', indicator: 'green'});
						d.hide();
					}
				}
			});
		}
	});

	function render_colors_grid(colors) {
		let rows = colors && colors.length ? colors : [''];
		let html = `
			<div style="margin-bottom:12px;color:var(--text-muted);">
				Add the aluminium colors you want available in the system.
			</div>
			<table class="table table-bordered">
				<thead>
					<tr>
						<th>Color</th>
						<th style="width:40px;"></th>
					</tr>
				</thead>
				<tbody>
		`;

		rows.forEach(color => {
			html += `
				<tr class="mi-color-row">
					<td><input type="text" class="form-control mi-color-name" value="${frappe.utils.escape_html(color || '')}" placeholder="e.g. Bronze"></td>
					<td style="text-align:center;"><button class="btn btn-xs btn-danger mi-del-color-row">✕</button></td>
				</tr>
			`;
		});

		html += `
				</tbody>
			</table>
			<button class="btn btn-default btn-xs mi-add-color-row">+ Add Color</button>
		`;

		d.get_field('grid').$wrapper.html(html);
	}

	d.show();
	d.get_field('grid').$wrapper.html('<div style="padding:16px;color:var(--text-muted);">Loading colours...</div>');

	frappe.call({
		method: 'crystal_alluminium_works.api.get_aluminium_colors',
		callback: function(r) {
			render_colors_grid(r.message || []);
		}
	});

	d.$wrapper.on('click', '.mi-add-color-row', function() {
		d.$wrapper.find('tbody').append(`
			<tr class="mi-color-row">
				<td><input type="text" class="form-control mi-color-name" placeholder="e.g. Champagne"></td>
				<td style="text-align:center;"><button class="btn btn-xs btn-danger mi-del-color-row">✕</button></td>
			</tr>
		`);
	});

	d.$wrapper.on('click', '.mi-del-color-row', function() {
		let $rows = d.$wrapper.find('.mi-color-row');
		if ($rows.length === 1) {
			$rows.find('.mi-color-name').val('');
			return;
		}
		$(this).closest('tr').remove();
	});
}

function get_manage_items_html() {
	return `
	<style>
		.mi-container {
			max-width: 100%;
			margin: 0 auto;
			padding: 20px 16px;
			font-family: var(--font-stack);
		}
		
		.mi-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-bottom: 24px;
		}

		.mi-tabs {
			display: flex;
			gap: 8px;
			border-bottom: 1px solid var(--border-color);
			margin-bottom: 24px;
		}

		.mi-tab {
			padding: 12px 24px;
			cursor: pointer;
			font-weight: 600;
			color: var(--text-muted);
			border-bottom: 2px solid transparent;
			transition: all 0.2s;
		}

		.mi-tab:hover {
			color: var(--text-color);
			background: var(--subtle-fg);
			border-radius: 8px 8px 0 0;
		}

		.mi-tab.active {
			color: var(--primary);
			border-bottom-color: var(--primary);
		}

		.mi-table-card {
			background: var(--card-bg);
			border: 1px solid var(--border-color);
			border-radius: 12px;
			overflow: hidden;
		}

		.mi-table {
			width: 100%;
			border-collapse: collapse;
		}

		.mi-table thead th {
			padding: 12px 16px;
			font-size: 12px;
			font-weight: 600;
			color: var(--text-muted);
			text-transform: uppercase;
			letter-spacing: 0.5px;
			border-bottom: 1px solid var(--border-color);
			background: var(--subtle-fg);
		}

		.mi-table tbody tr:not(:last-child) td {
			border-bottom: 1px solid var(--border-color);
		}

		.mi-table tbody tr:hover {
			background: var(--subtle-fg);
		}
	</style>

	<div class="mi-container">
		<div class="mi-header">
			<h2 style="margin:0;font-weight:600;">Product Catalog</h2>
			<div style="display:flex; gap:8px;">
				<button class="btn btn-default mi-color-btn" style="display:none;">⚙️ Configure Color</button>
				<button class="btn btn-default mi-export-aluminium-btn" style="display:none;">Export Aluminium</button>
				<button class="btn btn-default mi-config-btn" style="display:none;">⚙️ Configure Intervals</button>
				<button class="btn btn-default mi-sheets-btn" style="display:none;">⚙️ Configure Sheets</button>
				<button class="btn btn-default mi-service-btn" style="display:none;">⚙️ Configure Service Rates</button>
				<button class="btn btn-danger mi-mass-delete-btn" style="display:none;">Delete Selected</button>
				<button class="btn btn-primary mi-add-btn">+ Add New Item</button>
			</div>
		</div>

			<div class="mi-search-wrap" style="display:block; margin-bottom:16px;">
				<input
					type="text"
					class="form-control mi-search-input"
					placeholder="Search item name, item code, or product code..."
					style="max-width:360px;"
				>
			</div>

		<div class="mi-tabs">
			${MI_TABS.map((tab, index) => `
				<div class="mi-tab ${index === 0 ? 'active' : ''}" data-category="${tab.category}">${tab.label}</div>
			`).join('')}
		</div>

		<div class="mi-table-card">
			<table class="mi-table">
					<thead>
						<tr>
							<th style="width: 40px; text-align:center;"><input type="checkbox" class="mi-select-all"></th>
							<th>Item</th>
							<th>Product Code</th>
							<th class="mi-code-head">Item Code</th>
							<th style="text-align:center;">UOM</th>
							<th class="mi-primary-price-head" style="text-align:right;">Retail Price</th>
							<th class="mi-price-lists-head" style="text-align:right;">Price Lists</th>
						<th style="text-align:center;">Actions</th>
					</tr>
				</thead>
				<tbody class="mi-table-body">
					<!-- Loaded via JS -->
				</tbody>
			</table>
		</div>
	</div>
	`;
}
