frappe.pages['quotation-builder'].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Quotation Builder',
		single_column: true
	});
	wrapper.page = page;

	// State
	if (!window.qb_state) {
		window.qb_state = {
			customer: '',
			customer_phone: '',
			customer_pin: '',
			payment_mode: 'invoice',
			items: [],
			step: 1,
			price_adjustment: null
		};
	} else if (!window.qb_state.payment_mode) {
		window.qb_state.payment_mode = QB_DEFAULT_CUSTOMER_PAYMENT_MODE;
	}

	page.set_primary_action('Generate Quotation', function () {
		generate_quotation(page);
	});

	page.set_secondary_action('Back to Dashboard', function () {
		frappe.set_route('crystal-aluminium-wo');
	});

	$(page.body).html(get_builder_html());
	bind_events(page);
	render_step(page, window.qb_state.step || 1);
};

const QB_GLASS_DIMENSION_UOM_OPTIONS = 'inches\nmm';
const QB_DEFAULT_GLASS_DIMENSION_UOM = 'mm';
const QB_ALUMINIUM_PRICE_FACTOR = 1.07;
const QB_ALUMINIUM_PRICE_OPTIONS = 'Normal Price\nMill Finished Price\nSpecial Price';
const QB_ALUMINIUM_PRICE_LABEL_TO_PRICE_LIST = {
	'Normal Price': 'Retail',
	'Mill Finished Price': 'Wholesale',
	'Special Price': 'Special',
	'Retail': 'Retail',
	'Wholesale': 'Wholesale',
	'Special': 'Special'
};
const QB_ALUMINIUM_PRICE_LIST_TO_LABEL = {
	'Retail': 'Normal Price',
	'Wholesale': 'Mill Finished Price',
	'Special': 'Special Price'
};
const QB_SHEET_GLASS_TYPES = new Set(['Ordinary', 'Ready Laminated']);
const QB_SHARED_GLASS_SHEET_CONFIG_KEY = 'Shared';
const QB_CUSTOMER_PAYMENT_MODE_OPTIONS = 'Cash Customer\nInvoice Customer';
const QB_DEFAULT_CUSTOMER_PAYMENT_MODE = 'invoice';
// Every cash sale is billed against this one shared walk-in Customer record —
// fetched (and created server-side on first use) once per page load, then cached.
let qb_shared_cash_customer_promise = null;
function get_shared_cash_customer() {
	if (!qb_shared_cash_customer_promise) {
		qb_shared_cash_customer_promise = frappe.call({
			method: 'crystal_alluminium_works.api.get_shared_cash_customer'
		}).then(r => r.message || {});
	}
	return qb_shared_cash_customer_promise;
}
const QB_VAT_RATE = 0.16;
const QB_POLISH_TYPE_OPTIONS = '4-6\n8-10\n14-35';
const QB_DEFAULT_POLISH_TYPE = '4-6';
const QB_HOLE_TYPE_OPTIONS = '5mm\n6mm\n8mm\n10mm\n15mm\n20mm';
const QB_DEFAULT_HOLE_TYPE = '5mm';
const QB_NOTCH_TYPE_OPTIONS = 'Standard\nSmall\nMirror Screws\nTimber Box';
const QB_DEFAULT_NOTCH_TYPE = 'Standard';
const QB_CEILING_COMPONENTS = [
	{ label: 'Board', ratio: 0.36, mode: 'divide' },
	{ label: 'MainT', ratio: 0.25, mode: 'multiply' },
	{ label: 'Sub Cross 4ft', ratio: 1.33, mode: 'multiply' },
	{ label: 'Sub Cross 2ft', ratio: 1.33, mode: 'multiply' },
	{ label: 'Wall angle', ratio: 0.25, mode: 'multiply' }
];
const QB_CEILING_COMPONENT_ITEM_CODES = QB_CEILING_COMPONENTS.map(component => component.label);
const QB_CEILING_BOARD_ITEM_CODES = new Set(['AMC', 'AGC']);

function refresh_quotation_builder(page) {
	if (!page) {
		return;
	}

	$(page.body).html(get_builder_html());
	bind_events(page);
	setup_customer_step(page);

	if (window.qb_state && window.qb_state.items && window.qb_state.items.length > 0) {
		render_items_table(page);
	}

	if (window.qb_state && window.qb_state.editing_quotation) {
		page.set_title(`Editing: ${window.qb_state.editing_quotation}`);
	} else {
		page.set_title('Quotation Builder');
	}

	render_step(page, (window.qb_state && window.qb_state.step) || 1);
	update_review_button_visibility(page);
}

function is_ceiling_board_item(item) {
	return QB_CEILING_BOARD_ITEM_CODES.has((item.item_code || '').trim());
}

function get_ceiling_single_review_label(item) {
	let item_code = (item.item_code || '').trim();
	if (is_ceiling_board_item(item)) {
		return 'Board';
	}
	return (item.item_name || item.item_code || '').trim();
}

function normalize_glass_dimension_uom(uom) {
	return (uom || '').toLowerCase() === 'inches' ? 'inches' : 'mm';
}

function get_glass_dimension_label(uom) {
	return normalize_glass_dimension_uom(uom) === 'inches' ? 'inches' : 'mm';
}

function dimension_input_to_mm(value, uom) {
	let number = flt(value || 0);
	return normalize_glass_dimension_uom(uom) === 'inches' ? number * 25.4 : number;
}

function mm_to_dimension_input(value, uom) {
	let number = flt(value || 0);
	return normalize_glass_dimension_uom(uom) === 'inches' ? number / 25.4 : number;
}

function get_aluminium_price_label(price_list) {
	return QB_ALUMINIUM_PRICE_LIST_TO_LABEL[price_list] || price_list || 'Normal Price';
}

function get_aluminium_backend_price_list(price_list) {
	return QB_ALUMINIUM_PRICE_LABEL_TO_PRICE_LIST[price_list] || price_list || 'Retail';
}

function get_aluminium_normal_price(rate_per_kg, weight_per_length) {
	return flt(rate_per_kg || 0) * flt(weight_per_length || 0);
}

function get_aluminium_rate_for_selling_price(normal_price, selling_price) {
	let price_label = get_aluminium_price_label(selling_price);
	if (price_label === 'Mill Finished Price') {
		return QB_ALUMINIUM_PRICE_FACTOR ? normal_price / QB_ALUMINIUM_PRICE_FACTOR : normal_price;
	}
	if (price_label === 'Special Price') {
		return normal_price * QB_ALUMINIUM_PRICE_FACTOR;
	}
	return normal_price;
}

function get_item_selling_price_label(item) {
	return item.category === 'Aluminium' ? get_aluminium_price_label(item.price_list) : (item.price_list || 'Retail');
}

function get_ceiling_mode_price_list(ceiling_mode) {
	return ceiling_mode === 'bundle' ? 'Wholesale' : 'Retail';
}

function is_sheet_glass_type(glass_type) {
	return QB_SHEET_GLASS_TYPES.has(glass_type || '');
}

function normalize_glass_mode(mode, glass_type) {
	return is_sheet_glass_type(glass_type) && mode === 'Sheet' ? 'Sheet' : 'Cut Size';
}

function get_glass_add_choice_fields(default_uom, glass_type) {
	let fields = [
		{
			fieldtype: 'Select',
			fieldname: 'entry_method',
			label: 'Entry Method',
			options: 'Manual\nUpload',
			default: 'Manual',
			reqd: 1
		},
		{
			fieldtype: 'Select',
			fieldname: 'dimension_uom',
			label: 'UOM',
			options: QB_GLASS_DIMENSION_UOM_OPTIONS,
			default: normalize_glass_dimension_uom(default_uom || QB_DEFAULT_GLASS_DIMENSION_UOM),
			reqd: 1
		}
	];

	if (is_sheet_glass_type(glass_type)) {
		fields.push({
			fieldtype: 'Select',
			fieldname: 'glass_mode',
			label: 'Glass Mode',
			options: 'Cut Size\nSheet',
			default: 'Cut Size',
			reqd: 1,
			depends_on: 'eval:doc.entry_method=="Manual"'
		});
	}

	return fields;
}

function get_aluminium_color_options() {
	let options = ['None'];
	(window.qb_state.aluminium_colors || []).forEach(color => {
		if (color && color.trim().toLowerCase() !== 'none') {
			options.push(color);
		}
	});
	return options.join('\n');
}

function normalize_customer_payment_mode(value) {
	return String(value || '').trim().toLowerCase() === 'cash customer' || String(value || '').trim().toLowerCase() === 'cash'
		? 'cash'
		: 'invoice';
}

function get_customer_payment_mode_label(value) {
	return normalize_customer_payment_mode(value) === 'cash' ? 'Cash Customer' : 'Invoice Customer';
}

function normalize_aluminium_color_selection(value) {
	return value === 'None' ? '' : (value || '');
}

function ensure_aluminium_colors(callback) {
	if (window.qb_state.aluminium_colors && window.qb_state.aluminium_colors.length) {
		if (callback) callback(window.qb_state.aluminium_colors);
		return;
	}

	frappe.call({
		method: 'crystal_alluminium_works.api.get_aluminium_colors',
		callback: function (r) {
			window.qb_state.aluminium_colors = r.message || [];
			if (callback) callback(window.qb_state.aluminium_colors);
		}
	});
}

function bind_events(page) {
	// These are delegated handlers bound on page.body itself, so replacing the
	// body's inner HTML (e.g. via refresh_quotation_builder on every page show)
	// does NOT detach them. bind_events runs multiple times, so without clearing
	// the namespace first the handlers stack — one "+ Aluminium" click would then
	// fire add_item_row several times, opening duplicate empty dialogs that look
	// like the modal "resetting" instead of closing after Save.
	$(page.body).off('.qbbuilder');

	$(page.body).on('click.qbbuilder', '.qb-step-indicator', function () {
		let step = parseInt($(this).data('step'));
		if (step === 3 && !(window.qb_state && window.qb_state.items && window.qb_state.items.length)) {
			return;
		}
		if (step) render_step(page, step);
	});

	$(page.body).on('click.qbbuilder', '.qb-add-btn', function () {
		let category = $(this).data('category');
		let glassType = $(this).data('glass-type');
		if (!category) return;
		if (category === 'Glass') {
			let label = $(this).text().replace('+', '').trim();
			let d = new frappe.ui.Dialog({
				title: `Add ${label} Items`,
				fields: get_glass_add_choice_fields(QB_DEFAULT_GLASS_DIMENSION_UOM, glassType),
				primary_action_label: 'Continue',
				primary_action: function (values) {
					d.hide();
					let dimension_uom = normalize_glass_dimension_uom(values.dimension_uom);
					if (values.entry_method === 'Upload') {
						open_glass_import_dialog(page, dimension_uom);
					} else {
						add_item_row(page, 'Glass', glassType, dimension_uom, values.glass_mode || 'Cut Size');
					}
				}
			});
			d.show();
			return;
		}
		if (category === 'Ceiling') {
			open_ceiling_add_choice(page);
			return;
		}
		add_item_row(page, category);
	});

	$(page.body).on('click.qbbuilder', '.qb-import-products-btn', function () {
		open_glass_import_dialog(page, QB_DEFAULT_GLASS_DIMENSION_UOM);
	});

	setup_price_adjustment_controls(page);

	$(page.body).on('click.qbbuilder', '.qb-nav-step', function () {
		let step = parseInt($(this).data('step'));
		if (step === 3 && !(window.qb_state && window.qb_state.items && window.qb_state.items.length)) {
			return;
		}
		if (step) render_step(page, step);
	});
}

function get_item_display_qty(item) {
	if (item.category === 'Glass' && item.sale_mode === 'Sheet') {
		return flt(item.pcs || 0);
	}

	if (item.category === 'Ceiling') {
		return item.ceiling_mode === 'bundle' ? 1 : flt(item.qty || 0);
	}

	return item.qty;
}

function get_item_uom_label(item) {
	if (item.category === 'Glass' && item.sale_mode === 'Full Sheet') {
		return 'Nos';
	}

	if (item.category === 'Ceiling') {
		if (item.ceiling_mode === 'bundle' || is_ceiling_board_item(item)) {
			return item.uom || 'Square Meter';
		}
		return item.uom || 'Nos';
	}

	if (item.uom) {
		return item.uom;
	}

	if (item.category === 'Glass') {
		return 'Square Foot';
	}

	if (item.category === 'Aluminium') {
		return 'Nos';
	}

	return '';
}

function get_item_uom_qty(item) {
	if (item.category === 'Aluminium') {
		return flt(item.qty || 0);
	}

	if (item.category === 'Ceiling') {
		return item.ceiling_mode === 'bundle'
			? flt(item.quantity || item.square_metres || 0)
			: flt(item.qty || 0);
	}

	if (item.category === 'Glass') {
		if (item.sale_mode === 'Sheet') {
			return flt(item.qty || 0);
		}

		if (item.sale_mode === 'Full Sheet') {
			return flt(item.qty || 0);
		}

		return get_glass_area_sqft(item) * flt(item.qty || 0);
	}

	return flt(item.qty || 0);
}

function calculate_item_amount(item) {
	let qty = flt(item.qty || 0);
	let rate = flt(item.rate || 0) / 1.16;

	if (item.category === 'Aluminium') {
		return qty * rate;
	}

	if (item.category === 'Ceiling') {
		if (item.ceiling_mode === 'bundle') {
			return flt(item.quantity || item.square_metres || 0) * rate;
		}
		return qty * rate;
	}

	if (item.category === 'Glass') {
		if (item.sale_mode === 'Sheet') {
			return qty * rate;
		}

		if (item.sale_mode === 'Full Sheet') {
			return qty * rate;
		}

		return qty * get_glass_area_sqft(item) * rate;
	}

	return qty * rate;
}

// ────────────────────────────────────────────
// Global price adjustment (+/- % over Inc.Rate, applied per row)
// ────────────────────────────────────────────
function price_adjustment_key(adjustment) {
	return adjustment && adjustment.percent ? `${adjustment.type}${adjustment.percent}` : null;
}

function apply_price_adjustment_to_item(item, adjustment) {
	if (item._base_rate === undefined || item._base_rate === null) {
		item._base_rate = flt(item.rate || 0);
	}

	if (adjustment && adjustment.percent) {
		let multiplier = adjustment.type === '-'
			? (1 - adjustment.percent / 100)
			: (1 + adjustment.percent / 100);
		item.rate = item._base_rate * multiplier;
	} else {
		item.rate = item._base_rate;
	}

	item.amount = calculate_item_amount(item);
	item._price_adj_key = price_adjustment_key(adjustment);
}

function sync_price_adjustment() {
	let adjustment = window.qb_state.price_adjustment;
	let key = price_adjustment_key(adjustment);

	window.qb_state.items.forEach(function (item) {
		if (item._price_adj_key !== key) {
			apply_price_adjustment_to_item(item, adjustment);
		}
	});
}

function get_builder_subtotal() {
	return window.qb_state.items.reduce((sum, item) => sum + flt(item.amount || 0), 0);
}

function get_builder_vat_total() {
	return get_builder_subtotal() * QB_VAT_RATE;
}

function get_builder_grand_total() {
	return get_builder_subtotal() + get_builder_vat_total();
}

function close_builder_dialog(dialog) {
	if (!dialog) {
		return;
	}

	// dialog.hide() already calls $wrapper.modal('hide') internally. Calling
	// modal('hide') a second time here fired a redundant hide while the first
	// was still transitioning, which left the .modal-backdrop stuck in the DOM
	// so the dialog appeared not to close. Defer to hide() alone.
	dialog.hide();
}

function get_review_breakdown_uom(label, item) {
	let normalized = (label || '').toLowerCase();

	if (normalized.includes('glass') || normalized.includes('sandblasting')) {
		return item.sale_mode === 'Full Sheet' ? 'Nos' : 'Square Foot';
	}

	if (normalized.includes('polishing')) {
		return 'Rft';
	}

	if (normalized.includes('hole') || normalized.includes('notch')) {
		return 'Nos';
	}

	return '';
}

function format_review_number(value, precision = 3) {
	let number = flt(value || 0);
	let rounded = parseFloat(number.toFixed(precision));
	return Number.isFinite(rounded) ? rounded : 0;
}

function get_ceiling_component_breakdown(quantity) {
	quantity = flt(quantity || 0);
	return QB_CEILING_COMPONENTS.map(component => {
		let ratio = flt(component.ratio || 0);
		let qty = component.mode === 'divide' && ratio ? quantity / ratio : quantity * ratio;
		return { label: component.label, qty: Math.trunc(qty) };
	});
}

function render_ceiling_component_breakdown(quantity) {
	let rows = get_ceiling_component_breakdown(quantity);
	return `
		<div style="margin-top:6px;color:var(--text-muted);font-size:12px;line-height:1.5;">
			${rows.map(row => `${frappe.utils.escape_html(row.label)}: ${format_review_number(row.qty, 2)} pcs`).join('<br>')}
		</div>
	`;
}

function get_ceiling_review_config(items) {
	let has_bundle = (items || []).some(item => item.ceiling_mode === 'bundle');
	if (has_bundle) {
		return {
			has_bundle: true,
			show_quantity: true,
			show_uom: true,
			columns: QB_CEILING_COMPONENTS.map(component => ({
				label: component.label,
				key: component.label,
				bundle_component: true
			}))
		};
	}

	let seen = new Set();
	let columns = [];
	(items || []).forEach(item => {
		let label = get_ceiling_single_review_label(item);
		if (!label || seen.has(label)) {
			return;
		}
		seen.add(label);
		columns.push({
			label: label,
			key: label,
			bundle_component: false
		});
	});

	return {
		has_bundle: false,
		show_quantity: false,
		show_uom: true,
		columns: columns
	};
}

function get_polish_sides_label(item) {
	let total = cint(item.polish_width_sides || 0) + cint(item.polish_height_sides || 0);
	return total ? `Polish ${total} side${total === 1 ? '' : 's'}` : '';
}

function get_glass_polishing_rft(item) {
	let width_sides = cint(item.polish_width_sides || 0);
	let height_sides = cint(item.polish_height_sides || 0);

	if (!width_sides && !height_sides && cint(item.polishing || 0)) {
		width_sides = 2;
		height_sides = 2;
	}

	let value = flt(item.qty || 0) * (
		(width_sides * (flt(item.width_mm || 0) / 305)) +
		(height_sides * (flt(item.height_mm || 0) / 305))
	);
	return Math.trunc(value * 1000) / 1000;
}

function get_glass_dimension_review_value(item, fieldname) {
	return mm_to_dimension_input(item[fieldname] || 0, item.dimension_uom);
}

function get_glass_form_perimeter_rft(width_ft, height_ft) {
	let value = 2 * (flt(width_ft || 0) + flt(height_ft || 0));
	return Math.trunc(value * 1000) / 1000;
}

function get_glass_form_area_sqft(width_ft, height_ft) {
	return flt(width_ft || 0) * flt(height_ft || 0);
}

function get_glass_base_width_ft(item) {
	let allowance = flt(item.width_allowance || 0);
	if (flt(item.base_width_ft || 0)) {
		return flt(item.base_width_ft || 0);
	}
	if (flt(item.width_ft || 0) && allowance) {
		return flt(item.width_ft || 0) - allowance;
	}
	return flt(item.width_ft || 0);
}

function get_glass_base_height_ft(item) {
	let allowance = flt(item.height_allowance || 0);
	if (flt(item.base_height_ft || 0)) {
		return flt(item.base_height_ft || 0);
	}
	if (flt(item.height_ft || 0) && allowance) {
		return flt(item.height_ft || 0) - allowance;
	}
	return flt(item.height_ft || 0);
}

function get_glass_adjusted_width_ft(item) {
	let width = flt(item.width_ft || 0);
	if (width) {
		return width;
	}
	return get_glass_base_width_ft(item) + flt(item.width_allowance || 0);
}

function get_glass_adjusted_height_ft(item) {
	let height = flt(item.height_ft || 0);
	if (height) {
		return height;
	}
	return get_glass_base_height_ft(item) + flt(item.height_allowance || 0);
}

function get_glass_area_sqft(item) {
	let adjustedWidthFt = get_glass_adjusted_width_ft(item);
	let adjustedHeightFt = get_glass_adjusted_height_ft(item);
	if (adjustedWidthFt && adjustedHeightFt) {
		return get_glass_form_area_sqft(adjustedWidthFt, adjustedHeightFt);
	}
	return flt(item.area_sqft || 0);
}

function get_glass_sandblast_qty(item) {
	if (item.sandblast_type === 'Full') {
		return 1;
	}

	if (item.sandblast_type === 'Half') {
		return 0.5;
	}

	return 0;
}

function get_glass_breakdown_entry(item, matcher) {
	let breakdown = item.glass_breakdown || [];
	return breakdown.find(entry => matcher(entry || {})) || null;
}

function get_glass_base_entry(item) {
	return get_glass_breakdown_entry(item, entry => {
		let label = (entry.label || '').trim().toLowerCase();
		return label === 'glass' || label.startsWith('glass ');
	});
}

function get_glass_polishing_entry(item) {
	return get_glass_breakdown_entry(item, entry => /polish/i.test(entry.label || ''));
}

function get_glass_holes_entry(item) {
	return get_glass_breakdown_entry(item, entry => /hole/i.test(entry.label || ''));
}

function get_glass_notches_entry(item) {
	return get_glass_breakdown_entry(item, entry => /notch/i.test(entry.label || ''));
}

function get_glass_sandblast_entry(item) {
	return get_glass_breakdown_entry(item, entry => /sandblast/i.test(entry.label || ''));
}

function format_review_price_tag(amount) {
	return `(Sh ${format_number(flt(amount || 0), null, 2)})`;
}

function get_glass_type_review_label(item) {
	let label = frappe.utils.escape_html(item.item_name || item.item_code || '');
	let base_entry = get_glass_base_entry(item);

	if (!base_entry) {
		return label;
	}

	return `${label} <span style="color:var(--text-muted);font-weight:500;">${format_review_price_tag(base_entry.amount)}</span>`;
}

function get_glass_polish_review_label(item) {
	let label = get_polish_sides_label(item);
	if (!label) {
		return '-';
	}

	let polish_entry = get_glass_polishing_entry(item);
	if (!polish_entry) {
		return label;
	}

	return `${label} <span style="color:var(--text-muted);font-weight:500;">${format_review_price_tag(polish_entry.amount)}</span>`;
}

function get_glass_count_with_price(value, entry) {
	let qty = format_review_number(value || 0, 0);
	if (!qty) {
		return '-';
	}

	if (!entry) {
		return `${qty}`;
	}

	return `${qty} <span style="color:var(--text-muted);font-weight:500;">${format_review_price_tag(entry.amount)}</span>`;
}

function get_glass_sandblast_review_label(item) {
	if (!item.sandblast_type || item.sandblast_type === 'None') {
		return '-';
	}

	let sandblast_entry = get_glass_sandblast_entry(item);
	let label = frappe.utils.escape_html(item.sandblast_type);

	if (!sandblast_entry) {
		return label;
	}

	return `${label} <span style="color:var(--text-muted);font-weight:500;">${format_review_price_tag(sandblast_entry.amount)}</span>`;
}

const QB_REVIEW_CATEGORY_META = {
	Aluminium: { label: 'Aluminium Items', color: '#95a5a6', icon: '⬜' },
	Fittings: { label: 'Fittings Items', color: '#e67e22', icon: '🔶' },
	Ceiling: { label: 'Ceiling Items', color: '#2ecc71', icon: '🟩' },
	Rubber: { label: 'Rubber Items', color: '#8e44ad', icon: '🟪' },
	Silicone: { label: 'Silicone Items', color: '#16a085', icon: '🟢' }
};

function get_review_category_meta(category) {
	return QB_REVIEW_CATEGORY_META[category] || { label: `${category} Items`, color: '#7f8c8d', icon: '◻' };
}

function render_review_glass_row(item, index) {
	if (item.sale_mode === 'Sheet') {
		let pieces = flt(item.pcs || 0);
		let sheet_dimensions = get_sheet_size_dimensions(item.sheet_size);
		return `
			<tr>
				<td style="text-align:center;">-</td>
				<td style="text-align:center;">-</td>
				<td style="text-align:center;">-</td>
				<td style="text-align:center;">-</td>
				<td style="text-align:center;">-</td>
				<td style="text-align:center;">-</td>
				<td style="text-align:center;">-</td>
				<td style="text-align:center;">${format_review_number(item.qty || 0)}</td>
				<td style="white-space:nowrap;">-</td>
				<td style="text-align:center;white-space:nowrap;">-</td>
				<td style="text-align:center;white-space:nowrap;">-</td>
				<td style="text-align:center;white-space:nowrap;">-</td>
				<td style="text-align:center;">${item.numbering || '-'}</td>
				<td style="text-align:center;">${sheet_dimensions.width ? frappe.utils.escape_html(sheet_dimensions.width) : '-'}</td>
				<td style="text-align:center;">${sheet_dimensions.height ? frappe.utils.escape_html(sheet_dimensions.height) : '-'}</td>
				<td style="text-align:center;">SFT</td>
				<td style="text-align:center;">${pieces || '-'}</td>
				<td style="font-weight:500;white-space:nowrap;">${get_glass_type_review_label(item)}</td>
				<td style="white-space:pre-wrap;">${item.description ? frappe.utils.escape_html(item.description) : '-'}</td>
			</tr>
		`;
	}

	let pieces = flt(item.qty || 0);
	let pw = (flt(item.width_mm || 0) / 305) * pieces;
	let ph = (flt(item.height_mm || 0) / 305) * pieces;
	let baseWidthFt = get_glass_base_width_ft(item);
	let baseHeightFt = get_glass_base_height_ft(item);
	let holes_entry = get_glass_holes_entry(item);
	let notches_entry = get_glass_notches_entry(item);

	return `
		<tr>
			<td style="text-align:center;">${format_review_number(baseWidthFt)}</td>
			<td style="text-align:center;">${format_review_number(baseHeightFt)}</td>
			<td style="text-align:center;">${format_review_number(item.width_allowance || 0)}</td>
			<td style="text-align:center;">${format_review_number(item.height_allowance || 0)}</td>
			<td style="text-align:center;">${format_review_number(pw)}</td>
			<td style="text-align:center;">${format_review_number(ph)}</td>
			<td style="text-align:center;">${format_review_number(get_glass_polishing_rft(item))}</td>
			<td style="text-align:center;">${format_review_number(get_glass_area_sqft(item))}</td>
			<td style="white-space:nowrap;">${get_glass_polish_review_label(item)}</td>
			<td style="text-align:center;white-space:nowrap;">${get_glass_count_with_price(item.holes || 0, holes_entry)}</td>
			<td style="text-align:center;white-space:nowrap;">${get_glass_count_with_price(item.notches || 0, notches_entry)}</td>
			<td style="text-align:center;white-space:nowrap;">${get_glass_sandblast_review_label(item)}</td>
			<td style="text-align:center;">${item.numbering || '-'}</td>
			<td style="text-align:center;">${format_review_number(get_glass_dimension_review_value(item, 'width_mm'), item.dimension_uom === 'inches' ? 2 : 0)}</td>
			<td style="text-align:center;">${format_review_number(get_glass_dimension_review_value(item, 'height_mm'), item.dimension_uom === 'inches' ? 2 : 0)}</td>
			<td style="text-align:center;">${get_glass_dimension_label(item.dimension_uom)}</td>
			<td style="text-align:center;">${pieces || '-'}</td>
			<td style="font-weight:500;white-space:nowrap;">${get_glass_type_review_label(item)}</td>
			<td style="white-space:pre-wrap;">${item.description ? frappe.utils.escape_html(item.description) : '-'}</td>
		</tr>
	`;
}

function render_review_aluminium_row(item, index) {
	return `
		<tr>
			<td style="text-align:center;">${index + 1}</td>
			<td style="font-weight:500;">${frappe.utils.escape_html(item.item_name || item.item_code || '')}</td>
			<td style="text-align:center;">${item.aluminium_color ? frappe.utils.escape_html(item.aluminium_color) : '-'}</td>
			<td style="white-space:pre-wrap;">${item.description ? frappe.utils.escape_html(item.description) : '-'}</td>
			<td style="text-align:center;">${item.qty || '-'}</td>
			<td style="text-align:center;">
				<span style="background:var(--subtle-fg);padding:2px 8px;border-radius:6px;font-size:12px;">${get_item_selling_price_label(item)}</span>
			</td>
			<td style="text-align:right;">${format_currency(item.rate, 'KES')}</td>
			<td style="text-align:right;font-weight:600;">${format_currency(item.amount, 'KES')}</td>
		</tr>
	`;
}

function render_review_fittings_row(item, index) {
	return `
		<tr>
			<td style="text-align:center;">${index + 1}</td>
			<td style="font-weight:500;">${frappe.utils.escape_html(item.item_name || item.item_code || '')}</td>
			<td style="white-space:pre-wrap;">${item.description ? frappe.utils.escape_html(item.description) : '-'}</td>
			<td style="text-align:center;">${item.qty || '-'}</td>
			<td style="text-align:center;">
				<span style="background:var(--subtle-fg);padding:2px 8px;border-radius:6px;font-size:12px;">${get_item_selling_price_label(item)}</span>
			</td>
			<td style="text-align:right;">${format_currency(item.rate, 'KES')}</td>
			<td style="text-align:right;font-weight:600;">${format_currency(item.amount, 'KES')}</td>
		</tr>
	`;
}

function render_review_other_row(item, index, ceiling_review = null) {
	let is_ceiling_bundle = item.category === 'Ceiling' && item.ceiling_mode === 'bundle';
	let ceiling_quantity = item.quantity || item.square_metres || 0;
	let ceiling_components = is_ceiling_bundle ? get_ceiling_component_breakdown(ceiling_quantity) : [];
	let ceiling_cells = '';
	if (item.category === 'Ceiling' && ceiling_review) {
		let item_label = get_ceiling_single_review_label(item);
		ceiling_cells = ceiling_review.columns.map((column, column_index) => {
			if (is_ceiling_bundle) {
				return `<td style="text-align:center;white-space:nowrap;">${format_review_number((ceiling_components[column_index] || {}).qty, 0)}</td>`;
			}

			return `<td style="text-align:center;white-space:nowrap;">${item_label === column.key ? format_review_number(item.qty || 0, 0) : '-'}</td>`;
		}).join('');
	}
	return `
		<tr>
			<td style="text-align:center;">${index + 1}</td>
			<td style="font-weight:500;">${frappe.utils.escape_html(item.item_name || item.item_code || '')}</td>
			${item.category !== 'Ceiling' ? `<td style="white-space:pre-wrap;">${item.description ? frappe.utils.escape_html(item.description) : '-'}</td>` : ''}
			${item.category !== 'Ceiling' ? `<td style="text-align:center;">${item.qty || '-'}</td>` : ''}
			${item.category === 'Ceiling' && ceiling_review && ceiling_review.show_quantity ? `<td style="text-align:center;">${is_ceiling_bundle ? format_review_number(ceiling_quantity) : '-'}</td>` : ''}
			${item.category === 'Ceiling' && ceiling_review && ceiling_review.show_uom ? `<td style="text-align:center;white-space:nowrap;">${get_item_uom_label(item)}</td>` : ''}
			${item.category === 'Ceiling' ? ceiling_cells : ''}
			<td style="text-align:center;">
				<span style="background:var(--subtle-fg);padding:2px 8px;border-radius:6px;font-size:12px;">${get_item_selling_price_label(item)}</span>
			</td>
			<td style="text-align:right;">${format_currency(item.rate, 'KES')}</td>
			<td style="text-align:right;font-weight:600;">${format_currency(item.amount, 'KES')}</td>
		</tr>
	`;
}

function render_review_category_section(items, category) {
	if (!items.length) {
		return '';
	}

	let meta = get_review_category_meta(category);
	let is_ceiling = category === 'Ceiling';
	let ceiling_review = is_ceiling ? get_ceiling_review_config(items) : null;

	return `
		<div style="margin-bottom:24px;">
			<h5 style="margin:0 0 10px 0;font-size:15px;font-weight:600;color:${meta.color};display:flex;align-items:center;gap:8px;">
				<span style="background:${meta.color}20;padding:3px 10px;border-radius:10px;font-size:12px;">${meta.icon}</span> ${meta.label}
			</h5>
			<div class="table-responsive">
				<table class="table table-bordered" style="background:var(--card-bg); margin-bottom:0;">
					<thead style="background:var(--control-bg);">
						<tr>
							<th style="text-align:center;white-space:nowrap;">No</th>
							<th style="white-space:nowrap;">Item</th>
							${!is_ceiling ? '<th style="white-space:nowrap;">Description</th>' : ''}
							${!is_ceiling ? '<th style="text-align:center;white-space:nowrap;">Qty</th>' : ''}
							${is_ceiling && ceiling_review.show_quantity ? '<th style="text-align:center;white-space:nowrap;">Quantity</th>' : ''}
							${is_ceiling && ceiling_review.show_uom ? '<th style="text-align:center;white-space:nowrap;">UOM</th>' : ''}
							${is_ceiling ? ceiling_review.columns.map(column => `<th style="text-align:center;white-space:nowrap;">${frappe.utils.escape_html(column.label)}</th>`).join('') : ''}
							<th style="text-align:center;white-space:nowrap;">Price List</th>
							<th style="text-align:right;white-space:nowrap;">Inc.Rate</th>
							<th style="text-align:right;white-space:nowrap;">Exc.Amount</th>
						</tr>
					</thead>
					<tbody>
						${items.map((item, index) => render_review_other_row(item, index, ceiling_review)).join('')}
					</tbody>
				</table>
			</div>
		</div>
	`;
}

function render_step(page, step) {
	window.qb_state.step = step;

	// Highlight active step
	$(page.body).find('.qb-step-indicator').each(function (i) {
		$(this).toggleClass('active', (i + 1) === step);
		$(this).toggleClass('completed', (i + 1) < step);
	});

	$(page.body).find('.qb-step-content').hide();
	$(page.body).find(`.qb-step-content[data-step="${step}"]`).show();
	update_review_button_visibility(page);

	if (step === 1) {
		set_customer_step_focus(page);
	}

	// Toggle primary action visibility
	page.clear_primary_action();
	if (step === 3) {
		render_review_step(page);
	}
}

function update_review_button_visibility(page) {
	let has_items = !!(window.qb_state && window.qb_state.items && window.qb_state.items.length);
	$(page.body).find('.qb-step-content[data-step="2"] .qb-nav-step[data-step="3"]').toggle(has_items);
}

function update_customer_next_button_visibility(page, selected_customer = null) {
	let is_cash = normalize_customer_payment_mode(window.qb_state && window.qb_state.payment_mode) === 'cash';
	let ready;
	if (is_cash) {
		let phone = page.qb_customer_phone_field ? page.qb_customer_phone_field.get_value() : (window.qb_state && window.qb_state.customer_phone);
		ready = !!phone;
	} else {
		let customer = selected_customer;
		if (customer === null && page.qb_customer_field) {
			customer = page.qb_customer_field.get_value();
		}
		if (customer === null) {
			customer = window.qb_state && window.qb_state.customer;
		}
		ready = !!customer;
	}
	$(page.body).find('.qb-step-content[data-step="1"] .qb-next-1').toggle(!!ready);
}

function set_customer_step_focus(page) {
	const apply_focus = () => {
		$(page.body).find('.qb-customer-field .has-error').removeClass('has-error');
		$(page.body).find('.qb-payment-mode-field .frappe-control').addClass('has-error');

		if (page.qb_customer_field && page.qb_customer_field.$input) {
			page.qb_customer_field.$input.blur();
		}
		if (page.qb_payment_mode_field && page.qb_payment_mode_field.$input) {
			page.qb_payment_mode_field.$input.focus();
		}
	};

	apply_focus();
	setTimeout(apply_focus, 0);
	setTimeout(apply_focus, 150);
}

function render_review_step(page) {
	let $summary = $(page.body).find('.qb-review-summary');
	$summary.empty();

	// Separate items by category
	let glass_items = window.qb_state.items.filter(i => i.category === 'Glass');
	let aluminium_items = window.qb_state.items.filter(i => i.category === 'Aluminium');
	let fittings_items = window.qb_state.items.filter(i => i.category === 'Fittings');
	let ceiling_items = window.qb_state.items.filter(i => i.category === 'Ceiling');
	let rubber_items = window.qb_state.items.filter(i => i.category === 'Rubber');
	let silicone_items = window.qb_state.items.filter(i => i.category === 'Silicone');
	let other_items = window.qb_state.items.filter(i =>
		!['Glass', 'Aluminium', 'Fittings', 'Ceiling', 'Rubber', 'Silicone'].includes(i.category)
	);

	// ── Glass Section ──
	let glass_html = '';
	if (glass_items.length) {
		glass_html = `
			<div style="margin-bottom:24px;">
				<h5 style="margin:0 0 10px 0;font-size:15px;font-weight:600;color:#3498db;display:flex;align-items:center;gap:8px;">
					<span style="background:#3498db20;padding:3px 10px;border-radius:10px;font-size:12px;">🔷</span> Glass Items
				</h5>
				<div class="table-responsive">
					<table class="table table-bordered" style="background:var(--card-bg); margin-bottom:0;">
						<thead style="background:var(--control-bg);">
							<tr>
								<th style="text-align:center;white-space:nowrap;">W.sft</th>
								<th style="text-align:center;white-space:nowrap;">H.sft</th>
								<th style="text-align:center;white-space:nowrap;">W+</th>
								<th style="text-align:center;white-space:nowrap;">H+</th>
								<th style="text-align:center;white-space:nowrap;">PW</th>
								<th style="text-align:center;white-space:nowrap;">PH</th>
								<th style="text-align:center;white-space:nowrap;">P.RFT</th>
								<th style="text-align:center;white-space:nowrap;">T.SFT</th>
								<th style="white-space:nowrap;">Polish Sides</th>
								<th style="text-align:center;white-space:nowrap;">Holes</th>
								<th style="text-align:center;white-space:nowrap;">Notches</th>
								<th style="text-align:center;white-space:nowrap;">Sandblast</th>
								<th style="text-align:center;white-space:nowrap;">No</th>
								<th style="text-align:center;white-space:nowrap;">WIDTH</th>
								<th style="text-align:center;white-space:nowrap;">HEIGHT</th>
								<th style="text-align:center;white-space:nowrap;">UOM</th>
								<th style="text-align:center;white-space:nowrap;">Pcs</th>
								<th style="white-space:nowrap;">Glass Type</th>
								<th style="white-space:nowrap;">Description</th>
							</tr>
						</thead>
						<tbody>
							${glass_items.map((i, index) => render_review_glass_row(i, index)).join('')}
						</tbody>
					</table>
				</div>
			</div>
		`;
	}

	// ── Aluminium Section ──
	let aluminium_html = '';
	if (aluminium_items.length) {
		aluminium_html = `
			<div style="margin-bottom:24px;">
				<h5 style="margin:0 0 10px 0;font-size:15px;font-weight:600;color:#95a5a6;display:flex;align-items:center;gap:8px;">
					<span style="background:#95a5a620;padding:3px 10px;border-radius:10px;font-size:12px;">⬜</span> Aluminium Items
				</h5>
				<div class="table-responsive">
					<table class="table table-bordered" style="background:var(--card-bg); margin-bottom:0;">
						<thead style="background:var(--control-bg);">
							<tr>
								<th style="text-align:center;white-space:nowrap;">No</th>
								<th style="white-space:nowrap;">Item</th>
								<th style="text-align:center;white-space:nowrap;">Color</th>
								<th style="white-space:nowrap;">Description</th>
								<th style="text-align:center;white-space:nowrap;">Pcs</th>
								<th style="text-align:center;white-space:nowrap;">Price List</th>
								<th style="text-align:right;white-space:nowrap;">Inc.Rate/Piece</th>
								<th style="text-align:right;white-space:nowrap;">Exc.Amount</th>
							</tr>
						</thead>
						<tbody>
							${aluminium_items.map((i, index) => render_review_aluminium_row(i, index)).join('')}
						</tbody>
					</table>
				</div>
			</div>
		`;
	}

	// ── Fittings Section ──
	let fittings_html = '';
	if (fittings_items.length) {
		fittings_html = `
			<div style="margin-bottom:24px;">
				<h5 style="margin:0 0 10px 0;font-size:15px;font-weight:600;color:#e67e22;display:flex;align-items:center;gap:8px;">
					<span style="background:#e67e2220;padding:3px 10px;border-radius:10px;font-size:12px;">🔶</span> Fittings Items
				</h5>
				<div class="table-responsive">
					<table class="table table-bordered" style="background:var(--card-bg); margin-bottom:0;">
						<thead style="background:var(--control-bg);">
							<tr>
								<th style="text-align:center;white-space:nowrap;">No</th>
								<th style="white-space:nowrap;">Item</th>
								<th style="white-space:nowrap;">Description</th>
								<th style="text-align:center;white-space:nowrap;">Qty</th>
								<th style="text-align:center;white-space:nowrap;">Price List</th>
								<th style="text-align:right;white-space:nowrap;">Inc.Rate</th>
								<th style="text-align:right;white-space:nowrap;">Exc.Amount</th>
							</tr>
						</thead>
						<tbody>
							${fittings_items.map((i, index) => render_review_fittings_row(i, index)).join('')}
						</tbody>
					</table>
				</div>
			</div>
		`;
	}

	let ceiling_html = render_review_category_section(ceiling_items, 'Ceiling');
	let rubber_html = render_review_category_section(rubber_items, 'Rubber');
	let silicone_html = render_review_category_section(silicone_items, 'Silicone');
	let other_html = render_review_category_section(other_items, 'Other');

	// ── No items message ──
	let empty_html = '';
	if (!window.qb_state.items.length) {
		empty_html = `<p style="text-align:center;color:var(--text-muted);padding:20px;">No items added yet.</p>`;
	}

	let subtotal = get_builder_subtotal();
	let vat_total = get_builder_vat_total();
	let grand_total = get_builder_grand_total();

	let html = `
		<div style="background:var(--control-bg); padding:16px; border-radius:8px; border:1px solid var(--border-color);">
			<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
				<div>
					<h4 style="margin:0;font-size:16px;">
						<span style="color:var(--text-muted);">Customer:</span> 
						${window.qb_state.customer || '<em style="color:var(--text-muted);">Not Selected</em>'}
					</h4>
				</div>
				<div style="display:flex; gap:8px; align-items:center;">
					<button class="btn btn-default" id="btn-export-review">Export</button>
					<button class="btn btn-primary" id="btn-generate-quo">Generate Quotation</button>
				</div>
			</div>

			${glass_html}
			${aluminium_html}
			${fittings_html}
			${ceiling_html}
			${rubber_html}
			${silicone_html}
			${other_html}
			${empty_html}

			<div style="background:var(--card-bg); border:1px solid var(--border-color); border-radius:6px; padding:14px 20px; margin-top:8px;">
				<div style="display:flex; justify-content:space-between; align-items:center; gap:16px; padding-bottom:8px;">
					<span style="color:var(--text-muted);">Subtotal</span>
					<span style="font-weight:600;">${format_currency(subtotal, 'KES')}</span>
				</div>
				<div style="display:flex; justify-content:space-between; align-items:center; gap:16px; padding:8px 0; border-top:1px solid var(--border-color);">
					<span style="color:var(--text-muted);">VAT (16%)</span>
					<span style="font-weight:600;">${format_currency(vat_total, 'KES')}</span>
				</div>
				<div style="display:flex; justify-content:space-between; align-items:center; gap:16px; padding-top:10px; margin-top:8px; border-top:1px solid var(--border-color);">
					<span style="font-size:15px;font-weight:600;">Grand Total</span>
					<span style="font-size:18px;font-weight:700;color:var(--primary);">${format_currency(grand_total, 'KES')}</span>
				</div>
			</div>
		</div>
	`;

	$summary.html(html);

	// Attach the event handler to the button
	$(page.body).find('#btn-generate-quo').on('click', function () {
		generate_quotation(page);
	});
	$(page.body).find('#btn-export-review').on('click', function () {
		export_review_rows(page);
	});
}

// ────────────────────────────────────────────
// Step 1: Customer selection
// ────────────────────────────────────────────
function setup_customer_step(page) {
	let $payment_container = $(page.body).find('.qb-payment-mode-field');
	let $container = $(page.body).find('.qb-customer-field');
	$payment_container.empty();
	$container.empty();

	let payment_mode_field = frappe.ui.form.make_control({
		df: {
			fieldtype: 'Select',
			label: 'Payment Mode',
			fieldname: 'payment_mode',
			options: QB_CUSTOMER_PAYMENT_MODE_OPTIONS,
			default: get_customer_payment_mode_label(window.qb_state.payment_mode || QB_DEFAULT_CUSTOMER_PAYMENT_MODE),
		},
		parent: $payment_container,
		render_input: true
	});
	payment_mode_field.$input.css({
		'font-size': '15px',
		'padding': '6px 32px 6px 10px',
		'height': 'auto',
		'line-height': 'normal',
		'text-overflow': 'ellipsis'
	});
	page.qb_payment_mode_field = payment_mode_field;

	let $customer_link_wrap = $('<div></div>').appendTo($container);
	let $cash_contact_wrap = $('<div></div>').appendTo($container);

	let customer_field = frappe.ui.form.make_control({
		df: {
			fieldtype: 'Link',
			options: 'Customer',
			label: 'Select Customer',
			fieldname: 'customer',
			placeholder: 'Type to search for a customer...',
			get_query: function () {
				return {
					query: 'crystal_alluminium_works.api.search_builder_customers',
					filters: {
						payment_mode: normalize_customer_payment_mode(payment_mode_field.get_value())
					}
				};
			}
		},
		parent: $customer_link_wrap,
		render_input: true
	});
	customer_field.$input.css({ 'font-size': '15px', 'padding': '10px' });
	page.qb_customer_field = customer_field;

	// Cash mode: no customer to pick — every walk-in sale shares the same Cash
	// Customer record, distinguished only by the phone number captured here.
	let customer_phone_field = frappe.ui.form.make_control({
		df: {
			fieldtype: 'Data',
			options: 'Phone',
			label: 'Phone Number',
			fieldname: 'customer_phone',
			reqd: 1,
			placeholder: "Walk-in customer's phone number"
		},
		parent: $cash_contact_wrap,
		render_input: true
	});
	customer_phone_field.$input.css({ 'font-size': '15px', 'padding': '10px' });
	page.qb_customer_phone_field = customer_phone_field;

	let customer_pin_field = frappe.ui.form.make_control({
		df: {
			fieldtype: 'Data',
			label: 'KRA PIN (optional)',
			fieldname: 'customer_pin',
			placeholder: 'Optional'
		},
		parent: $cash_contact_wrap,
		render_input: true
	});
	customer_pin_field.$input.css({ 'font-size': '15px', 'padding': '10px', 'margin-top': '10px' });
	page.qb_customer_pin_field = customer_pin_field;

	// Restore previously entered values
	if (window.qb_state.customer_phone) {
		customer_phone_field.set_value(window.qb_state.customer_phone);
	}
	if (window.qb_state.customer_pin) {
		customer_pin_field.set_value(window.qb_state.customer_pin);
	}
	if (window.qb_state.payment_mode !== 'cash' && window.qb_state.customer) {
		customer_field.set_value(window.qb_state.customer);
	}

	function apply_customer_mode_visibility(mode) {
		let is_cash = mode === 'cash';
		$customer_link_wrap.toggle(!is_cash);
		$cash_contact_wrap.toggle(is_cash);
		if (is_cash) {
			get_shared_cash_customer().then(function (cash_customer) {
				window.qb_state.customer = cash_customer.name || '';
				update_customer_next_button_visibility(page);
			});
		}
		update_customer_next_button_visibility(page);
	}
	apply_customer_mode_visibility(normalize_customer_payment_mode(window.qb_state.payment_mode));

	set_customer_step_focus(page);

	payment_mode_field.$input.on('change', function () {
		let next_mode = normalize_customer_payment_mode(payment_mode_field.get_value());
		if (window.qb_state.payment_mode && window.qb_state.payment_mode !== next_mode) {
			window.qb_state.customer = '';
			customer_field.set_value('');
		}
		window.qb_state.payment_mode = next_mode;
		apply_customer_mode_visibility(next_mode);
	});

	customer_field.$input.on('change input blur awesomplete-selectcomplete', function () {
		update_customer_next_button_visibility(page, customer_field.get_value());
	});

	customer_phone_field.$input.on('change input blur', function () {
		window.qb_state.customer_phone = customer_phone_field.get_value();
		update_customer_next_button_visibility(page);
	});

	customer_pin_field.$input.on('change input blur', function () {
		window.qb_state.customer_pin = customer_pin_field.get_value();
	});

	$(page.body).find('.qb-next-1').off('click').on('click', function () {
		let payment_mode = normalize_customer_payment_mode(payment_mode_field.get_value());
		window.qb_state.payment_mode = payment_mode;

		if (payment_mode === 'cash') {
			let phone = customer_phone_field.get_value();
			if (!phone) {
				frappe.msgprint('Please enter the customer\'s phone number.');
				return;
			}
			window.qb_state.customer_phone = phone;
			window.qb_state.customer_pin = customer_pin_field.get_value();
			if (!window.qb_state.customer) {
				frappe.msgprint('Please wait for the Cash Customer record to load and try again.');
				return;
			}
			render_step(page, 2);
			return;
		}

		let val = customer_field.get_value();
		if (!val) {
			frappe.msgprint('Please select a Customer.');
			return;
		}
		window.qb_state.customer = val;
		render_step(page, 2);
	});
}

// ────────────────────────────────────────────
// Step 2: Add items
// ────────────────────────────────────────────
function get_sheet_sft_from_size(item, size) {
	let match = (item.sheet_configs || []).find(row => row.size === size);
	return match ? flt(match.sft || 0) : 0;
}

function get_sheet_size_dimensions(size) {
	let parts = String(size || '')
		.split(/x/i)
		.map(part => (part || '').trim())
		.filter(Boolean);

	return {
		width: parts[0] || '',
		height: parts[1] || ''
	};
}

function load_glass_sheet_configs(glass_type, callback) {
	if (!is_sheet_glass_type(glass_type)) {
		callback([]);
		return;
	}

	window.qb_state.glass_sheet_configs = window.qb_state.glass_sheet_configs || {};
	if (window.qb_state.glass_sheet_configs[QB_SHARED_GLASS_SHEET_CONFIG_KEY]) {
		callback(window.qb_state.glass_sheet_configs[QB_SHARED_GLASS_SHEET_CONFIG_KEY]);
		return;
	}

	frappe.call({
		method: 'crystal_alluminium_works.api.get_glass_sheet_configs',
		callback: function (r) {
			let rows = r.message || [];
			window.qb_state.glass_sheet_configs[QB_SHARED_GLASS_SHEET_CONFIG_KEY] = rows;
			callback(rows);
		}
	});
}

function add_item_row(page, category, glass_type = 'Ordinary', dimension_uom = QB_DEFAULT_GLASS_DIMENSION_UOM, glass_mode = 'Cut Size', ceiling_mode = 'single') {
	let id = frappe.utils.get_random(8);
	let glass_dimension_uom = normalize_glass_dimension_uom(dimension_uom);
	let normalized_glass_mode = category === 'Glass' ? normalize_glass_mode(glass_mode, glass_type) : 'Cut Size';
	let is_sheet_mode = category === 'Glass' && normalized_glass_mode === 'Sheet';
	let item = {
		id: id,
		category: category,
		item_code: '',
		item_name: '',
		uom: '',
		description: '',
		price_list: category === 'Aluminium'
			? 'Normal Price'
			: (category === 'Ceiling' ? get_ceiling_mode_price_list(ceiling_mode) : (is_sheet_mode ? 'Wholesale' : 'Retail')),
		qty: 1,
		pcs: 1,
		metres: 1,
		aluminium_rate_per_kg: 0,
		aluminium_weight_per_length: 0,
		quantity: category === 'Ceiling' ? 100 : 0,
		square_metres: category === 'Ceiling' ? 100 : 0,
		ceiling_mode: category === 'Ceiling' ? ceiling_mode : '',
		rate: 0,
		amount: 0,
		dimension_uom: category === 'Glass' ? glass_dimension_uom : '',
		aluminium_color: '',
		// Glass-specific
		width_mm: 0,
		height_mm: 0,
		width_allowance: 0,
		height_allowance: 0,
		base_width_ft: 0,
		base_height_ft: 0,
		width_ft: 0,
		height_ft: 0,
		area_sqft: 0,
		perimeter_rft: 0,
		polishing: 0,
		polish_width_sides: 0,
		polish_height_sides: 0,
		polish_type: QB_DEFAULT_POLISH_TYPE,
		holes: 0,
		hole_type: QB_DEFAULT_HOLE_TYPE,
		notches: 0,
		notch_type: QB_DEFAULT_NOTCH_TYPE,
		numbering: '',
		sandblast_type: 'None',
		sale_mode: is_sheet_mode ? 'Sheet' : 'Resized',
		glass_mode: normalized_glass_mode,
		sheet_size: '',
		sheet_sft: 0,
		glass_type_filter: glass_type // Temporary state tracking for filter
	};

	if (category === 'Glass' && glass_type) {
		let glass_category = `${glass_type} Glass`;
		frappe.call({
			method: 'crystal_alluminium_works.api.get_items_with_prices',
			args: { category: glass_category },
			callback: function (r) {
				let items = r.message || [];
				let preferred = items.find(row => (row.item_name || '').trim() === glass_category) || items[0];
				if (preferred) {
					item.item_code = preferred.item_code || preferred.name || '';
					item.item_name = preferred.item_name || preferred.item_code || '';
					item.uom = preferred.stock_uom || item.uom;
				}
				if (is_sheet_mode) {
					load_glass_sheet_configs(glass_type, function (sheet_rows) {
						item.sheet_configs = sheet_rows || [];
						let first_sheet = item.sheet_configs[0];
						if (first_sheet) {
							item.sheet_size = first_sheet.size || '';
							item.sheet_sft = flt(first_sheet.sft || 0);
							item.qty = item.sheet_sft * flt(item.pcs || 1);
						}
						open_item_editor(page, item, true);
					});
					return;
				}
				open_item_editor(page, item, true);
			}
		});
		return;
	}

	open_item_editor(page, item, true);
} // Added to close add_item_row

function open_ceiling_add_choice(page) {
	let d = new frappe.ui.Dialog({
		title: 'Add Ceiling Item',
		fields: [
			{
				fieldtype: 'Select',
				fieldname: 'ceiling_mode',
				label: 'Type',
				options: 'Single Item\nCeiling Bundle',
				default: 'Single Item',
				reqd: 1
			}
		],
		primary_action_label: 'Continue',
		primary_action: function (values) {
			d.hide();
			let ceiling_mode = values.ceiling_mode === 'Ceiling Bundle' ? 'bundle' : 'single';
			add_item_row(page, 'Ceiling', 'Ordinary', QB_DEFAULT_GLASS_DIMENSION_UOM, 'Cut Size', ceiling_mode);
		}
	});
	d.show();
}

function open_glass_add_choice(page) {
	let d = new frappe.ui.Dialog({
		title: 'Add Glass Items',
		fields: get_glass_add_choice_fields(QB_DEFAULT_GLASS_DIMENSION_UOM, 'Ordinary'),
		primary_action_label: 'Continue',
		primary_action: function (values) {
			d.hide();
			let dimension_uom = normalize_glass_dimension_uom(values.dimension_uom);
			if (values.entry_method === 'Upload') {
				open_glass_import_dialog(page, dimension_uom);
			} else {
				add_item_row(page, 'Glass', d.custom_glass_type, dimension_uom, values.glass_mode || 'Cut Size');
			}
		}
	});

	d.custom_glass_type = 'Ordinary'; // Default fallback
	d.show();
}

function open_specific_glass_add_choice(page, label, glass_type) {
	let d = new frappe.ui.Dialog({
		title: `Add ${label} Items`,
		fields: get_glass_add_choice_fields(QB_DEFAULT_GLASS_DIMENSION_UOM, glass_type),
		primary_action_label: 'Continue',
		primary_action: function (values) {
			d.hide();
			let dimension_uom = normalize_glass_dimension_uom(values.dimension_uom);
			if (values.entry_method === 'Upload') {
				open_glass_import_dialog(page, dimension_uom);
			} else {
				add_item_row(page, 'Glass', glass_type, dimension_uom, values.glass_mode || 'Cut Size');
			}
		}
	});
	d.show();
}

function remove_item(page, id) {
	window.qb_state.items = window.qb_state.items.filter(i => i.id !== id);
	render_items_table(page);
}

function render_price_adjustment_badge(page) {
	let adjustment = window.qb_state.price_adjustment;
	let $badge = $(page.body).find('.qb-price-adjust-badge');

	if (!adjustment || !adjustment.percent) {
		$badge.hide();
		return;
	}

	let sign = adjustment.type === '-' ? '−' : '+';
	let color = adjustment.type === '-' ? '#c0392b' : '#27ae60';
	$badge.css({ color: color }).text(`${sign}${adjustment.percent}% on all rates`).show();
}

function setup_price_adjustment_controls(page) {
	let $popover = $(page.body).find('.qb-price-adjust-popover');
	let $input = $(page.body).find('.qb-price-adjust-input');
	let selected_sign = '-';

	function set_selected_sign(sign) {
		selected_sign = sign;
		$(page.body).find('.qb-price-adjust-sign').each(function () {
			let is_active = $(this).data('sign') === sign;
			$(this).css({
				'background': is_active ? 'var(--primary)' : 'var(--subtle-fg)',
				'color': is_active ? '#fff' : 'var(--text-color)'
			});
		});
	}
	set_selected_sign(selected_sign);

	$(page.body).on('click.qbbuilder', '.qb-adjust-pricing-btn', function (e) {
		e.stopPropagation();
		let adjustment = window.qb_state.price_adjustment;
		if (adjustment) {
			set_selected_sign(adjustment.type);
			$input.val(adjustment.percent);
		}
		$popover.toggle();
	});

	$(page.body).on('click.qbbuilder', '.qb-price-adjust-sign', function () {
		set_selected_sign($(this).data('sign'));
	});

	$(page.body).on('click.qbbuilder', '.qb-price-adjust-apply', function () {
		let percent = flt($input.val());
		if (percent <= 0) {
			frappe.msgprint('Enter a percentage greater than 0.');
			return;
		}
		if (percent > 100) percent = 100;

		window.qb_state.price_adjustment = { type: selected_sign, percent: percent };
		render_items_table(page);
		$popover.hide();
	});

	$(page.body).on('click.qbbuilder', '.qb-price-adjust-clear', function () {
		window.qb_state.price_adjustment = null;
		$input.val('');
		render_items_table(page);
		$popover.hide();
	});

	$(document).off('click.qbbuilder-price-adjust').on('click.qbbuilder-price-adjust', function (e) {
		if (!$(e.target).closest('.qb-price-adjust-popover, .qb-adjust-pricing-btn').length) {
			$popover.hide();
		}
	});
}

function render_items_table(page) {
	sync_price_adjustment();

	let $tbody = $(page.body).find('.qb-items-body');
	$tbody.empty();
	update_review_button_visibility(page);

	if (window.qb_state.items.length === 0) {
		$tbody.html('<tr><td colspan="10" style="padding:20px;text-align:center;color:var(--text-muted);">No items added yet. Use the buttons above to add products.</td></tr>');
		return;
	}

	window.qb_state.items.forEach(function (item) {
		let cat_color = {
			'Glass': '#3498db',
			'Aluminium': '#95a5a6',
			'Fittings': '#e67e22',
			'Ceiling': '#2ecc71',
			'Rubber': '#8e44ad',
			'Silicone': '#16a085'
		}[item.category] || '#7f8c8d';

		// For glass with a composite breakdown, show a tooltip indicator
		let breakdown_html = '';
		if (item.category === 'Glass' && item.glass_breakdown && item.glass_breakdown.length > 1) {
			let tip = item.glass_breakdown.map(b => `${b.label}: ${format_currency(b.amount, 'KES')}`).join('\n');
			breakdown_html = `<span title="${tip}" style="margin-left:4px;cursor:help;font-size:11px;color:var(--text-muted);">📋</span>`;
		}
		if (item.category === 'Ceiling' && item.ceiling_mode === 'bundle') {
			let tip = get_ceiling_component_breakdown(item.quantity || item.square_metres || 0)
				.map(b => `${b.label}: ${format_review_number(b.qty, 2)} pcs`)
				.join('\n');
			breakdown_html = `<span title="${tip}" style="margin-left:4px;cursor:help;font-size:11px;color:var(--text-muted);">📋</span>`;
		}

		$tbody.append(`
			<tr data-id="${item.id}">
				<td style="padding:12px 16px;">
					<span style="background:${cat_color}20;color:${cat_color};padding:3px 10px;border-radius:10px;font-size:12px;font-weight:600;">${item.category}</span>
				</td>
				<td style="padding:12px 16px;font-weight:500;">
					${item.item_code || '<em style="color:var(--text-muted);">not set</em>'}
				</td>
				<td style="padding:12px 16px;">
					${item.item_name || '<span style="color:var(--text-muted);">-</span>'}
				</td>
					<td style="padding:12px 16px;">
						<span style="background:var(--subtle-fg);padding:3px 10px;border-radius:6px;font-size:12px;">${get_item_selling_price_label(item)}</span>
					</td>
					<td style="padding:12px 16px;text-align:center;">${get_item_display_qty(item)}</td>
					<td style="padding:12px 16px;text-align:center;">${format_review_number(get_item_uom_qty(item), 2)}</td>
					<td style="padding:12px 16px;text-align:center;">${get_item_uom_label(item) || '<span style="color:var(--text-muted);">-</span>'}</td>
					<td style="padding:12px 16px;text-align:right;">${format_currency(item.rate, 'KES')}</td>
					<td style="padding:12px 16px;text-align:right;font-weight:600;">${format_currency(item.amount, 'KES')}${breakdown_html}</td>
					<td style="padding:12px 16px;text-align:center;">
					<button class="btn btn-xs btn-default qb-edit-item" data-id="${item.id}" style="margin-right:4px;">✏️</button>
					<button class="btn btn-xs btn-danger qb-remove-item" data-id="${item.id}">✕</button>
				</td>
			</tr>
		`);
	});

	// Calculate grand total
	let grand = window.qb_state.items.reduce((s, i) => s + (i.amount || 0), 0);
	$(page.body).find('.qb-grand-total').text(format_currency(grand, 'KES'));

	render_price_adjustment_badge(page);

	// Bind edit/remove
	$(page.body).find('.qb-edit-item').off('click').on('click', function () {
		let id = $(this).data('id');
		let item = window.qb_state.items.find(i => i.id === id);
		if (item) open_item_editor(page, item, false);
	});
	$(page.body).find('.qb-remove-item').off('click').on('click', function () {
		remove_item(page, $(this).data('id'));
	});
}

function open_item_editor(page, item, is_new = false) {
	let is_glass = item.category === 'Glass';
	let is_ceiling = item.category === 'Ceiling';
	if (is_ceiling && !item.ceiling_mode) {
		item.ceiling_mode = flt(item.quantity || item.square_metres || 0) > 0 ? 'bundle' : 'single';
	}
	let is_ceiling_bundle = is_ceiling && item.ceiling_mode === 'bundle';
	if (is_ceiling) {
		item.price_list = get_ceiling_mode_price_list(item.ceiling_mode);
	}
	let is_sheet_glass = is_glass && (item.glass_mode === 'Sheet' || item.sale_mode === 'Sheet');

	if (is_sheet_glass && (!item.sheet_configs || !item.sheet_configs.length)) {
		window.qb_state.glass_sheet_configs = window.qb_state.glass_sheet_configs || {};
		if (window.qb_state.glass_sheet_configs[QB_SHARED_GLASS_SHEET_CONFIG_KEY]) {
			item.sheet_configs = window.qb_state.glass_sheet_configs[QB_SHARED_GLASS_SHEET_CONFIG_KEY];
		} else {
			frappe.call({
				method: 'crystal_alluminium_works.api.get_glass_sheet_configs',
				async: false,
				callback: function (r) {
					item.sheet_configs = r.message || [];
					window.qb_state.glass_sheet_configs[QB_SHARED_GLASS_SHEET_CONFIG_KEY] = item.sheet_configs;
				}
			});
		}
	}

	let fields = [
		{
			fieldtype: 'Link',
			options: 'Item',
			fieldname: 'item_code',
			label: 'Item',
			reqd: 1,
			read_only: 0,
			get_query: function () {
				let filters = { item_group: item.category };
				if (item.category === 'Glass') {
					let f = [
						['Item', 'item_group', '=', 'Glass'],
						['Item', 'item_name', 'not like', '%Polishing%'],
						['Item', 'item_name', 'not like', '%Drilling%'],
						['Item', 'item_name', 'not like', '%Sandblasting%'],
						['Item', 'item_name', 'not like', '%Hole%'],
						['Item', 'item_name', 'not like', '%Notch%']
					];

					if (item.glass_type_filter) {
						f.push(['Item', 'custom_glass_type', '=', item.glass_type_filter]);
					}

					return { filters: f };
				}
				if (item.category === 'Ceiling' && item.ceiling_mode === 'bundle') {
					return {
						filters: [
							['Item', 'item_group', '=', 'Ceiling'],
							['Item', 'item_code', 'in', Array.from(QB_CEILING_BOARD_ITEM_CODES)]
						]
					};
				}
				return { filters: filters };
			},
			default: item.item_code,
			change: function () {
				queue_fetch_rate(true);
			}
		},
		{
			fieldtype: 'HTML',
			fieldname: 'stock_balance_html',
			label: 'Stock Balance'
		},
		{ fieldtype: 'Column Break' },
		{
			fieldtype: 'Select',
			options: item.category === 'Aluminium' ? QB_ALUMINIUM_PRICE_OPTIONS : 'Retail\nWholesale\nSpecial',
			fieldname: 'price_list',
			label: 'Selling Price',
			reqd: 1,
			read_only: is_sheet_glass || is_ceiling ? 1 : 0,
			default: item.category === 'Aluminium'
				? get_aluminium_price_label(item.price_list)
				: (is_ceiling ? get_ceiling_mode_price_list(item.ceiling_mode) : (is_sheet_glass ? 'Wholesale' : (item.price_list || 'Retail'))),
			change: function () {
				queue_fetch_rate(false);
			}
		},
		{ fieldtype: 'Section Break' },
		{
			fieldtype: (item.category === 'Aluminium' || is_ceiling || is_glass) ? 'Int' : 'Float',
			fieldname: is_sheet_glass ? 'pcs' : 'qty',
			label: 'Pcs',
			default: is_sheet_glass ? (item.pcs || 1) : (item.qty || 1),
			reqd: is_ceiling_bundle ? 0 : 1,
			read_only: is_ceiling_bundle ? 1 : 0,
			hidden: is_ceiling_bundle ? 1 : 0
		},
		{ fieldtype: 'Column Break' },
		{
			fieldtype: 'Currency',
			fieldname: 'rate',
			label: item.category === 'Aluminium'
				? 'Rate Per Piece'
				: (is_ceiling ? (is_ceiling_bundle ? 'Rate Per Sqm' : 'Rate Per Piece') : 'Rate'),
			default: item.rate || 0,
			read_only: item.category === 'Aluminium' || is_sheet_glass ? 1 : 0
		}
	];

	if (is_sheet_glass) {
		let sheet_options = (item.sheet_configs || []).map(row => row.size).filter(Boolean).join('\n');
		fields.push(
			{ fieldtype: 'Section Break', label: 'Sheet Details' },
			{
				fieldtype: 'Select',
				fieldname: 'sheet_size',
				label: 'Size',
				options: sheet_options,
				default: item.sheet_size || ((item.sheet_configs || [])[0] || {}).size || '',
				reqd: 1
			},
			{ fieldtype: 'Column Break' },
			{
				fieldtype: 'Float',
				fieldname: 'sheet_sft',
				label: 'SFT / Sheet',
				read_only: 1,
				default: item.sheet_sft || get_sheet_sft_from_size(item, item.sheet_size || ((item.sheet_configs || [])[0] || {}).size)
			},
			{ fieldtype: 'Section Break' },
			{
				fieldtype: 'Float',
				fieldname: 'sheet_qty',
				label: 'Qty',
				read_only: 1,
				default: flt(item.qty || 0) || (get_sheet_sft_from_size(item, item.sheet_size || ((item.sheet_configs || [])[0] || {}).size) * flt(item.pcs || 1))
			},
			{ fieldtype: 'Section Break', label: 'Item Details' },
			{ fieldtype: 'Data', fieldname: 'glass_type', label: 'Glass Type', read_only: 1, hidden: 1, default: item.glass_type || item.glass_type_filter || '' },
			{ fieldtype: 'Small Text', fieldname: 'description', label: 'Description', default: item.description || '' }
		);
	}

	if (item.category === 'Aluminium') {
		fields.push(
			{ fieldtype: 'Section Break', label: 'Aluminium Pricing' },
			{
				fieldtype: 'Currency',
				fieldname: 'aluminium_rate_per_kg',
				label: 'Rate / Kg',
				default: item.aluminium_rate_per_kg || 0
			},
			{ fieldtype: 'Column Break' },
			{
				fieldtype: 'Float',
				fieldname: 'aluminium_weight_per_length',
				label: 'Weight / Length',
				default: item.aluminium_weight_per_length || 0
			},
			{ fieldtype: 'Section Break', label: 'Item Details' },
			{ fieldtype: 'Select', fieldname: 'aluminium_color', label: 'Color', options: get_aluminium_color_options(), default: item.aluminium_color || 'None' },
			{ fieldtype: 'Column Break' },
			{ fieldtype: 'Small Text', fieldname: 'description', label: 'Description', default: item.description || '' }
		);
	}

	if (is_ceiling_bundle) {
		fields.push(
			{ fieldtype: 'Float', fieldname: 'quantity', label: 'Quantity (sqm)', default: item.quantity || item.square_metres || 100, reqd: 1 }
		);
	}

	if (is_glass && !is_sheet_glass) {
		let dimensionUom = normalize_glass_dimension_uom(item.dimension_uom);
		let dimensionLabel = get_glass_dimension_label(dimensionUom);
		let baseWidthFt = get_glass_base_width_ft(item);
		let baseHeightFt = get_glass_base_height_ft(item);
		let adjustedWidthFt = get_glass_adjusted_width_ft(item);
		let adjustedHeightFt = get_glass_adjusted_height_ft(item);
		fields.push(
			{ fieldtype: 'Section Break', label: 'Glass Dimensions' },
			{ fieldtype: 'Float', fieldname: 'width_mm', label: `Width (${dimensionLabel})`, default: mm_to_dimension_input(item.width_mm || 0, dimensionUom) },
			{ fieldtype: 'Float', fieldname: 'height_mm', label: `Height (${dimensionLabel})`, default: mm_to_dimension_input(item.height_mm || 0, dimensionUom) },
			{ fieldtype: 'Column Break' },
			{ fieldtype: 'Float', fieldname: 'base_width_ft', label: 'Width (ft)', read_only: 1, default: baseWidthFt },
			{ fieldtype: 'Float', fieldname: 'base_height_ft', label: 'Height (ft)', read_only: 1, default: baseHeightFt },
			{ fieldtype: 'Section Break', label: 'Allowance' },
			{ fieldtype: 'Float', fieldname: 'width_allowance', label: 'W+', default: item.width_allowance || 0 },
			{ fieldtype: 'Float', fieldname: 'height_allowance', label: 'H+', default: item.height_allowance || 0 },
			{ fieldtype: 'Column Break' },
			{ fieldtype: 'Float', fieldname: 'width_ft', label: 'Width + W (ft)', read_only: 1, default: adjustedWidthFt },
			{ fieldtype: 'Float', fieldname: 'height_ft', label: 'Height + H (ft)', read_only: 1, default: adjustedHeightFt },
			{ fieldtype: 'Section Break' },
			{ fieldtype: 'Float', fieldname: 'area_sqft', label: 'Area (sqft)', read_only: 1, default: get_glass_form_area_sqft(adjustedWidthFt, adjustedHeightFt) },
			{ fieldtype: 'Column Break' },
			{ fieldtype: 'Float', fieldname: 'perimeter_rft', label: 'Perimeter (rft)', read_only: 1, default: get_glass_form_perimeter_rft(adjustedWidthFt, adjustedHeightFt) },
			{ fieldtype: 'Section Break', label: 'Processing Options' },
			{ fieldtype: 'Int', fieldname: 'polish_width_sides', label: 'Polish Width Sides', default: item.polish_width_sides || 0, description: 'Allowed values: 0, 1, 2' },
			{ fieldtype: 'Column Break' },
			{ fieldtype: 'Int', fieldname: 'polish_height_sides', label: 'Polish Height Sides', default: item.polish_height_sides || 0, description: 'Allowed values: 0, 1, 2' },
			{ fieldtype: 'Column Break' },
			{ fieldtype: 'Select', fieldname: 'polish_type', label: 'Polish Type', options: QB_POLISH_TYPE_OPTIONS, default: item.polish_type || QB_DEFAULT_POLISH_TYPE },
			{ fieldtype: 'Section Break' },
			{ fieldtype: 'Int', fieldname: 'holes', label: 'Number of Holes', default: item.holes || 0 },
			{ fieldtype: 'Column Break' },
			{ fieldtype: 'Select', fieldname: 'hole_type', label: 'Hole Type', options: QB_HOLE_TYPE_OPTIONS, default: item.hole_type || QB_DEFAULT_HOLE_TYPE },
			{ fieldtype: 'Section Break' },
			{ fieldtype: 'Int', fieldname: 'notches', label: 'Number of Notches', default: item.notches || 0 },
			{ fieldtype: 'Column Break' },
			{ fieldtype: 'Select', fieldname: 'notch_type', label: 'Notch Type', options: QB_NOTCH_TYPE_OPTIONS, default: item.notch_type || QB_DEFAULT_NOTCH_TYPE },
			{ fieldtype: 'Section Break' },
			{ fieldtype: 'Select', fieldname: 'sandblast_type', label: 'Sandblast Type', options: 'None\nHalf\nFull', default: item.sandblast_type || 'None' },
			{ fieldtype: 'Column Break' },
			{ fieldtype: 'Data', fieldname: 'numbering', label: 'Numbering', default: item.numbering || '' },
			{ fieldtype: 'Data', fieldname: 'glass_type', label: 'Glass Type', read_only: 1, hidden: 1, default: item.glass_type || '' },
			{ fieldtype: 'Section Break', label: 'Item Details' },
			{ fieldtype: 'Small Text', fieldname: 'description', label: 'Description', default: item.description || '' }
		);
	}

	let d = new frappe.ui.Dialog({
		title: `${item.category} Item`,
		fields: fields,
		primary_action_label: 'Save Item',
		primary_action: function (values) {
			item.item_code = values.item_code;
			item.item_name = item.item_name || values.item_code;
			item.description = values.description || '';
			item.price_list = is_ceiling ? get_ceiling_mode_price_list(item.ceiling_mode) : (values.price_list || 'Retail');
			item.qty = values.qty || 1;
			item.ceiling_mode = is_ceiling ? (item.ceiling_mode || 'single') : '';
			if (item.category === 'Aluminium') {
				item.price_list = get_aluminium_price_label(values.price_list || 'Normal Price');
				item.metres = 1;
				item.aluminium_rate_per_kg = values.aluminium_rate_per_kg || 0;
				item.aluminium_weight_per_length = values.aluminium_weight_per_length || 0;
				item.aluminium_color = normalize_aluminium_color_selection(values.aluminium_color);
			} else {
				item.metres = 0;
				item.aluminium_color = '';
			}
			item.quantity = is_ceiling_bundle ? (values.quantity || 100) : 0;
			item.square_metres = item.quantity;
			item.rate = values.rate || 0;

			if (is_ceiling_bundle) {
				item.qty = 1;
				frappe.call({
					method: 'crystal_alluminium_works.api.calculate_ceiling_total',
					args: {
						item_code: item.item_code,
						price_list: item.price_list,
						quantity: item.quantity
					},
					freeze: true,
					freeze_message: 'Calculating...',
					callback: function (r) {
						if (r.message) {
							item.rate = r.message.base_rate ?? item.rate;
							item.amount = r.message.total ?? calculate_item_amount(item);
							item.ceiling_breakdown = r.message.breakdown || [];
						} else {
							item.amount = calculate_item_amount(item);
							item.ceiling_breakdown = [];
						}
						if (is_new) {
							window.qb_state.items.push(item);
						}
						close_builder_dialog(d);
						render_items_table(page);
					}
				});
				return;
			}

			if (is_ceiling) {
				item.amount = calculate_item_amount(item);
				item.ceiling_breakdown = [];
			}

			if (is_glass) {
				if (is_sheet_glass) {
					let sheet_size = values.sheet_size || '';
					let sheet_sft = get_sheet_sft_from_size(item, sheet_size) || flt(values.sheet_sft || 0);
					let pcs = flt(values.pcs || 0);

					if (!sheet_size || sheet_sft <= 0) {
						frappe.msgprint('Please select a configured sheet size.');
						return;
					}
					if (pcs <= 0) {
						frappe.msgprint('Please enter Pcs greater than 0.');
						return;
					}

					item.sale_mode = 'Sheet';
					item.glass_mode = 'Sheet';
					item.price_list = 'Wholesale';
					item.pcs = pcs;
					item.sheet_size = sheet_size;
					item.sheet_sft = sheet_sft;
					item.qty = sheet_sft * pcs;
					item.area_sqft = item.qty;
					item.width_mm = 0;
					item.height_mm = 0;
					item.width_allowance = 0;
					item.height_allowance = 0;
					item.base_width_ft = 0;
					item.base_height_ft = 0;
					item.width_ft = 0;
					item.height_ft = 0;
					item.perimeter_rft = 0;
					item.polishing = 0;
					item.polish_width_sides = 0;
					item.polish_height_sides = 0;
					item.polish_type = QB_DEFAULT_POLISH_TYPE;
					item.holes = 0;
					item.hole_type = QB_DEFAULT_HOLE_TYPE;
					item.notches = 0;
					item.notch_type = QB_DEFAULT_NOTCH_TYPE;
					item.numbering = '';
					item.sandblast_type = 'None';
					item.glass_type = values.glass_type || item.glass_type_filter || 'Ordinary';

					frappe.call({
						method: 'crystal_alluminium_works.api.calculate_glass_total',
						args: {
							item_code: item.item_code,
							price_list: item.price_list,
							qty: item.qty,
							sale_mode: item.sale_mode,
							width_mm: 0,
							height_mm: 0,
							width_allowance: 0,
							height_allowance: 0,
							polishing: 0,
							polish_width_sides: 0,
							polish_height_sides: 0,
							holes: 0,
							notches: 0,
							sandblast_type: 'None',
							polish_type: QB_DEFAULT_POLISH_TYPE,
							hole_type: QB_DEFAULT_HOLE_TYPE,
							notch_type: QB_DEFAULT_NOTCH_TYPE
						},
						freeze: true,
						freeze_message: 'Calculating...',
						callback: function (r) {
							if (r.message) {
								item.rate = r.message.base_rate ?? item.rate;
								item.amount = r.message.total ?? 0;
								item.glass_breakdown = r.message.breakdown || [];
							} else {
								item.amount = calculate_item_amount(item);
								item.glass_breakdown = [];
							}
							if (is_new) {
								window.qb_state.items.push(item);
							}
							close_builder_dialog(d);
							render_items_table(page);
						}
					});
					return;
				}

				let dimensionUom = normalize_glass_dimension_uom(item.dimension_uom);
				let polish_width_sides = cint(values.polish_width_sides || 0);
				let polish_height_sides = cint(values.polish_height_sides || 0);
				if (![0, 1, 2].includes(polish_width_sides) || ![0, 1, 2].includes(polish_height_sides)) {
					frappe.msgprint('Polish width side and polish height side can only be 0, 1, or 2.');
					return;
				}

				item.sale_mode = 'Resized';
				item.dimension_uom = dimensionUom;
				item.width_mm = dimension_input_to_mm(values.width_mm || 0, dimensionUom);
				item.height_mm = dimension_input_to_mm(values.height_mm || 0, dimensionUom);
				item.width_allowance = values.width_allowance || 0;
				item.height_allowance = values.height_allowance || 0;
				item.base_width_ft = values.base_width_ft || 0;
				item.base_height_ft = values.base_height_ft || 0;
				item.width_ft = values.width_ft || 0;
				item.height_ft = values.height_ft || 0;
				item.area_sqft = values.area_sqft || 0;
				item.polish_width_sides = polish_width_sides;
				item.polish_height_sides = polish_height_sides;
				item.polish_type = values.polish_type || QB_DEFAULT_POLISH_TYPE;
				item.polishing = polish_width_sides > 0 || polish_height_sides > 0 ? 1 : 0;
				item.perimeter_rft = get_glass_polishing_rft(item);
				item.holes = values.holes || 0;
				item.hole_type = values.hole_type || QB_DEFAULT_HOLE_TYPE;
				item.notches = values.notches || 0;
				item.notch_type = values.notch_type || QB_DEFAULT_NOTCH_TYPE;
				item.numbering = values.numbering || '';
				item.description = item.description || '';
				item.sandblast_type = values.sandblast_type || 'None';
				item.glass_type = values.glass_type || 'Ordinary';
				item.qty = values.qty || 1;

				// Call backend to compute full composite total (glass + polishing + drilling + sandblasting)
				frappe.call({
					method: 'crystal_alluminium_works.api.calculate_glass_total',
					args: {
						item_code: item.item_code,
						price_list: item.price_list,
						qty: item.qty,
						sale_mode: item.sale_mode,
						width_mm: item.width_mm,
						height_mm: item.height_mm,
						width_allowance: item.width_allowance,
						height_allowance: item.height_allowance,
						polishing: item.polishing,
						polish_width_sides: item.polish_width_sides,
						polish_height_sides: item.polish_height_sides,
						holes: item.holes,
						notches: item.notches,
						sandblast_type: item.sandblast_type,
						polish_type: item.polish_type,
						hole_type: item.hole_type,
						notch_type: item.notch_type
					},
					freeze: true,
					freeze_message: 'Calculating...',
					callback: function (r) {
						if (r.message) {
							item.base_width_ft = r.message.base_width_ft ?? item.base_width_ft;
							item.base_height_ft = r.message.base_height_ft ?? item.base_height_ft;
							item.width_ft = r.message.width_ft ?? item.width_ft;
							item.height_ft = r.message.height_ft ?? item.height_ft;
							item.area_sqft = r.message.area_sqft ?? item.area_sqft;
							item.perimeter_rft = r.message.perimeter_rft ?? item.perimeter_rft;
							item.rate = r.message.base_rate ?? item.rate;
							item.amount = r.message.total ?? 0;
							item.glass_breakdown = r.message.breakdown || [];
						} else {
							item.amount = calculate_item_amount(item);
							item.glass_breakdown = [];
						}
						if (is_new) {
							window.qb_state.items.push(item);
						}
						close_builder_dialog(d);
						render_items_table(page);
					}
				});
				return; // Early return — table rendered in callback
			} else {
				item.amount = calculate_item_amount(item);
			}

			if (is_new) {
				window.qb_state.items.push(item);
			}

			close_builder_dialog(d);
			render_items_table(page);
		}
	});

	d.show();

	if (item.category === 'Aluminium') {
		ensure_aluminium_colors(function () {
			let field = d.get_field('aluminium_color');
			if (!field) {
				return;
			}
			field.df.options = get_aluminium_color_options();
			field.refresh();
			d.set_value('aluminium_color', item.aluminium_color || 'None');
		});
	}

	// Make the glass dialog 80% height with fixed header/footer and scrollable body
	if (is_glass) {
		let $modal = d.$wrapper.find('.modal-dialog');
		let $modalContent = d.$wrapper.find('.modal-content');
		let $modalHeader = d.$wrapper.find('.modal-header');
		let $modalBody = d.$wrapper.find('.modal-body');
		let $modalFooter = d.$wrapper.find('.modal-footer');

		$modal.css({
			'max-width': '90%',
			'width': '700px',
			'height': '80vh',
			'margin': '10vh auto'
		});
		$modalContent.css({
			'height': '100%',
			'display': 'flex',
			'flex-direction': 'column'
		});
		$modalHeader.css({
			'flex-shrink': '0'
		});
		$modalBody.css({
			'flex': '1',
			'overflow-y': 'auto',
			'min-height': '0'
		});
		$modalFooter.css({
			'flex-shrink': '0',
			'border-top': '1px solid var(--border-color)'
		});
	}

	if (is_sheet_glass) {
		let update_sheet_qty = function () {
			let sheet_size = d.get_value('sheet_size') || '';
			let sheet_sft = get_sheet_sft_from_size(item, sheet_size);
			let pcs = flt(d.get_value('pcs') || 0);
			d.set_value('sheet_sft', sheet_sft);
			d.set_value('sheet_qty', sheet_sft * pcs);
		};

		if (d.fields_dict.sheet_size && d.fields_dict.sheet_size.$input) {
			d.fields_dict.sheet_size.$input.on('change', update_sheet_qty);
		}
		if (d.fields_dict.pcs && d.fields_dict.pcs.$input) {
			d.fields_dict.pcs.$input.on('input change', update_sheet_qty);
		}
		setTimeout(update_sheet_qty, 0);
	}

	// Glass real-time calculation
	if (is_glass && !is_sheet_glass) {
		let update_allowance_dimensions = function (baseWidthFt, baseHeightFt) {
			let widthAllowance = flt(d.get_value('width_allowance') || 0);
			let heightAllowance = flt(d.get_value('height_allowance') || 0);
			let adjustedWidthFt = flt(baseWidthFt || 0) + widthAllowance;
			let adjustedHeightFt = flt(baseHeightFt || 0) + heightAllowance;
			let adjustedAreaSqft = get_glass_form_area_sqft(adjustedWidthFt, adjustedHeightFt);
			let adjustedPerimeterRft = get_glass_form_perimeter_rft(adjustedWidthFt, adjustedHeightFt);

			d.set_value('base_width_ft', baseWidthFt || 0);
			d.set_value('base_height_ft', baseHeightFt || 0);
			d.set_value('width_ft', adjustedWidthFt);
			d.set_value('height_ft', adjustedHeightFt);
			d.set_value('area_sqft', adjustedAreaSqft);
			d.set_value('perimeter_rft', adjustedPerimeterRft);
		};

		let recalc = function () {
			let dimensionUom = normalize_glass_dimension_uom(item.dimension_uom);
			let w = dimension_input_to_mm(d.get_value('width_mm') || 0, dimensionUom);
			let h = dimension_input_to_mm(d.get_value('height_mm') || 0, dimensionUom);
			if (w > 0 && h > 0) {
				frappe.call({
					method: 'crystal_alluminium_works.pricing_engine.calculate_dimensions',
					args: {
						width_mm: w,
						height_mm: h,
						item_code: d.get_value('item_code') || '',
						glass_type: d.get_value('glass_type') || ''
					},
					async: false,
					callback: function (r) {
						if (r.message) {
							update_allowance_dimensions(r.message.width_ft, r.message.height_ft);
						}
					}
				});
			} else {
				update_allowance_dimensions(0, 0);
			}
		};
		d.fields_dict.width_mm.$input.on('change', recalc);
		d.fields_dict.height_mm.$input.on('change', recalc);
		d.fields_dict.width_allowance.$input.on('change', recalc);
		d.fields_dict.height_allowance.$input.on('change', recalc);
		if (baseWidthFt || baseHeightFt || adjustedWidthFt || adjustedHeightFt) {
			update_allowance_dimensions(baseWidthFt, baseHeightFt);
		} else if (flt(item.width_mm || 0) > 0 && flt(item.height_mm || 0) > 0) {
			setTimeout(recalc, 0);
		}
	}

	function queue_fetch_rate(fetch_item_details = true) {
		fetch_rate(fetch_item_details);
	}

	function fetch_item_price_rate(ic, price_list) {
		frappe.call({
			method: 'frappe.client.get_value',
			args: {
				doctype: 'Item Price',
				filters: { item_code: ic, price_list: price_list, selling: 1 },
				fieldname: 'price_list_rate'
			},
			callback: function (r) {
				if (r.message && r.message.price_list_rate) {
					d.set_value('rate', r.message.price_list_rate);
				} else {
					// Hidden standard_rate mirrors retail, so it remains the base fallback.
					frappe.db.get_value('Item', ic, 'standard_rate', function (r2) {
						if (r2 && r2.standard_rate) {
							d.set_value('rate', r2.standard_rate);
						}
					});
				}
			}
		});
	}

	function update_aluminium_rate_from_inputs() {
		let normal_price = get_aluminium_normal_price(
			d.get_value('aluminium_rate_per_kg') || 0,
			d.get_value('aluminium_weight_per_length') || 0
		);

		if (normal_price > 0) {
			d.set_value('rate', get_aluminium_rate_for_selling_price(normal_price, d.get_value('price_list')));
			return true;
		}

		return false;
	}

	// Auto-fetch rate from Item Price when item_code or price_list changes
	function fetch_rate(fetch_item_details = true) {
		try {
			let ic = d.get_value('item_code');
			if (!ic && d.fields_dict.item_code && d.fields_dict.item_code.$input) {
				ic = d.fields_dict.item_code.$input.val();
			}
			if (!ic) {
				ic = item.item_code;
			}

			// Fetch and render stock balance
			if (ic && d.fields_dict.stock_balance_html) {
				frappe.call({
					method: 'crystal_alluminium_works.api.get_item_stock_balance',
					args: { item_code: ic },
					callback: function (r) {
						let balances = r.message || [];
						let html = `<div style="padding: 10px; background: var(--subtle-fg); border: 1px solid var(--border-color); border-radius: 6px; margin-top: 5px;">
							<div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); margin-bottom: 6px; letter-spacing: 0.3px;">Current Stock Balance</div>
						`;
						if (balances.length > 0) {
							html += balances.map(b => {
								let display_name = b.warehouse.replace("Stores - CA", "").trim();
								let label = display_name ? `<span class="text-muted">${frappe.utils.escape_html(display_name)}:</span> ` : '';
								return `<div style="margin-bottom: 4px; font-size: 13px; display: flex; justify-content: space-between; gap: 20px;">
									${label}
									<strong style="color: var(--text-color);">${frappe.utils.escape_html(b.balance)}</strong>
								</div>`;
							}).join('');
						} else {
							html += `<div style="font-size: 13px; color: var(--text-muted);">No stock available in any warehouse.</div>`;
						}
						html += '</div>';
						d.fields_dict.stock_balance_html.html(html);
					}
				});
			} else if (d.fields_dict.stock_balance_html) {
				d.fields_dict.stock_balance_html.html('');
			}

			let pl = d.get_value('price_list');
			if (!pl && d.fields_dict.price_list && d.fields_dict.price_list.$input) {
				pl = d.fields_dict.price_list.$input.val();
			}
			if (!pl) {
				pl = item.category === 'Aluminium'
					? get_aluminium_price_label(item.price_list)
					: (is_sheet_glass ? 'Wholesale' : (item.price_list || 'Retail'));
			}
			if (ic && pl) {
				let lookup_price_list = item.category === 'Aluminium' ? get_aluminium_backend_price_list(pl) : pl;

				if (item.category === 'Aluminium') {
					if (fetch_item_details) {
						frappe.call({
							method: 'frappe.client.get_value',
							args: {
								doctype: 'Item',
								filters: { name: ic },
								fieldname: ['item_name', 'stock_uom', 'custom_aluminium_rate_per_kg', 'custom_aluminium_weight_per_length']
							},
							callback: function (r) {
								if (r.message) {
									item.item_name = r.message.item_name || item.item_name || ic;
									item.uom = r.message.stock_uom || item.uom;
									d.set_value('aluminium_rate_per_kg', flt(r.message.custom_aluminium_rate_per_kg || 0));
									d.set_value('aluminium_weight_per_length', flt(r.message.custom_aluminium_weight_per_length || 0));
								}
								if (!update_aluminium_rate_from_inputs()) {
									fetch_item_price_rate(ic, lookup_price_list);
								}
							}
						});
					} else if (!update_aluminium_rate_from_inputs()) {
						fetch_item_price_rate(ic, lookup_price_list);
					}
				} else {
					frappe.db.get_value('Item', ic, ['item_name', 'stock_uom'], function (item_result) {
						item.item_name = (item_result && item_result.item_name) || item.item_name || ic;
						item.uom = (item_result && item_result.stock_uom) || item.uom;
					});
					fetch_item_price_rate(ic, lookup_price_list);
				}

				if (is_glass) {
					frappe.db.get_value('Item', ic, 'custom_glass_type', function (r) {
						if (r && r.custom_glass_type) {
							d.set_value('glass_type', r.custom_glass_type);
						} else {
							d.set_value('glass_type', 'Ordinary');
						}
					});
				}
			}
		} catch (e) {
			console.error('Quotation Builder rate fetch failed', e);
		}
	}

	d.fields_dict.item_code.df.change = function () { queue_fetch_rate(true); };
	d.fields_dict.price_list.df.change = function () { queue_fetch_rate(false); };
	d.fields_dict.item_code.$input.on('change awesomplete-selectcomplete', function () {
		queue_fetch_rate(true);
	});
	d.fields_dict.price_list.$input.on('change', function () {
		queue_fetch_rate(false);
	});

	if (item.category === 'Aluminium') {
		let recalc_aluminium_from_inputs = function () {
			let ic = d.get_value('item_code');
			if (!update_aluminium_rate_from_inputs() && ic) {
				fetch_item_price_rate(ic, get_aluminium_backend_price_list(d.get_value('price_list')));
			}
		};
		d.fields_dict.aluminium_rate_per_kg.$input.on('input change', recalc_aluminium_from_inputs);
		d.fields_dict.aluminium_weight_per_length.$input.on('input change', recalc_aluminium_from_inputs);
	}

	setTimeout(function () {
		let current_item_code = d.get_value('item_code') || item.item_code;
		let current_price_list = d.get_value('price_list') || (item.category === 'Aluminium' ? get_aluminium_price_label(item.price_list) : (item.price_list || 'Retail'));
		if (current_item_code && current_price_list && (item.category === 'Aluminium' || !parseFloat(d.get_value('rate') || 0))) {
			fetch_rate(true);
		}
	}, 300);


}

function open_glass_import_dialog(page, dimension_uom = QB_DEFAULT_GLASS_DIMENSION_UOM) {
	dimension_uom = normalize_glass_dimension_uom(dimension_uom);
	let d = new frappe.ui.Dialog({
		title: 'Import Builder Items from Excel',
		fields: [
			{
				fieldtype: 'HTML',
				fieldname: 'template_help',
				options: `
						<div style="margin-bottom:12px;color:var(--text-muted);">
							Expected columns: <b>numbering</b>, <b>width</b>, <b>height</b>, <b>w+</b>, <b>h+</b>, <b>pcs</b>, <b>holes</b>, <b>notches</b>, <b>sandblast</b>, <b>polish_width_side</b>, <b>polish_height_side</b>, <b>details</b>.
							Widths and heights are read in the selected <b>UOM</b>.
							For <b>sandblast</b>, use <b>1</b> for Full, <b>0.5</b> for Half, and <b>0</b> or leave it blank for None.
							This upload now supports <b>glass items only</b>. Pick the glass category and item below, then upload the measurement rows.
							The selected selling price is applied to all imported rows.
							<button type="button" class="btn btn-xs btn-default qb-download-glass-template" style="margin-left:8px;">Download Template</button>
						</div>
					`
				},
				{
					fieldtype: 'Select',
					fieldname: 'glass_type',
					label: 'Glass Category',
					options: 'Ordinary\nLaminated\nReady Laminated\nToughened',
					default: 'Ordinary',
					reqd: 1
				},
				{
					fieldtype: 'Link',
					fieldname: 'item_code',
					label: 'Glass Item',
					options: 'Item',
					reqd: 1
				},
				{
					fieldtype: 'Select',
					fieldname: 'price_list',
					label: 'Selling Price',
					options: 'Retail\nWholesale\nSpecial',
					default: 'Retail',
					reqd: 1
				},
				{
					fieldtype: 'Select',
					fieldname: 'dimension_uom',
					label: 'UOM',
					options: QB_GLASS_DIMENSION_UOM_OPTIONS,
					default: dimension_uom,
					reqd: 1
				},
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
		primary_action_label: 'Import Rows',
		primary_action: function (values) {
			frappe.call({
				method: 'crystal_alluminium_works.api.import_glass_items_to_builder',
				args: values,
				freeze: true,
				freeze_message: 'Importing items...',
				callback: function (r) {
					let imported_items = (r.message && r.message.items) || [];
					if (imported_items.length) {
						window.qb_state.items.push(...imported_items);
						render_items_table(page);
					}
					frappe.show_alert({
						message: `${imported_items.length} item row(s) imported`,
						indicator: 'green'
					});
					d.hide();
				}
			});
		}
		});

	d.fields_dict.item_code.get_query = function () {
		return {
			filters: [
				['Item', 'item_group', '=', 'Glass'],
				['Item', 'custom_glass_type', '=', d.get_value('glass_type') || 'Ordinary'],
				['Item', 'item_name', 'not like', '%Polishing%'],
				['Item', 'item_name', 'not like', '%Drilling%'],
				['Item', 'item_name', 'not like', '%Sandblasting%'],
				['Item', 'item_name', 'not like', '%Hole%'],
				['Item', 'item_name', 'not like', '%Notch%']
			]
		};
	};

	d.fields_dict.glass_type.df.change = function () {
		d.set_value('item_code', '');
	};

	d.$wrapper.on('click', '.qb-download-glass-template', function () {
		// Streams the xlsx straight down; no File record is created.
		window.open('/api/method/crystal_alluminium_works.api.download_glass_builder_template', '_blank');
	});

	d.show();
}

function export_review_rows(page) {
	let state = window.qb_state;
	if (!state.items || !state.items.length) {
		frappe.msgprint('No items to export.');
		return;
	}

	let columns = [
		"W.sft",
		"H.sft",
		"W+",
		"H+",
		"PW",
		"PH",
		"P.RFT",
		"T.SFT",
		"Polish Sides",
		"Holes",
		"Notches",
		"Sandblast",
		"No",
		"WIDTH",
		"HEIGHT",
		"UOM",
		"Pcs",
		"Reference"
	];

	let data = [columns];

	state.items.forEach((i, idx) => {
		let isGlass = i.category === 'Glass';
		if (!isGlass) return;

		if (i.sale_mode === 'Sheet') {
			let sheet_dimensions = get_sheet_size_dimensions(i.sheet_size);
			data.push([
				'-',
				'-',
				'-',
				'-',
				'-',
				'-',
				'-',
				format_review_number(i.qty || 0),
				'-',
				'-',
				'-',
				'-',
				idx + 1,
				sheet_dimensions.width || '',
				sheet_dimensions.height || '',
				'SFT',
				flt(i.pcs || 0),
				i.item_name || i.item_code || ''
			]);
			return;
		}

		let pieces = flt(i.qty || 0);
		let pw = (flt(i.width_mm || 0) / 305) * pieces;
		let ph = (flt(i.height_mm || 0) / 305) * pieces;
		let baseWidthFt = get_glass_base_width_ft(i);
		let baseHeightFt = get_glass_base_height_ft(i);

		data.push([
			format_review_number(baseWidthFt),
			format_review_number(baseHeightFt),
			format_review_number(i.width_allowance || 0),
			format_review_number(i.height_allowance || 0),
			format_review_number(pw),
			format_review_number(ph),
			format_review_number(get_glass_polishing_rft(i)),
			format_review_number(get_glass_area_sqft(i)),
			get_polish_sides_label(i),
			format_review_number(i.holes || 0, 0),
			format_review_number(i.notches || 0, 0),
			format_review_number(get_glass_sandblast_qty(i), 1),
			idx + 1,
			format_review_number(get_glass_dimension_review_value(i, 'width_mm'), i.dimension_uom === 'inches' ? 2 : 0),
			format_review_number(get_glass_dimension_review_value(i, 'height_mm'), i.dimension_uom === 'inches' ? 2 : 0),
			get_glass_dimension_label(i.dimension_uom),
			pieces,
			i.item_name || i.item_code || ''
		]);
	});

	// Streams the xlsx straight down; no File record is created. POSTed rather than
	// opened as a URL because the row payload is too large for a query string.
	open_url_post('/api/method/crystal_alluminium_works.api.export_quotation_builder_items', {
		data: data
	}, true);
}

// ────────────────────────────────────────────
// Step 3: Review & Generate
// ────────────────────────────────────────────
function generate_quotation(page) {
	let state = window.qb_state;

	if (!state.customer) {
		frappe.msgprint('Please select a customer first.');
		render_step(page, 1);
		return;
	}
	if (state.items.length === 0) {
		frappe.msgprint('Please add at least one item.');
		render_step(page, 2);
		return;
	}

	let payment_mode = normalize_customer_payment_mode(state.payment_mode);

	let api_args = {
		customer: state.customer,
		items: JSON.stringify(state.items),
		price_adjustment_type: state.price_adjustment ? state.price_adjustment.type : '',
		price_adjustment_percent: state.price_adjustment ? state.price_adjustment.percent : 0,
		payment_mode: payment_mode
	};

	if (payment_mode === 'cash') {
		api_args.customer_phone = state.customer_phone;
		api_args.customer_pin = state.customer_pin;
	}

	// If editing an existing quotation, pass its name so the API updates it
	if (state.editing_quotation) {
		api_args.quotation_name = state.editing_quotation;
	}

	let is_edit = !!state.editing_quotation;

	frappe.call({
		method: 'crystal_alluminium_works.api.create_quotation_from_builder',
		args: api_args,
		freeze: true,
		freeze_message: is_edit ? 'Updating quotation...' : 'Generating your quotation...',
		callback: function (r) {
			if (r.message) {
				frappe.show_alert({
					message: is_edit ? 'Quotation Updated!' : 'Quotation Created!',
					indicator: 'green'
				});
				// Clear the editing flag
				window.qb_state.editing_quotation = null;
				frappe.set_route('quotation-manager', r.message);
			}
		}
	});
}

// ────────────────────────────────────────────
// HTML template
// ────────────────────────────────────────────
function get_builder_html() {
	return `
	<style>
		.qb-container {
			max-width: 100%;
			margin: 0 auto;
			padding: 20px 16px;
			font-family: var(--font-stack);
		}
		.qb-steps {
			display: flex;
			justify-content: center;
			gap: 8px;
			margin-bottom: 32px;
		}
		.qb-step-indicator {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 8px 16px;
			border-radius: 20px;
			font-size: 13px;
			font-weight: 600;
			color: var(--text-muted);
			background: var(--subtle-fg);
			cursor: pointer;
			transition: all 0.2s;
		}
		.qb-step-indicator.active {
			background: var(--primary);
			color: #fff;
		}
		.qb-step-indicator.completed {
			background: #2ecc7130;
			color: #27ae60;
		}
		.qb-step-indicator .qb-num {
			width: 22px;
			height: 22px;
			border-radius: 50%;
			background: rgba(255,255,255,0.2);
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 12px;
		}
		.qb-step-content {
			display: none;
		}
		.qb-card {
			background: var(--card-bg);
			border: 1px solid var(--border-color);
			border-radius: 12px;
			padding: 28px;
			margin-bottom: 20px;
		}
		.qb-card h3 {
			font-size: 18px;
			font-weight: 600;
			margin-bottom: 16px;
			color: var(--heading-color);
		}
		.qb-add-buttons {
			display: flex;
			gap: 12px;
			flex-wrap: wrap;
			margin-bottom: 20px;
		}
		.qb-add-btn {
			padding: 10px 20px;
			border-radius: 8px;
			border: 2px dashed var(--border-color);
			background: none;
			cursor: pointer;
			font-size: 14px;
			font-weight: 600;
			color: var(--text-muted);
			transition: all 0.15s;
		}
		.qb-add-btn:hover {
			border-color: var(--primary);
			color: var(--primary);
			background: var(--control-bg);
		}
		.qb-import-products-btn {
			padding: 10px 20px;
			border-radius: 8px;
			border: 1px solid var(--primary);
			background: var(--primary);
			cursor: pointer;
			font-size: 14px;
			font-weight: 600;
			color: white;
			transition: all 0.15s;
		}
		.qb-import-products-btn:hover {
			opacity: 0.92;
			transform: translateY(-1px);
		}
		.qb-items-table {
			width: 100%;
			border-collapse: collapse;
		}
		.qb-items-table thead th {
			padding: 10px 16px;
			font-size: 12px;
			font-weight: 600;
			color: var(--text-muted);
			text-transform: uppercase;
			letter-spacing: 0.5px;
			border-bottom: 1px solid var(--border-color);
		}
		.qb-items-table tbody tr:not(:last-child) td {
			border-bottom: 1px solid var(--border-color);
		}
		.qb-items-table tbody tr:hover {
			background: var(--subtle-fg);
		}
		.qb-footer {
			display: flex;
			justify-content: space-between;
			align-items: center;
			padding: 16px 0;
		}
		.qb-grand-total {
			font-size: 22px;
			font-weight: 700;
			color: var(--heading-color);
		}
		.qb-nav-btn {
			padding: 10px 24px;
			border-radius: 8px;
			border: none;
			font-size: 14px;
			font-weight: 600;
			cursor: pointer;
			transition: all 0.15s;
		}
		.qb-nav-btn.primary {
			background: var(--primary);
			color: #fff;
		}
		.qb-nav-btn.primary:hover {
			opacity: 0.9;
		}
		.qb-nav-btn.secondary {
			background: var(--subtle-fg);
			color: var(--text-color);
		}
	</style>

	<div class="qb-container">
		<div class="qb-steps">
			<div class="qb-step-indicator active" data-step="1">
				<span class="qb-num">1</span> Customer
			</div>
			<div class="qb-step-indicator" data-step="2">
				<span class="qb-num">2</span> Add Items
			</div>
			<div class="qb-step-indicator" data-step="3">
				<span class="qb-num">3</span> Review
			</div>
		</div>

		<!-- Step 1: Customer -->
		<div class="qb-step-content" data-step="1">
			<div class="qb-card">
				<h3>👤 Select Customer</h3>
				<div class="qb-payment-mode-field" style="margin-bottom: 16px;"></div>
				<div class="qb-customer-field" style="margin-bottom: 16px;"></div>
				<div style="text-align: right;">
					<button class="qb-nav-btn primary qb-next-1">Next →</button>
				</div>
			</div>
		</div>

		<!-- Step 2: Add Items -->
		<div class="qb-step-content" data-step="2">
			<div class="qb-card">
				<h3>📦 Add Products</h3>
				<div class="qb-add-buttons">
					<button class="qb-import-products-btn">Import Products</button>
					<button class="qb-add-btn" data-category="Glass" data-glass-type="Ordinary">+ Ordinary Glass</button>
					<button class="qb-add-btn" data-category="Glass" data-glass-type="Laminated">+ Laminated Glass</button>
					<button class="qb-add-btn" data-category="Glass" data-glass-type="Ready Laminated">+ Ready Laminated Glass</button>
					<button class="qb-add-btn" data-category="Glass" data-glass-type="Toughened">+ Toughened Glass</button>
					<button class="qb-add-btn" data-category="Aluminium">+ Aluminium</button>
					<button class="qb-add-btn" data-category="Fittings">+ Fittings</button>
					<button class="qb-add-btn" data-category="Ceiling">+ Ceiling</button>
					<button class="qb-add-btn" data-category="Rubber">+ Rubber</button>
					<button class="qb-add-btn" data-category="Silicone">+ Silicone</button>
				</div>

				<table class="qb-items-table">
					<thead>
						<tr>
							<th>Category</th>
							<th>Item</th>
							<th>Item Name</th>
							<th>Selling Price</th>
							<th style="text-align:center;">Pieces</th>
							<th style="text-align:center;">UOM Qty</th>
							<th style="text-align:center;">UOM</th>
							<th style="text-align:right;">Inc.Rate</th>
							<th style="text-align:right;">Exc.Amount</th>
							<th style="text-align:center;">Actions</th>
						</tr>
					</thead>
					<tbody class="qb-items-body">
						<tr><td colspan="9" style="padding:20px;text-align:center;color:var(--text-muted);">No items added yet. Use the buttons above to add or import products.</td></tr>
					</tbody>
				</table>

				<div class="qb-footer">
					<button class="qb-nav-btn secondary qb-nav-step" data-step="1">← Back</button>
					<div>
						<span style="color:var(--text-muted);margin-right:8px;">Grand Total:</span>
						<span class="qb-grand-total">KES 0.00</span>
					</div>
					<div style="display:flex;align-items:center;gap:10px;position:relative;">
						<span class="qb-price-adjust-badge" style="display:none;font-size:12px;font-weight:600;padding:4px 10px;border-radius:12px;background:var(--subtle-fg);"></span>
						<button class="qb-nav-btn secondary qb-adjust-pricing-btn" type="button">% Adjust Pricing</button>
						<div class="qb-price-adjust-popover" style="display:none;position:absolute;bottom:calc(100% + 10px);right:0;width:240px;background:var(--card-bg);border:1px solid var(--border-color);border-radius:10px;box-shadow:var(--shadow-lg, 0 4px 16px rgba(0,0,0,0.15));padding:16px;z-index:50;">
							<div style="font-weight:600;font-size:13px;margin-bottom:10px;">Adjust Inc.Rate for all items</div>
							<div class="qb-price-adjust-toggle" style="display:flex;gap:6px;margin-bottom:10px;">
								<button type="button" class="qb-price-adjust-sign" data-sign="-" style="flex:1;padding:8px;border-radius:6px;border:1px solid var(--border-color);background:var(--subtle-fg);font-weight:700;cursor:pointer;">− Discount</button>
								<button type="button" class="qb-price-adjust-sign" data-sign="+" style="flex:1;padding:8px;border-radius:6px;border:1px solid var(--border-color);background:var(--subtle-fg);font-weight:700;cursor:pointer;">+ Markup</button>
							</div>
							<div style="display:flex;align-items:center;gap:6px;margin-bottom:12px;">
								<input type="number" class="qb-price-adjust-input form-control" min="0" max="100" step="0.5" placeholder="0" style="flex:1;">
								<span style="font-weight:600;">%</span>
							</div>
							<div style="display:flex;justify-content:space-between;gap:8px;">
								<button type="button" class="qb-price-adjust-clear" style="background:none;border:none;color:var(--text-muted);font-size:12px;cursor:pointer;padding:0;">Clear</button>
								<button type="button" class="qb-nav-btn primary qb-price-adjust-apply" style="padding:6px 16px;font-size:13px;">Apply to all</button>
							</div>
						</div>
					</div>
					<button class="qb-nav-btn primary qb-nav-step" data-step="3">Review →</button>
				</div>
			</div>
		</div>

		<!-- Step 3: Review -->
		<div class="qb-step-content" data-step="3">
			<div class="qb-card">
				<h3>Review & Generate</h3>
				<p style="color:var(--text-muted);margin-bottom:20px;">
					Review your quotation details below. Click <b>Generate Quotation</b> to save it as a Draft. You can then edit and submit it later from the Quotation Manager.
				</p>
				<div class="qb-review-summary" style="margin-bottom:16px;"></div>
				<div style="text-align:left;">
					<button class="qb-nav-btn secondary qb-nav-step" data-step="2">← Edit Items</button>
				</div>
			</div>
		</div>
	</div>
	`;
}

frappe.pages['quotation-builder'].on_page_show = function (wrapper) {
	let page = wrapper.page || $(wrapper).data('page') || wrapper;
	refresh_quotation_builder(page);
};
