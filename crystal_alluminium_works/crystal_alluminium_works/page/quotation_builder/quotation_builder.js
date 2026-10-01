frappe.pages['quotation-builder'].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Quotation Builder',
		single_column: true
	});
	wrapper.page = page;

	load_aluminium_price_factor();
	load_ceiling_board_item_codes();

	// State
	if (!window.qb_state) {
		window.qb_state = {
			customer: '',
			customer_name: '',
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
// Fallback only; the live value is the global Aluminium Pricing Settings ratio,
// kept in step with the ratio shown on the Manage Items page.
const QB_DEFAULT_ALUMINIUM_PRICE_FACTOR = 1.07;
let QB_ALUMINIUM_PRICE_FACTOR = QB_DEFAULT_ALUMINIUM_PRICE_FACTOR;

function load_aluminium_price_factor() {
	frappe.call({
		method: 'crystal_alluminium_works.api.get_aluminium_price_factor',
		callback: function(r) {
			QB_ALUMINIUM_PRICE_FACTOR = flt(r.message) || QB_DEFAULT_ALUMINIUM_PRICE_FACTOR;
		}
	});
}
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

function qb_user_can_edit_rate() {
	return frappe.user.has_role('System Manager') || frappe.session.user === 'Administrator';
}
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
// Loaded from crystal_alluminium_works.api.get_ceiling_board_item_codes on page load —
// see CEILING_BOARD_ITEM_CODES in pricing_engine.py for the single source of truth.
// Seeded with the known codes as a fallback in case something renders before the fetch resolves.
let QB_CEILING_BOARD_ITEM_CODES = new Set(['AC1', 'AC2']);

function load_ceiling_board_item_codes() {
	frappe.call({
		method: 'crystal_alluminium_works.api.get_ceiling_board_item_codes',
		callback: function (r) {
			QB_CEILING_BOARD_ITEM_CODES = new Set(r.message || []);
		}
	});
}

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

// Same Item Price → standard_rate fallback chain fetch_item_price_rate() uses
// inside the single-item dialog, wrapped as a promise so batch-add flows can
// resolve a rate per row without duplicating the lookup logic.
function fetch_item_selling_rate(item_code, price_list) {
	return new Promise(function (resolve) {
		frappe.call({
			method: 'frappe.client.get_value',
			args: {
				doctype: 'Item Price',
				filters: { item_code: item_code, price_list: price_list, selling: 1 },
				fieldname: 'price_list_rate'
			},
			callback: function (r) {
				if (r.message && r.message.price_list_rate) {
					resolve(flt(r.message.price_list_rate));
					return;
				}
				frappe.db.get_value('Item', item_code, 'standard_rate', function (r2) {
					resolve(flt(r2 && r2.standard_rate));
				});
			}
		});
	});
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

// The batch details table has one colour cell per row and the colour list runs long, so
// those cells are type-to-search inputs backed by a <datalist> rather than a plain <select>.
// Anything typed still has to resolve to a real colour — resolve/blur handling below snaps
// the cell back to the canonical option (or None) so a typo can never reach the item.
function get_aluminium_color_datalist_html(list_id, options_str) {
	let options = options_str.split('\n').map(function (opt) {
		return `<option value="${frappe.utils.escape_html(opt)}"></option>`;
	}).join('');
	return `<datalist id="${list_id}">${options}</datalist>`;
}

function resolve_aluminium_color_option(value, options_str) {
	let typed = String(value || '').trim();
	if (!typed) {
		return 'None';
	}
	let options = options_str.split('\n');
	let exact = options.find(opt => opt === typed);
	if (exact) {
		return exact;
	}
	let lowered = typed.toLowerCase();
	return options.find(opt => opt.toLowerCase() === lowered)
		|| options.find(opt => opt.toLowerCase().indexOf(lowered) === 0)
		|| 'None';
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

	$(page.body).on('click.qbbuilder', '.qb-edit-aluminium-details-btn', function () {
		let aluminium_items = (window.qb_state.items || []).filter(function (it) { return it.category === 'Aluminium'; });
		if (!aluminium_items.length) return;
		open_aluminium_batch_details_dialog(page, aluminium_items);
	});

	$(page.body).on('click.qbbuilder', '.qb-edit-simple-details-btn', function () {
		let category = $(this).data('category');
		let category_items = (window.qb_state.items || []).filter(function (it) { return it.category === category; });
		if (!category_items.length) return;
		open_simple_batch_details_dialog(page, category, category_items);
	});

	$(page.body).on('click.qbbuilder', '.qb-edit-glass-details-btn', function () {
		// Sheet-mode glass goes through its own single-item editor (no batch
		// grid of its own), so only resized pieces belong back in this dialog.
		let glass_items = (window.qb_state.items || []).filter(function (it) {
			return it.category === 'Glass' && it.glass_mode !== 'Sheet' && it.sale_mode !== 'Sheet';
		});
		if (!glass_items.length) return;
		open_glass_batch_details_dialog(page, glass_items);
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

// calculate_glass_total / calculate_ceiling_total return base_rate net of VAT (/1.16), but an
// item's rate here is the VAT-inclusive Inc.Rate — calculate_item_amount divides it by 1.16,
// and "Edit in Builder" reloads rates grossed back up. Storing base_rate as-is took VAT off
// twice on new glass/ceiling items (295 showed as 254.31) until the quotation was reopened.
function inclusive_rate_from_server(base_rate, fallback) {
	if (base_rate === undefined || base_rate === null) {
		return fallback;
	}
	return flt(base_rate) * 1.16;
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

		// The priced area (server-computed on add/edit; the saved custom_area_sqft on Edit in
		// Builder, which the reloaded per-sqft rate was derived from) — re-multiplying the
		// rounded width_ft x height_ft drifted from the saved glass amount (2,160.93 vs 2,160.64).
		let area_sqft = flt(item.area_sqft || 0) || get_glass_area_sqft(item);
		return qty * area_sqft * rate;
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

	item.amount = calculate_item_amount(item) + get_glass_services_amount(item);
	item._price_adj_key = price_adjustment_key(adjustment);
	item._adjusted_rate = item.rate;
}

function sync_price_adjustment() {
	let adjustment = window.qb_state.price_adjustment;

	window.qb_state.items.forEach(function (item) {
		// The edit dialogs rebuild an item with Object.assign({}, it, ...), which
		// carries the old _base_rate/_price_adj_key over while writing a freshly
		// priced (unadjusted) rate. A rate that no longer matches what we last
		// set is that new base price, so re-base on it and adjust it again.
		let rate_replaced = item._adjusted_rate !== undefined && flt(item.rate) !== flt(item._adjusted_rate);
		if (rate_replaced) {
			item._base_rate = flt(item.rate || 0);
		}
		// Every row, every time — not only when the key changed — so an item's amount is
		// derived one way whether it was just added, edited, or reloaded via Edit in Builder
		// (the dialogs' own totals otherwise survived only on rows already seen here).
		apply_price_adjustment_to_item(item, adjustment);
	});
}

function is_price_adjustment_active() {
	let adjustment = window.qb_state.price_adjustment;
	return !!(adjustment && adjustment.percent);
}

// The item's rate/amount before the global adjustment, for the Review tab.
function get_item_unadjusted_rate(item) {
	return item._base_rate === undefined || item._base_rate === null ? flt(item.rate || 0) : flt(item._base_rate);
}

function get_item_unadjusted_amount(item) {
	return calculate_item_amount(Object.assign({}, item, { rate: get_item_unadjusted_rate(item) }))
		+ get_glass_services_amount(item);
}

function get_builder_unadjusted_subtotal() {
	return window.qb_state.items.reduce((sum, item) => sum + get_item_unadjusted_amount(item), 0);
}

// Rate/amount cell for the Review tables: the adjusted figure, with the
// pre-adjustment one struck through beneath it while an adjustment is on.
function format_review_adjusted_value(adjusted, unadjusted) {
	let adjusted_html = format_currency(adjusted, 'KES');
	if (!is_price_adjustment_active() || flt(adjusted, 2) === flt(unadjusted, 2)) {
		return adjusted_html;
	}
	return `${adjusted_html}<div title="Before price adjustment" style="font-size:11px;font-weight:400;color:var(--text-muted);text-decoration:line-through;">${format_currency(unadjusted, 'KES')}</div>`;
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

function format_review_number(value, precision = 2) {
	// Truncate (not round) to keep review numbers consistent with the system-wide
	// 2-decimal default — explicit precision args (mm, pcs, etc.) are left alone.
	let number = flt(value || 0);
	let factor = Math.pow(10, precision);
	let truncated = Math.trunc(number * factor) / factor;
	return Number.isFinite(truncated) ? truncated : 0;
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

// Glass service lines in a breakdown: server labels ("Polishing (8-10)") and the quotation
// rows Edit in Builder reloads ("Glass Polishing (8-10)") both match.
const QB_GLASS_SERVICE_LABEL = /polish|hole|notch|sandblast/i;

function get_glass_base_entry(item) {
	return get_glass_breakdown_entry(item, entry => {
		let label = (entry.label || '').trim().toLowerCase();
		if (QB_GLASS_SERVICE_LABEL.test(label)) return false;
		return label === 'glass' || label.startsWith('glass ') || label === 'base material';
	});
}

// Polishing / holes / notches / sandblasting on a glass item. Server-priced on save and never
// touched by the +/- adjustment, but part of what the item costs.
function get_glass_services_amount(item) {
	if (item.category !== 'Glass') return 0;
	return (item.glass_breakdown || [])
		.filter(entry => QB_GLASS_SERVICE_LABEL.test((entry && entry.label) || ''))
		.reduce((sum, entry) => sum + flt(entry.amount || 0), 0);
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

function render_review_glass_sheet_row(item, index) {
	let pieces = flt(item.pcs || 0);
	return `
		<tr>
			<td style="text-align:center;">${item.numbering || index + 1}</td>
			<td style="text-align:center;">${item.sheet_size ? frappe.utils.escape_html(item.sheet_size) : '-'}</td>
			<td style="text-align:center;">${pieces || '-'}</td>
			<td style="text-align:center;">${format_review_number(item.qty || 0)}</td>
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
			<td style="text-align:right;">${format_review_adjusted_value(item.rate, get_item_unadjusted_rate(item))}</td>
			<td style="text-align:right;font-weight:600;">${format_review_adjusted_value(item.amount, get_item_unadjusted_amount(item))}</td>
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
			<td style="text-align:right;">${format_review_adjusted_value(item.rate, get_item_unadjusted_rate(item))}</td>
			<td style="text-align:right;font-weight:600;">${format_review_adjusted_value(item.amount, get_item_unadjusted_amount(item))}</td>
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
			<td style="text-align:right;">${format_review_adjusted_value(item.rate, get_item_unadjusted_rate(item))}</td>
			<td style="text-align:right;font-weight:600;">${format_review_adjusted_value(item.amount, get_item_unadjusted_amount(item))}</td>
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
		// qb_state is authoritative when a suggestion row sets it directly (see the
		// customer-name-suggestion mousedown handler) — the phone field's own control
		// doesn't always reflect a programmatic set_value() by the time this runs, so
		// checking qb_state first avoids a stale "not ready" read right after selection.
		let phone = (window.qb_state && window.qb_state.customer_phone) ||
			(page.qb_customer_phone_field ? page.qb_customer_phone_field.get_value() : '');
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
	// Sheet glass has no cutting dimensions (width/height allowance, polish,
	// holes, notches, sandblast) — those columns are all "-" for it in the
	// combined table, so it gets its own simplified table instead.
	let glass_cut_size_items = glass_items.filter(i => i.sale_mode !== 'Sheet');
	let glass_sheet_items = glass_items.filter(i => i.sale_mode === 'Sheet');
	let aluminium_items = window.qb_state.items.filter(i => i.category === 'Aluminium');
	let fittings_items = window.qb_state.items.filter(i => i.category === 'Fittings');
	let ceiling_items = window.qb_state.items.filter(i => i.category === 'Ceiling');
	let rubber_items = window.qb_state.items.filter(i => i.category === 'Rubber');
	let silicone_items = window.qb_state.items.filter(i => i.category === 'Silicone');
	let other_items = window.qb_state.items.filter(i =>
		!['Glass', 'Aluminium', 'Fittings', 'Ceiling', 'Rubber', 'Silicone'].includes(i.category)
	);

	// ── Glass Section ──
	// Cut Size and Sheet glass are shown as separate tables: Sheet glass has
	// no cutting dimensions/polish/holes/notches/sandblast, so cramming it
	// into the Cut Size table's columns just fills them with "-".
	let glass_html = '';
	if (glass_cut_size_items.length) {
		glass_html += `
			<div style="margin-bottom:24px;">
				<h5 style="margin:0 0 10px 0;font-size:15px;font-weight:600;color:#3498db;display:flex;align-items:center;gap:8px;">
					<span style="background:#3498db20;padding:3px 10px;border-radius:10px;font-size:12px;">🔷</span> Glass Items — Cut Size
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
							${glass_cut_size_items.map((i, index) => render_review_glass_row(i, index)).join('')}
						</tbody>
					</table>
				</div>
			</div>
		`;
	}
	if (glass_sheet_items.length) {
		glass_html += `
			<div style="margin-bottom:24px;">
				<h5 style="margin:0 0 10px 0;font-size:15px;font-weight:600;color:#3498db;display:flex;align-items:center;gap:8px;">
					<span style="background:#3498db20;padding:3px 10px;border-radius:10px;font-size:12px;">🔷</span> Glass Items — Sheet
				</h5>
				<div class="table-responsive">
					<table class="table table-bordered" style="background:var(--card-bg); margin-bottom:0;">
						<thead style="background:var(--control-bg);">
							<tr>
								<th style="text-align:center;white-space:nowrap;">No</th>
								<th style="text-align:center;white-space:nowrap;">Sheet Size</th>
								<th style="text-align:center;white-space:nowrap;">Pcs</th>
								<th style="text-align:center;white-space:nowrap;">T.SFT</th>
								<th style="white-space:nowrap;">Glass Type</th>
								<th style="white-space:nowrap;">Description</th>
							</tr>
						</thead>
						<tbody>
							${glass_sheet_items.map((i, index) => render_review_glass_sheet_row(i, index)).join('')}
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

	// With a global +/- % on, show what the quotation came to before it and the
	// difference, so the adjusted totals below can be checked against the originals.
	let adjustment_totals_html = '';
	if (is_price_adjustment_active()) {
		let adjustment = window.qb_state.price_adjustment;
		let unadjusted_subtotal = get_builder_unadjusted_subtotal();
		let unadjusted_grand_total = unadjusted_subtotal * (1 + QB_VAT_RATE);
		let difference = grand_total - unadjusted_grand_total;
		let sign = adjustment.type === '-' ? '−' : '+';
		let color = adjustment.type === '-' ? '#c0392b' : '#27ae60';
		adjustment_totals_html = `
			<div style="background:var(--card-bg); border:1px dashed var(--border-color); border-radius:6px; padding:14px 20px; margin-top:8px;">
				<div style="font-size:12px;font-weight:600;text-transform:uppercase;color:var(--text-muted);padding-bottom:8px;">
					Before price adjustment <span style="color:${color};">(${sign}${adjustment.percent}% on all rates)</span>
				</div>
				<div style="display:flex; justify-content:space-between; align-items:center; gap:16px; padding-bottom:8px;">
					<span style="color:var(--text-muted);">Subtotal</span>
					<span class="qb-review-unadj-subtotal">${format_currency(unadjusted_subtotal, 'KES')}</span>
				</div>
				<div style="display:flex; justify-content:space-between; align-items:center; gap:16px; padding:8px 0; border-top:1px solid var(--border-color);">
					<span style="color:var(--text-muted);">VAT (16%)</span>
					<span class="qb-review-unadj-vat">${format_currency(unadjusted_subtotal * QB_VAT_RATE, 'KES')}</span>
				</div>
				<div style="display:flex; justify-content:space-between; align-items:center; gap:16px; padding:8px 0; border-top:1px solid var(--border-color);">
					<span style="color:var(--text-muted);">Grand Total</span>
					<span class="qb-review-unadj-grand" style="font-weight:600;">${format_currency(unadjusted_grand_total, 'KES')}</span>
				</div>
				<div style="display:flex; justify-content:space-between; align-items:center; gap:16px; padding-top:8px; border-top:1px solid var(--border-color);">
					<span style="color:var(--text-muted);">Adjustment</span>
					<span class="qb-review-adj-difference" style="font-weight:600;color:${color};">${difference < 0 ? '−' : '+'}${format_currency(Math.abs(difference), 'KES')}</span>
				</div>
			</div>
		`;
	}

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

			${adjustment_totals_html}
			<div style="background:var(--card-bg); border:1px solid var(--border-color); border-radius:6px; padding:14px 20px; margin-top:8px;">
				<div style="display:flex; justify-content:space-between; align-items:center; gap:16px; padding-bottom:8px;">
					<span style="color:var(--text-muted);">Subtotal</span>
					<span class="qb-review-subtotal" style="font-weight:600;">${format_currency(subtotal, 'KES')}</span>
				</div>
				<div style="display:flex; justify-content:space-between; align-items:center; gap:16px; padding:8px 0; border-top:1px solid var(--border-color);">
					<span style="color:var(--text-muted);">VAT (16%)</span>
					<span class="qb-review-vat" style="font-weight:600;">${format_currency(vat_total, 'KES')}</span>
				</div>
				<div style="display:flex; justify-content:space-between; align-items:center; gap:16px; padding-top:10px; margin-top:8px; border-top:1px solid var(--border-color);">
					<span style="font-size:15px;font-weight:600;">Grand Total</span>
					<span class="qb-review-grand" style="font-size:18px;font-weight:700;color:var(--primary);">${format_currency(grand_total, 'KES')}</span>
				</div>
			</div>
		</div>
	`;

	$summary.html(html);
	refresh_review_totals_from_server($summary);

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
	// make_control does not apply df.default to a Select's input — it renders with
	// nothing selected, so get_value() comes back null. Everything else on this step
	// reads window.qb_state.payment_mode (so the right fields show), but the Next
	// handler below reads the control, and null normalizes to 'invoice' — which is why
	// a cash quotation reopened via "Edit in Builder" hit "Please select a Customer".
	window.qb_state.payment_mode = normalize_customer_payment_mode(
		window.qb_state.payment_mode || QB_DEFAULT_CUSTOMER_PAYMENT_MODE
	);
	payment_mode_field.set_value(get_customer_payment_mode_label(window.qb_state.payment_mode));

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
	// Customer record, distinguished only by the name/phone number captured here.
	// Name (left) and phone (right) sit on the same row.
	let $name_phone_row = $('<div style="display:flex; gap:12px;"></div>').appendTo($cash_contact_wrap);
	let $customer_name_wrap = $('<div style="flex:1;"></div>').appendTo($name_phone_row);
	let $customer_phone_wrap = $('<div style="flex:1;"></div>').appendTo($name_phone_row);

	let customer_name_field = frappe.ui.form.make_control({
		df: {
			fieldtype: 'Data',
			label: 'Customer Name',
			fieldname: 'customer_name',
			placeholder: "Walk-in customer's name"
		},
		parent: $customer_name_wrap,
		render_input: true
	});
	customer_name_field.$input.css({ 'font-size': '15px', 'padding': '10px' });
	page.qb_customer_name_field = customer_name_field;
	$customer_name_wrap.css('position', 'relative');

	let customer_phone_field = frappe.ui.form.make_control({
		df: {
			fieldtype: 'Data',
			options: 'Phone',
			label: 'Phone Number',
			fieldname: 'customer_phone',
			reqd: 1,
			placeholder: "Walk-in customer's phone number"
		},
		parent: $customer_phone_wrap,
		render_input: true
	});
	customer_phone_field.$input.css({ 'font-size': '15px', 'padding': '10px' });
	customer_phone_field.$input.attr('maxlength', 10);
	// Strip anything non-digit and hard-cap at 10 characters as the customer types
	// (or pastes) — the 10-digit format is still re-checked on submit server-side.
	customer_phone_field.$input.on('input', function () {
		let digits_only = ($(this).val() || '').replace(/\D/g, '').slice(0, 10);
		if ($(this).val() !== digits_only) {
			$(this).val(digits_only);
		}
	});
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

	// Returning-customer lookup: as the walk-in's name is typed, suggest past
	// cash-mode quotations with a matching name so staff can pick one and have
	// the phone number / KRA PIN auto-fill instead of re-typing them.
	let $customer_name_suggestions = $(`
		<div class="qb-customer-name-suggestions" style="
			display:none;
			position:absolute;
			top:100%;
			left:0;
			right:0;
			z-index:50;
			background:var(--fg-color, #fff);
			border:1px solid var(--border-color, #d1d8dd);
			border-radius:6px;
			box-shadow:var(--shadow-md, 0 2px 6px rgba(0,0,0,0.15));
			max-height:220px;
			overflow-y:auto;
			margin-top:2px;
		"></div>
	`).appendTo($customer_name_wrap);

	let qb_customer_name_search_token = 0;
	function render_customer_name_suggestions(matches) {
		$customer_name_suggestions.empty();
		if (!matches || !matches.length) {
			$customer_name_suggestions.hide();
			return;
		}
		matches.forEach(function (match) {
			let $row = $(`
				<div class="qb-customer-name-suggestion" style="
					padding:8px 10px;
					cursor:pointer;
					font-size:13px;
					border-bottom:1px solid var(--border-color, #eef1f4);
				">
					<div style="font-weight:600;">${frappe.utils.escape_html(match.customer_name)}</div>
					<div class="text-muted" style="font-size:12px;">
						${frappe.utils.escape_html(match.phone_number || 'No phone on record')}
						${match.customer_pin ? ' &middot; PIN ' + frappe.utils.escape_html(match.customer_pin) : ''}
					</div>
				</div>
			`).appendTo($customer_name_suggestions);

			$row.on('mouseenter', function () {
				$row.css('background', 'var(--bg-light-gray, #f4f5f6)');
			}).on('mouseleave', function () {
				$row.css('background', '');
			});

			// mousedown (not click) so this fires before the input's blur handler
			$row.on('mousedown', function (e) {
				e.preventDefault();
				customer_name_field.set_value(match.customer_name);
				customer_phone_field.set_value(match.phone_number || '');
				customer_pin_field.set_value(match.customer_pin || '');
				window.qb_state.customer_name = match.customer_name;
				window.qb_state.customer_phone = match.phone_number || '';
				window.qb_state.customer_pin = match.customer_pin || '';
				update_customer_next_button_visibility(page);
				$customer_name_suggestions.hide();
			});
		});
		$customer_name_suggestions.show();
	}

	let qb_customer_name_search_debounce = frappe.utils.debounce(function (txt) {
		let token = ++qb_customer_name_search_token;
		frappe.call({
			method: 'crystal_alluminium_works.api.search_cash_customer_history',
			args: { txt: txt },
			callback: function (r) {
				// Drop stale responses and don't show a list once the field
				// isn't focused any more (e.g. the user tabbed away fast).
				if (token !== qb_customer_name_search_token || !customer_name_field.$input.is(':focus')) {
					return;
				}
				render_customer_name_suggestions(r.message || []);
			}
		});
	}, 300);

	customer_name_field.$input.on('input', function () {
		let txt = customer_name_field.get_value().trim();
		if (txt.length < 2) {
			$customer_name_suggestions.hide();
			return;
		}
		qb_customer_name_search_debounce(txt);
	});

	customer_name_field.$input.on('blur', function () {
		// Delay so a suggestion row's mousedown handler above still fires first.
		setTimeout(function () {
			$customer_name_suggestions.hide();
		}, 150);
	});

	// Restore previously entered values
	if (window.qb_state.customer_name) {
		customer_name_field.set_value(window.qb_state.customer_name);
	}
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

	customer_name_field.$input.on('change input blur', function () {
		window.qb_state.customer_name = customer_name_field.get_value();
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
			if (!/^\d{10}$/.test((phone || '').trim())) {
				frappe.msgprint('Phone Number must be exactly 10 digits.');
				return;
			}
			window.qb_state.customer_phone = phone;
			window.qb_state.customer_name = customer_name_field.get_value();
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
		aluminium_powder_coating_charge: 0,
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

	let $target = $(page.body).find('.qb-price-adjust-target');
	let $target_note = $(page.body).find('.qb-price-adjust-target-note');
	let $current = $(page.body).find('.qb-price-adjust-current');
	// The quotation priced with no adjustment, from the same server preview the Review tab
	// totals with: grand (inc. VAT), the part the % acts on (manual), the rest (other —
	// glass polishing/holes/notches etc., never adjusted) and grand / subtotal (tax_factor).
	let base = null;
	let base_seq = 0;
	let target_seq = 0;
	let target_timer = null;

	function preview_with(adjustment) {
		// Items carry the currently applied % in their rate, so re-derive each row's rate for the
		// adjustment being tried (on copies — the Builder's own rows stay untouched).
		let items = (window.qb_state.items || []).map(function (item) {
			let copy = Object.assign({}, item);
			apply_price_adjustment_to_item(copy, adjustment);
			return copy;
		});
		let state = Object.assign({}, window.qb_state, { items: items, price_adjustment: adjustment });
		return frappe.xcall('crystal_alluminium_works.api.preview_quotation_from_builder', get_quotation_api_args(state))
			.then(function (preview) {
				if (!preview || preview.error) throw new Error((preview && preview.error) || 'No preview');
				let has_real_tax = flt(preview.total_taxes_and_charges) > 0;
				let subtotal = has_real_tax ? flt(preview.grand_total) - flt(preview.total_taxes_and_charges) : flt(preview.grand_total);
				let grand = has_real_tax ? flt(preview.grand_total) : subtotal * (1 + QB_VAT_RATE);
				return { grand: grand, subtotal: subtotal, manual: flt(preview.manual_amount) };
			});
	}

	function multiplier_of(sign, percent) {
		return sign === '-' ? 1 - flt(percent) / 100 : 1 + flt(percent) / 100;
	}

	function predicted_total(multiplier) {
		return (base.manual * multiplier + base.other) * base.tax_factor;
	}

	function show_note(text, is_error) {
		$target_note.css('color', is_error ? 'var(--red-600, #c0392b)' : 'var(--text-muted)').text(text || '');
	}

	function load_base() {
		let seq = ++base_seq;
		base = null;
		$current.text('…');
		show_note('');
		if (!window.qb_state.customer || !(window.qb_state.items || []).length) {
			$current.text('—');
			show_note('Select a customer and add items first.', true);
			return;
		}
		preview_with(null).then(function (r) {
			if (seq !== base_seq) return;
			base = {
				grand: r.grand,
				manual: r.manual,
				other: r.subtotal - r.manual,
				tax_factor: r.subtotal ? r.grand / r.subtotal : 1 + QB_VAT_RATE,
			};
			$current.text(format_currency(base.grand, 'KES'));
			refresh_target_from_percent();
		}).catch(function () {
			if (seq !== base_seq) return;
			$current.text('—');
			show_note('Could not price the quotation; the % still works.', true);
		});
	}

	// % typed (or Discount/Markup switched): show the total it gives.
	function refresh_target_from_percent() {
		if (!base) return;
		let percent = flt($input.val());
		if (!percent) {
			$target.val('');
			show_note('');
			return;
		}
		$target.val(flt(predicted_total(multiplier_of(selected_sign, percent)), 2));
		show_note(`${selected_sign === '-' ? 'Discount' : 'Markup'} of ${percent}% gives about this total.`);
	}

	// Target typed: derive the % from it, check it against the server and refine once, so
	// rounding on the repriced rows doesn't leave the total a few shillings off.
	function derive_percent_from_target() {
		if (!base) return;
		let target = flt($target.val());
		if (!target) {
			show_note('');
			return;
		}
		if (base.manual <= 0) {
			show_note('Nothing on this quotation can be adjusted.', true);
			return;
		}
		let multiplier = (target / base.tax_factor - base.other) / base.manual;
		if (multiplier <= 0 || Math.abs(multiplier - 1) * 100 > 100) {
			show_note('That total needs more than a 100% change — check the figure.', true);
			return;
		}
		let seq = ++target_seq;
		let as_adjustment = function (m) {
			return { type: m < 1 ? '-' : '+', percent: flt(Math.abs(1 - m) * 100, 4) };
		};
		show_note('Working out the %…');
		preview_with(as_adjustment(multiplier)).then(function (first) {
			if (seq !== target_seq) return;
			multiplier += (target - first.grand) / (base.manual * base.tax_factor);
			let adjustment = as_adjustment(multiplier);
			return preview_with(adjustment).then(function (second) {
				if (seq !== target_seq) return;
				set_selected_sign(adjustment.type);
				$input.val(adjustment.percent);
				let off = flt(second.grand - target, 2);
				show_note(`${adjustment.type === '-' ? 'Discount' : 'Markup'} of ${adjustment.percent}% → total ${format_currency(second.grand, 'KES')}`
					+ (Math.abs(off) >= 0.01 ? ` (${off > 0 ? '+' : '−'}${format_currency(Math.abs(off), 'KES')} from rounding)` : ''));
			});
		}).catch(function () {
			if (seq !== target_seq) return;
			show_note('Could not work out the % — try again.', true);
		});
	}

	$(page.body).on('click.qbbuilder', '.qb-adjust-pricing-btn', function (e) {
		e.stopPropagation();
		let adjustment = window.qb_state.price_adjustment;
		if (adjustment) {
			set_selected_sign(adjustment.type);
			$input.val(adjustment.percent);
		}
		$target.val('');
		$popover.toggle();
		if ($popover.is(':visible')) {
			load_base();
		}
	});

	$(page.body).on('click.qbbuilder', '.qb-price-adjust-sign', function () {
		set_selected_sign($(this).data('sign'));
		refresh_target_from_percent();
	});

	$(page.body).on('input.qbbuilder', '.qb-price-adjust-input', function () {
		target_seq++;  // a typed % wins over a target still being worked out
		refresh_target_from_percent();
	});

	$(page.body).on('input.qbbuilder', '.qb-price-adjust-target', function () {
		clearTimeout(target_timer);
		target_timer = setTimeout(derive_percent_from_target, 500);
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
		$target.val('');
		show_note('');
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

	let has_aluminium_items = (window.qb_state.items || []).some(function (it) { return it.category === 'Aluminium'; });
	$(page.body).find('.qb-edit-aluminium-details-btn').toggle(has_aluminium_items);

	let has_resized_glass_items = (window.qb_state.items || []).some(function (it) {
		return it.category === 'Glass' && it.glass_mode !== 'Sheet' && it.sale_mode !== 'Sheet';
	});
	$(page.body).find('.qb-edit-glass-details-btn').toggle(has_resized_glass_items);

	QB_SIMPLE_BATCH_CATEGORIES.forEach(function (category) {
		let has_items = (window.qb_state.items || []).some(function (it) { return it.category === category; });
		$(page.body).find(`.qb-edit-simple-details-btn[data-category="${category}"]`).toggle(has_items);
	});

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

	// Totals row: Pieces add up directly; UOM Qty only adds up within one unit (square feet,
	// lengths and pieces don't sum), so it's totalled per UOM, one line each, in row order.
	// The unit is only spelled out when there is more than one — otherwise the column says it.
	let total_pieces = 0;
	let uom_totals = [];
	window.qb_state.items.forEach(function (item) {
		total_pieces += flt(get_item_display_qty(item) || 0);
		let uom = get_item_uom_label(item) || '-';
		let entry = uom_totals.find(function (t) { return t.uom === uom; });
		if (!entry) {
			entry = { uom: uom, qty: 0 };
			uom_totals.push(entry);
		}
		entry.qty += format_review_number(get_item_uom_qty(item), 2);  // as each row shows it
	});
	$tbody.append(`
		<tr class="qb-items-total-row" style="font-weight:700;border-top:2px solid var(--border-color);">
			<td colspan="4" style="padding:12px 16px;text-align:right;">Total</td>
			<td style="padding:12px 16px;text-align:center;">${flt(total_pieces, 2)}</td>
			<td style="padding:12px 16px;text-align:center;">${uom_totals.map(t => flt(t.qty, 2)).join('<br>')}</td>
			<td style="padding:12px 16px;text-align:center;">${uom_totals.length > 1 ? uom_totals.map(t => frappe.utils.escape_html(t.uom)).join('<br>') : ''}</td>
			<td colspan="3"></td>
		</tr>
	`);

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

	// Shared by the single-item Link picker (edit flow) and the multi-select
	// Item picker (new-item flow) below — same filtering rules either way.
	function resolve_item_editor_filters() {
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

			return f;
		}
		if (item.category === 'Ceiling' && item.ceiling_mode === 'bundle') {
			return [
				['Item', 'item_group', '=', 'Ceiling'],
				['Item', 'item_code', 'in', Array.from(QB_CEILING_BOARD_ITEM_CODES)]
			];
		}
		return { item_group: item.category };
	}

	// Picking several items at once only makes sense for a plain new-item add —
	// sheet glass and ceiling items (single or bundle) each need their own
	// rate fetched/computed before they have a sane amount, not a batch of
	// bare rows dropped in at rate 0.
	let enable_multi_add = is_new && !is_sheet_glass && !is_ceiling;

	let fields = [
		{
			fieldtype: 'Link',
			options: 'Item',
			fieldname: 'item_code',
			label: 'Item',
			reqd: 1,
			read_only: 0,
			get_query: function () {
				return { filters: resolve_item_editor_filters() };
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
			read_only: (item.category === 'Aluminium' || is_sheet_glass || !qb_user_can_edit_rate()) ? 1 : 0
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
				read_only: 1,
				default: item.aluminium_rate_per_kg || 0
			},
			{ fieldtype: 'Column Break' },
			{
				fieldtype: 'Float',
				fieldname: 'aluminium_weight_per_length',
				label: 'Weight / Length',
				read_only: 1,
				default: item.aluminium_weight_per_length || 0
			},
			{ fieldtype: 'Section Break' },
			{
				fieldtype: 'Currency',
				fieldname: 'aluminium_powder_coating_charge',
				label: 'Powder Coating Charges',
				description: 'Added on top of the computed Rate Per Piece.',
				read_only: 1,
				default: item.aluminium_powder_coating_charge || 0
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

	if (enable_multi_add) {
		// Slim dialog: pick as many items as needed (searching for more as you
		// go) plus a shared selling price. Each selected item lands on the
		// review table as its own bare row — open its ✏️ afterward to fill in
		// dimensions/rate/etc, same as editing any other row.
		fields = [
			{
				fieldtype: 'MultiSelectPills',
				fieldname: 'item_codes',
				label: 'Item',
				reqd: 1,
				get_data: function (txt) {
					return frappe.db.get_link_options('Item', txt, resolve_item_editor_filters());
				}
			},
			{
				fieldtype: 'Select',
				options: item.category === 'Aluminium' ? QB_ALUMINIUM_PRICE_OPTIONS : 'Retail\nWholesale\nSpecial',
				fieldname: 'price_list',
				label: 'Selling Price',
				reqd: 1,
				read_only: is_ceiling ? 1 : 0,
				default: item.category === 'Aluminium'
					? get_aluminium_price_label(item.price_list)
					: (is_ceiling ? get_ceiling_mode_price_list(item.ceiling_mode) : (item.price_list || 'Retail'))
			}
		];
	}

	let d = new frappe.ui.Dialog({
		title: enable_multi_add ? `${item.category} Items` : `${item.category} Item`,
		fields: fields,
		primary_action_label: enable_multi_add ? 'Add Items' : 'Save Item',
		primary_action: function (values) {
			if (enable_multi_add) {
				let codes = values.item_codes || [];
				if (!codes.length) {
					frappe.msgprint('Please select at least one item.');
					return;
				}
				let price_list_value = is_ceiling
					? get_ceiling_mode_price_list(item.ceiling_mode)
					: (item.category === 'Aluminium'
						? get_aluminium_price_label(values.price_list || 'Normal Price')
						: (values.price_list || 'Retail'));

				frappe.db.get_list('Item', {
					filters: { name: ['in', codes] },
					fields: ['name', 'item_name', 'stock_uom', 'standard_rate', 'custom_aluminium_rate_per_kg', 'custom_aluminium_weight_per_length'],
					limit: codes.length
				}).then(function (rows) {
					let by_code = {};
					(rows || []).forEach(function (row) { by_code[row.name] = row; });
					let new_items = codes.map(function (code) {
						let meta = by_code[code] || {};
						return Object.assign({}, item, {
							id: frappe.utils.get_random(8),
							item_code: code,
							item_name: meta.item_name || code,
							uom: meta.stock_uom || item.uom,
							price_list: price_list_value,
							qty: 1,
							rate: 0,
							amount: 0,
							// Item master defaults — Aluminium's batch table prefills
							// Rate/Kg and Weight/Length from these instead of starting at 0.
							aluminium_rate_per_kg: flt(meta.custom_aluminium_rate_per_kg || 0),
							aluminium_weight_per_length: flt(meta.custom_aluminium_weight_per_length || 0)
						});
					});

					close_builder_dialog(d);

					// Glass/Aluminium/Fittings each need their own per-piece details
					// before they have a sane rate/amount — hand off to that
					// category's batch detail table instead of dropping bare rows
					// straight into the review table.
					if (is_glass) {
						open_glass_batch_details_dialog(page, new_items);
					} else if (item.category === 'Aluminium') {
						open_aluminium_batch_details_dialog(page, new_items);
					} else if (QB_SIMPLE_BATCH_CATEGORIES.includes(item.category)) {
						open_simple_batch_details_dialog(page, item.category, new_items);
					} else {
						// Ceiling has no batch-detail step of its own,
						// so unlike the categories above they'd otherwise land on the
						// review table stuck at rate 0 / amount 0 until someone opens the
						// row's ✏️ and re-triggers fetch_rate() by hand. Same Item Price →
						// standard_rate fallback chain fetch_item_price_rate() uses.
						frappe.db.get_list('Item Price', {
							filters: { item_code: ['in', codes], price_list: price_list_value, selling: 1 },
							fields: ['item_code', 'price_list_rate']
						}).then(function (price_rows) {
							let rate_by_code = {};
							(price_rows || []).forEach(function (row) {
								if (row.price_list_rate) rate_by_code[row.item_code] = flt(row.price_list_rate);
							});
							new_items.forEach(function (new_item) {
								let meta = by_code[new_item.item_code] || {};
								new_item.rate = rate_by_code[new_item.item_code] || flt(meta.standard_rate || 0);
								new_item.amount = calculate_item_amount(new_item);
							});
							window.qb_state.items.push(...new_items);
							render_items_table(page);
						});
					}
				});
				return;
			}

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
				item.aluminium_powder_coating_charge = values.aluminium_powder_coating_charge || 0;
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
							item.rate = inclusive_rate_from_server(r.message.base_rate, item.rate);
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
								item.rate = inclusive_rate_from_server(r.message.base_rate, item.rate);
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
							item.rate = inclusive_rate_from_server(r.message.base_rate, item.rate);
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
	if (is_glass && !is_sheet_glass && !enable_multi_add) {
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

	function get_aluminium_powder_coating_charge() {
		return flt(d.get_value('aluminium_powder_coating_charge') || 0);
	}

	function update_aluminium_rate_from_inputs() {
		let normal_price = get_aluminium_normal_price(
			d.get_value('aluminium_rate_per_kg') || 0,
			d.get_value('aluminium_weight_per_length') || 0
		);

		if (normal_price > 0) {
			d.set_value('rate', get_aluminium_rate_for_selling_price(normal_price, d.get_value('price_list')) + get_aluminium_powder_coating_charge());
			return true;
		}

		return false;
	}

	// Item Price/standard_rate fallback used when Rate/Kg or Weight/Length is left blank —
	// same lookup as fetch_item_price_rate, but the powder coating charge still has to land
	// on top of whatever base rate comes back.
	function fetch_aluminium_fallback_rate(ic, price_list) {
		frappe.call({
			method: 'frappe.client.get_value',
			args: {
				doctype: 'Item Price',
				filters: { item_code: ic, price_list: price_list, selling: 1 },
				fieldname: 'price_list_rate'
			},
			callback: function (r) {
				if (r.message && r.message.price_list_rate) {
					d.set_value('rate', flt(r.message.price_list_rate) + get_aluminium_powder_coating_charge());
				} else {
					frappe.db.get_value('Item', ic, 'standard_rate', function (r2) {
						d.set_value('rate', flt(r2 && r2.standard_rate) + get_aluminium_powder_coating_charge());
					});
				}
			}
		});
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
									fetch_aluminium_fallback_rate(ic, lookup_price_list);
								}
							}
						});
					} else if (!update_aluminium_rate_from_inputs()) {
						fetch_aluminium_fallback_rate(ic, lookup_price_list);
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

	// All of the rest wires up the single-item Link/rate fields (item_code,
	// aluminium_rate_per_kg, etc.) that the multi-select add dialog doesn't have.
	if (!enable_multi_add) {
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
					fetch_aluminium_fallback_rate(ic, get_aluminium_backend_price_list(d.get_value('price_list')));
				}
			};
			d.fields_dict.aluminium_rate_per_kg.$input.on('input change', recalc_aluminium_from_inputs);
			d.fields_dict.aluminium_weight_per_length.$input.on('input change', recalc_aluminium_from_inputs);
			d.fields_dict.aluminium_powder_coating_charge.$input.on('input change', recalc_aluminium_from_inputs);
		}

		setTimeout(function () {
			let current_item_code = d.get_value('item_code') || item.item_code;
			let current_price_list = d.get_value('price_list') || (item.category === 'Aluminium' ? get_aluminium_price_label(item.price_list) : (item.price_list || 'Retail'));
			if (current_item_code && current_price_list && (item.category === 'Aluminium' || !parseFloat(d.get_value('rate') || 0))) {
				fetch_rate(true);
			}
		}, 300);
	}
}

// Keyboard flow for the batch "Fill Details" tables: these are filled column by
// column (all the Pcs, then all the Rates), so Enter moves straight down to the
// same field in the next row, Shift+Enter back up, and the end of a column rolls
// over into the top of the next one. The last cell lands on Save Items instead of
// firing it, so Enter never submits a half-filled table by accident.
function bind_batch_table_keynav(d) {
	let $wrapper = d.fields_dict.batch_table.$wrapper;

	function focus_input($el) {
		if (!$el || !$el.length) {
			return;
		}
		$el.trigger('focus');
		if ($el.is('input') && $el[0].select) {
			$el[0].select();
		}
	}

	$wrapper.on('keydown', '.qb-batch-input', function (e) {
		if (e.key !== 'Enter') {
			return;
		}
		e.preventDefault();
		e.stopPropagation();

		let $inputs = $wrapper.find('.qb-batch-input:visible');
		let fields = [];
		$inputs.each(function () {
			let field = $(this).data('field');
			if (fields.indexOf(field) === -1) {
				fields.push(field);
			}
		});

		let $row = $(this).closest('tr');
		let $rows = $wrapper.find('tbody tr');
		let row_index = $rows.index($row);
		let field = $(this).data('field');
		let step = e.shiftKey ? -1 : 1;
		let next_row_index = row_index + step;

		if (next_row_index >= 0 && next_row_index < $rows.length) {
			focus_input($rows.eq(next_row_index).find(`.qb-batch-input[data-field="${field}"]:visible`));
			return;
		}

		// Rolled off the top/bottom of this column — continue at the bottom
		// (or top) of the neighbouring one.
		let next_field_index = fields.indexOf(field) + step;
		if (next_field_index >= 0 && next_field_index < fields.length) {
			let target_row_index = step > 0 ? 0 : $rows.length - 1;
			focus_input($rows.eq(target_row_index).find(`.qb-batch-input[data-field="${fields[next_field_index]}"]:visible`));
			return;
		}

		if (step > 0) {
			d.get_primary_btn().trigger('focus');
		}
	});

	focus_input($wrapper.find('.qb-batch-input:visible').first());
}

// After multi-selecting Glass items to add, this fills in each piece's own
// dimensions/processing options in one wide inline-editable table (mirroring
// the Review tab's Glass columns) instead of opening N single-item dialogs.
// Nothing is computed as you type — Save Items batch-calls the same
// calculate_glass_total used by the single-item editor, once per row, then
// adds every finished row to the quotation in one go.
function open_glass_batch_details_dialog(page, items) {
	if (!items || !items.length) {
		return;
	}

	// Snapshot which of these ids were already in qb_state.items (i.e. this is
	// a re-edit via "Edit Glass Details", not a fresh add) — used on Save to
	// drop any row the user removed from the grid instead of leaving it
	// stranded in qb_state.items.
	let original_ids = items.filter(function (it) {
		return window.qb_state.items.some(function (existing) { return existing.id === it.id; });
	}).map(function (it) { return it.id; });

	let dimension_uom = normalize_glass_dimension_uom(items[0].dimension_uom);
	let dimension_label = get_glass_dimension_label(dimension_uom);

	function option_list(options_str, current) {
		return options_str.split('\n').map(function (opt) {
			return `<option value="${frappe.utils.escape_html(opt)}" ${opt === current ? 'selected' : ''}>${frappe.utils.escape_html(opt)}</option>`;
		}).join('');
	}

	// Shared by the initial render and by "duplicate row" below, so a clone
	// picks up the exact same markup/behaviour as an item that came in
	// through the multi-select. Values default from `it` so a clone can carry
	// over whatever the source row already had (polish/holes/notches/qty etc.)
	// while width/height/numbering start blank — those are what actually vary
	// between pieces of the same item.
	function build_row_html(it, row_number) {
		return `
			<tr data-id="${it.id}">
				<td style="text-align:center;white-space:nowrap;" class="qb-batch-row-no">${row_number}</td>
				<td style="white-space:nowrap;">${frappe.utils.escape_html(it.item_name || it.item_code)}</td>
				<td><input type="text" class="form-control input-sm qb-batch-input" data-field="numbering" value="${frappe.utils.escape_html(it.numbering || '')}" style="width:90px;"></td>
				<td><input type="number" min="0" step="any" class="form-control input-sm qb-batch-input" data-field="width_mm" value="${mm_to_dimension_input(it.width_mm || 0, dimension_uom)}" style="width:80px;"></td>
				<td><input type="number" min="0" step="any" class="form-control input-sm qb-batch-input" data-field="height_mm" value="${mm_to_dimension_input(it.height_mm || 0, dimension_uom)}" style="width:80px;"></td>
				<td><input type="number" min="1" step="1" class="form-control input-sm qb-batch-input" data-field="qty" value="${flt(it.qty || 1) || 1}" style="width:60px;"></td>
				<td><input type="number" min="0" step="any" class="form-control input-sm qb-batch-input" data-field="width_allowance" value="${flt(it.width_allowance || 0)}" style="width:70px;"></td>
				<td><input type="number" min="0" step="any" class="form-control input-sm qb-batch-input" data-field="height_allowance" value="${flt(it.height_allowance || 0)}" style="width:70px;"></td>
				<td><input type="number" min="0" step="1" class="form-control input-sm qb-batch-input" data-field="holes" value="${cint(it.holes || 0)}" style="width:60px;"></td>
				<td><select class="form-control input-sm qb-batch-input" data-field="hole_type" style="width:80px;">${option_list(QB_HOLE_TYPE_OPTIONS, it.hole_type || QB_DEFAULT_HOLE_TYPE)}</select></td>
				<td><input type="number" min="0" step="1" class="form-control input-sm qb-batch-input" data-field="notches" value="${cint(it.notches || 0)}" style="width:60px;"></td>
				<td><select class="form-control input-sm qb-batch-input" data-field="notch_type" style="width:100px;">${option_list(QB_NOTCH_TYPE_OPTIONS, it.notch_type || QB_DEFAULT_NOTCH_TYPE)}</select></td>
				<td><select class="form-control input-sm qb-batch-input" data-field="sandblast_type" style="width:80px;">${option_list('None\nHalf\nFull', it.sandblast_type || 'None')}</select></td>
				<td><input type="number" min="0" max="2" step="1" class="form-control input-sm qb-batch-input" data-field="polish_width_sides" value="${cint(it.polish_width_sides || 0)}" style="width:60px;"></td>
				<td><input type="number" min="0" max="2" step="1" class="form-control input-sm qb-batch-input" data-field="polish_height_sides" value="${cint(it.polish_height_sides || 0)}" style="width:60px;"></td>
				<td><select class="form-control input-sm qb-batch-input" data-field="polish_type" style="width:80px;">${option_list(QB_POLISH_TYPE_OPTIONS, it.polish_type || QB_DEFAULT_POLISH_TYPE)}</select></td>
				<td><input type="text" class="form-control input-sm qb-batch-input" data-field="description" value="${frappe.utils.escape_html(it.description || '')}" style="width:130px;"></td>
				<td style="text-align:center;white-space:nowrap;">
					<input type="number" min="1" step="1" value="1" class="form-control input-sm qb-duplicate-count" title="Number of copies — press Enter here to clone" style="width:46px;display:inline-block;vertical-align:middle;margin-right:2px;">
					<button type="button" class="btn btn-xs btn-default qb-duplicate-row" title="Duplicate row — clones the count field's number of copies">⧉</button>
					<button type="button" class="btn btn-xs btn-danger qb-remove-row" title="Remove row">✕</button>
				</td>
			</tr>
		`;
	}

	let rows_html = items.map(function (it, index) {
		return build_row_html(it, index + 1);
	}).join('');

	let table_html = `
		<div class="table-responsive" style="max-height:55vh;overflow:auto;">
			<table class="table table-bordered" style="background:var(--card-bg); margin-bottom:0;">
				<thead style="background:var(--control-bg);position:sticky;top:0;z-index:1;">
					<tr>
						<th style="text-align:center;white-space:nowrap;">No</th>
						<th style="white-space:nowrap;">Item</th>
						<th style="white-space:nowrap;">Numbering</th>
						<th style="white-space:nowrap;">Width (${dimension_label})</th>
						<th style="white-space:nowrap;">Height (${dimension_label})</th>
						<th style="white-space:nowrap;">Pcs</th>
						<th style="white-space:nowrap;">W+</th>
						<th style="white-space:nowrap;">H+</th>
						<th style="white-space:nowrap;">Holes</th>
						<th style="white-space:nowrap;">Hole Type</th>
						<th style="white-space:nowrap;">Notches</th>
						<th style="white-space:nowrap;">Notch Type</th>
						<th style="white-space:nowrap;">Sandblast</th>
						<th style="white-space:nowrap;">PW</th>
						<th style="white-space:nowrap;">PH</th>
						<th style="white-space:nowrap;">Polish Type</th>
						<th style="white-space:nowrap;">Description</th>
						<th style="white-space:nowrap;"></th>
					</tr>
				</thead>
				<tbody>${rows_html}</tbody>
			</table>
		</div>
	`;

	let d = new frappe.ui.Dialog({
		title: 'Glass Items — Fill Details',
		size: 'extra-large',
		fields: [
			{ fieldtype: 'HTML', fieldname: 'batch_table', options: table_html }
		],
		primary_action_label: 'Save Items',
		primary_action: function () {
			let $wrapper = d.fields_dict.batch_table.$wrapper;

			// A row without both a width and a height is a leftover (an extra
			// multi-select pick or an unused duplicate), so drop it instead of
			// pricing a zero-size piece. On a re-edit the original_ids check
			// below also removes it from the quotation.
			let skipped = 0;
			items = items.filter(function (it) {
				let $row = $wrapper.find(`tr[data-id="${it.id}"]`);
				let has_size = flt($row.find('[data-field="width_mm"]').val()) > 0
					&& flt($row.find('[data-field="height_mm"]').val()) > 0;
				if (!has_size) {
					$row.remove();
					skipped++;
				}
				return has_size;
			});
			if (skipped) {
				frappe.show_alert({
					message: __('{0} glass row(s) without width/height were removed', [skipped]),
					indicator: 'orange'
				});
			}

			let calls = items.map(function (it) {
				let $row = $wrapper.find(`tr[data-id="${it.id}"]`);
				function val(field) {
					return $row.find(`[data-field="${field}"]`).val();
				}

				let final_item = Object.assign({}, it, {
					sale_mode: 'Resized',
					dimension_uom: dimension_uom,
					width_mm: dimension_input_to_mm(val('width_mm'), dimension_uom),
					height_mm: dimension_input_to_mm(val('height_mm'), dimension_uom),
					width_allowance: flt(val('width_allowance') || 0),
					height_allowance: flt(val('height_allowance') || 0),
					polish_width_sides: cint(val('polish_width_sides') || 0),
					polish_height_sides: cint(val('polish_height_sides') || 0),
					polish_type: val('polish_type') || QB_DEFAULT_POLISH_TYPE,
					holes: cint(val('holes') || 0),
					hole_type: val('hole_type') || QB_DEFAULT_HOLE_TYPE,
					notches: cint(val('notches') || 0),
					notch_type: val('notch_type') || QB_DEFAULT_NOTCH_TYPE,
					sandblast_type: val('sandblast_type') || 'None',
					qty: flt(val('qty') || 1) || 1,
					numbering: val('numbering') || '',
					description: val('description') || ''
				});
				final_item.polishing = (final_item.polish_width_sides > 0 || final_item.polish_height_sides > 0) ? 1 : 0;

				return new Promise(function (resolve) {
					frappe.call({
						method: 'crystal_alluminium_works.api.calculate_glass_total',
						args: {
							item_code: final_item.item_code,
							price_list: final_item.price_list,
							qty: final_item.qty,
							sale_mode: final_item.sale_mode,
							width_mm: final_item.width_mm,
							height_mm: final_item.height_mm,
							width_allowance: final_item.width_allowance,
							height_allowance: final_item.height_allowance,
							polishing: final_item.polishing,
							polish_width_sides: final_item.polish_width_sides,
							polish_height_sides: final_item.polish_height_sides,
							holes: final_item.holes,
							notches: final_item.notches,
							sandblast_type: final_item.sandblast_type,
							polish_type: final_item.polish_type,
							hole_type: final_item.hole_type,
							notch_type: final_item.notch_type
						},
						callback: function (r) {
							if (r.message) {
								final_item.base_width_ft = r.message.base_width_ft ?? 0;
								final_item.base_height_ft = r.message.base_height_ft ?? 0;
								final_item.width_ft = r.message.width_ft ?? 0;
								final_item.height_ft = r.message.height_ft ?? 0;
								final_item.area_sqft = r.message.area_sqft ?? 0;
								final_item.perimeter_rft = r.message.perimeter_rft ?? 0;
								final_item.rate = inclusive_rate_from_server(r.message.base_rate, 0);
								final_item.amount = r.message.total ?? 0;
								final_item.glass_breakdown = r.message.breakdown || [];
							} else {
								final_item.amount = calculate_item_amount(final_item);
								final_item.glass_breakdown = [];
							}
							resolve(final_item);
						}
					});
				});
			});

			frappe.dom.freeze('Calculating...');
			Promise.all(calls).then(function (finished_items) {
				frappe.dom.unfreeze();
				// Reopening this dialog via "Edit Glass Details" hands back items
				// that already exist in qb_state.items — update those in place by
				// id instead of pushing duplicates. Anything new (first pass from
				// the item picker) still gets appended as before.
				finished_items.forEach(function (final_item) {
					let existing_index = window.qb_state.items.findIndex(function (it) { return it.id === final_item.id; });
					if (existing_index === -1) {
						window.qb_state.items.push(final_item);
					} else {
						window.qb_state.items[existing_index] = final_item;
					}
				});
				// Rows removed from the grid during a re-edit (originally in
				// qb_state.items, no longer in finished_items) should disappear
				// from the quotation too, not just from this dialog.
				let kept_ids = finished_items.map(function (it) { return it.id; });
				let dropped_ids = original_ids.filter(function (id) { return kept_ids.indexOf(id) === -1; });
				if (dropped_ids.length) {
					window.qb_state.items = window.qb_state.items.filter(function (it) { return dropped_ids.indexOf(it.id) === -1; });
				}
				close_builder_dialog(d);
				render_items_table(page);
			});
		}
	});

	d.show();
	bind_batch_table_keynav(d);

	// Pieces and UOM Qty (square feet) totals in the footer, like the Add Items table's Total row.
	// Square feet come from the server (api.get_glass_batch_uom_qty) because sizes are rounded the
	// way glass is priced; summed as each row would show them (2 decimals) and the sum rounded.
	let $batch_total = $('<div class="qb-batch-uom-total" style="margin-right:auto;font-weight:600;"></div>');
	d.$wrapper.find('.modal-footer').prepend($batch_total);
	let batch_total_seq = 0;
	let batch_total_timer = null;
	function refresh_batch_totals() {
		clearTimeout(batch_total_timer);
		batch_total_timer = setTimeout(function () {
			let rows = [];
			let pieces = 0;
			d.fields_dict.batch_table.$wrapper.find('tbody tr').each(function () {
				let $row = $(this);
				let it = items.find(function (x) { return x.id === $row.data('id'); });
				if (!it) return;
				let val = function (field) { return $row.find(`[data-field="${field}"]`).val(); };
				let row = {
					item_code: it.item_code,
					width_mm: dimension_input_to_mm(val('width_mm'), dimension_uom),
					height_mm: dimension_input_to_mm(val('height_mm'), dimension_uom),
					width_allowance: flt(val('width_allowance') || 0),
					height_allowance: flt(val('height_allowance') || 0),
					qty: flt(val('qty') || 1) || 1
				};
				if (flt(row.width_mm) > 0 && flt(row.height_mm) > 0) {
					pieces += row.qty;  // rows without a size are dropped on Save, so not counted
				}
				rows.push(row);
			});
			let seq = ++batch_total_seq;
			frappe.xcall('crystal_alluminium_works.api.get_glass_batch_uom_qty', { rows: JSON.stringify(rows) })
				.then(function (sqft) {
					if (seq !== batch_total_seq) return;
					let total = (sqft || []).reduce(function (sum, v) { return sum + format_review_number(v, 2); }, 0);
					$batch_total.text(`Total — Pieces: ${flt(pieces, 2)} · UOM Qty: ${flt(total, 2)} Square Foot`);
				})
				.catch(function () {
					if (seq === batch_total_seq) $batch_total.text('');
				});
		}, 400);
	}
	d.fields_dict.batch_table.$wrapper.on('input change', '.qb-batch-input', refresh_batch_totals);
	refresh_batch_totals();

	// Clone the whole row exactly as it currently stands (including anything
	// the user has already typed — size, numbering, polish/holes/notches/qty)
	// right below it, and push it into `items` so Save picks it up like any
	// other row. Tweak whatever differs on the copy afterwards.
	//
	// The row's "copies" input lets the user type how many duplicates they
	// need instead of clicking ⧉ repeatedly — Enter in that field (or a
	// click on ⧉) clones the row that many times in one go.
	let $batch_wrapper = d.fields_dict.batch_table.$wrapper;

	// Hole/notch/polish types are usually the same for the whole batch, so
	// picking one cascades down the column the same way the Aluminium colour
	// does: the changed row overwrites every row below it, rows above stay put.
	$batch_wrapper.on('change', 'select[data-field="hole_type"], select[data-field="notch_type"], select[data-field="polish_type"]', function () {
		let field = $(this).data('field');
		$(this).closest('tr').nextAll('tr').find(`select[data-field="${field}"]`).val($(this).val());
	});

	function duplicate_glass_row($row, count) {
		let source_id = $row.data('id');
		let source = items.find(function (it) { return it.id === source_id; });
		if (!source) {
			return null;
		}

		function val(field) {
			return $row.find(`[data-field="${field}"]`).val();
		}

		let $insert_after = $row;
		let $first_clone_row = null;
		for (let i = 0; i < count; i++) {
			let clone = Object.assign({}, source, {
				id: frappe.utils.get_random(8),
				width_mm: dimension_input_to_mm(val('width_mm'), dimension_uom),
				height_mm: dimension_input_to_mm(val('height_mm'), dimension_uom),
				width_allowance: flt(val('width_allowance') || 0),
				height_allowance: flt(val('height_allowance') || 0),
				polish_width_sides: cint(val('polish_width_sides') || 0),
				polish_height_sides: cint(val('polish_height_sides') || 0),
				polish_type: val('polish_type') || QB_DEFAULT_POLISH_TYPE,
				holes: cint(val('holes') || 0),
				hole_type: val('hole_type') || QB_DEFAULT_HOLE_TYPE,
				notches: cint(val('notches') || 0),
				notch_type: val('notch_type') || QB_DEFAULT_NOTCH_TYPE,
				sandblast_type: val('sandblast_type') || 'None',
				qty: flt(val('qty') || 1) || 1,
				numbering: val('numbering') || '',
				description: val('description') || ''
			});
			items.push(clone);

			$insert_after.after(build_row_html(clone, 0));
			$insert_after = $batch_wrapper.find(`tr[data-id="${clone.id}"]`);
			// Copy the size text verbatim — an inches→mm→inches round trip can
			// leave float noise like 12.000000000000002 in the cell.
			$insert_after.find('[data-field="width_mm"]').val(val('width_mm'));
			$insert_after.find('[data-field="height_mm"]').val(val('height_mm'));
			if (!$first_clone_row) {
				$first_clone_row = $insert_after;
			}
		}

		$batch_wrapper.find('tbody tr').each(function (idx) {
			$(this).find('.qb-batch-row-no').text(idx + 1);
		});
		return $first_clone_row;
	}

	function handle_duplicate_trigger($row, $count_input) {
		let count = Math.max(1, cint($count_input.val()) || 1);
		let $first_clone_row = duplicate_glass_row($row, count);
		if ($first_clone_row) {
			$first_clone_row.find('[data-field="width_mm"]').trigger('focus');
		}
		refresh_batch_totals();
	}

	$batch_wrapper.on('click', '.qb-duplicate-row', function () {
		let $row = $(this).closest('tr');
		handle_duplicate_trigger($row, $row.find('.qb-duplicate-count'));
	});

	$batch_wrapper.on('keydown', '.qb-duplicate-count', function (e) {
		if (e.key !== 'Enter') {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		handle_duplicate_trigger($(this).closest('tr'), $(this));
	});

	// Drop a row the user added by mistake — remove it from `items` so Save
	// doesn't pick it up, and remove the <tr> so the numbering can be redone.
	$batch_wrapper.on('click', '.qb-remove-row', function () {
		let $row = $(this).closest('tr');
		let source_id = $row.data('id');
		items = items.filter(function (it) { return it.id !== source_id; });

		$row.remove();
		$batch_wrapper.find('tbody tr').each(function (idx) {
			$(this).find('.qb-batch-row-no').text(idx + 1);
		});
		refresh_batch_totals();
	});
}

// Same idea as open_glass_batch_details_dialog, sized to what Aluminium
// actually needs: Rate/Piece is derived from Rate/Kg × Weight/Length (with
// the same Item Price fallback the single-item dialog uses when those are
// left blank), computed once on Save rather than live per keystroke.
function open_aluminium_batch_details_dialog(page, items) {
	if (!items || !items.length) {
		return;
	}

	// Snapshot which of these ids were already in qb_state.items (i.e. this is
	// a re-edit via "Edit Aluminium Details", not a fresh add) — used on Save
	// to drop any row the user removed from the grid instead of leaving it
	// stranded in qb_state.items.
	let original_ids = items.filter(function (it) {
		return window.qb_state.items.some(function (existing) { return existing.id === it.id; });
	}).map(function (it) { return it.id; });

	ensure_aluminium_colors(function () {
		let color_options = get_aluminium_color_options();
		// Unique per dialog — a hidden previous dialog can still be in the DOM with its own datalist.
		let color_list_id = 'qb-aluminium-color-options-' + Date.now();

		// Shared by the initial render and by "duplicate row" below, so a clone
		// picks up the exact same markup/behaviour as an item that came in
		// through the multi-select.
		function build_row_html(it, row_number) {
			return `
				<tr data-id="${it.id}">
					<td style="text-align:center;white-space:nowrap;" class="qb-batch-row-no">${row_number}</td>
					<td style="white-space:nowrap;">${frappe.utils.escape_html(it.item_name || it.item_code)}</td>
					<td><input type="text" class="form-control input-sm qb-batch-input qb-aluminium-color-input" data-field="aluminium_color" list="${color_list_id}" placeholder="Search color..." value="${frappe.utils.escape_html(it.aluminium_color || 'None')}" style="width:130px;"></td>
					<td><input type="number" min="1" step="1" class="form-control input-sm qb-batch-input" data-field="qty" value="${flt(it.qty || 1) || 1}" style="width:60px;"></td>
					<input type="hidden" data-field="aluminium_rate_per_kg" value="${flt(it.aluminium_rate_per_kg || 0)}">
					<input type="hidden" data-field="aluminium_weight_per_length" value="${flt(it.aluminium_weight_per_length || 0)}">
					<td><input type="number" min="0" step="any" class="form-control input-sm qb-batch-input" data-field="aluminium_powder_coating_charge" value="${flt(it.aluminium_powder_coating_charge || 0)}" style="width:90px;"></td>
					<td><input type="text" class="form-control input-sm qb-batch-input" data-field="description" value="${frappe.utils.escape_html(it.description || '')}" style="width:150px;"></td>
					<td style="text-align:center;white-space:nowrap;">
						<input type="number" min="1" step="1" value="1" class="form-control input-sm qb-duplicate-count" title="Number of copies — press Enter here to clone" style="width:46px;display:inline-block;vertical-align:middle;margin-right:2px;">
						<button type="button" class="btn btn-xs btn-default qb-duplicate-row" title="Duplicate row — clones the count field's number of copies">⧉</button>
						<button type="button" class="btn btn-xs btn-danger qb-remove-row" title="Remove row">✕</button>
					</td>
				</tr>
			`;
		}

		let rows_html = items.map(function (it, index) {
			return build_row_html(it, index + 1);
		}).join('');

		let table_html = `
			${get_aluminium_color_datalist_html(color_list_id, color_options)}
			<div class="table-responsive" style="max-height:55vh;overflow:auto;">
				<table class="table table-bordered" style="background:var(--card-bg); margin-bottom:0;">
					<thead style="background:var(--control-bg);position:sticky;top:0;z-index:1;">
						<tr>
							<th style="text-align:center;white-space:nowrap;">No</th>
							<th style="white-space:nowrap;">Item</th>
							<th style="white-space:nowrap;">Color</th>
							<th style="white-space:nowrap;">Pcs</th>
							<th style="white-space:nowrap;">Powder Coating</th>
							<th style="white-space:nowrap;">Description</th>
							<th style="white-space:nowrap;"></th>
						</tr>
					</thead>
					<tbody>${rows_html}</tbody>
				</table>
			</div>
		`;

		let d = new frappe.ui.Dialog({
			title: 'Aluminium Items — Fill Details',
			size: 'extra-large',
			fields: [
				{ fieldtype: 'HTML', fieldname: 'batch_table', options: table_html }
			],
			primary_action_label: 'Save Items',
			primary_action: function () {
				let $wrapper = d.fields_dict.batch_table.$wrapper;

				let calls = items.map(function (it) {
					let $row = $wrapper.find(`tr[data-id="${it.id}"]`);
					function val(field) {
						return $row.find(`[data-field="${field}"]`).val();
					}

					let final_item = Object.assign({}, it, {
						metres: 1,
						aluminium_color: normalize_aluminium_color_selection(resolve_aluminium_color_option(val('aluminium_color'), color_options)),
						qty: flt(val('qty') || 1) || 1,
						aluminium_rate_per_kg: flt(val('aluminium_rate_per_kg') || 0),
						aluminium_weight_per_length: flt(val('aluminium_weight_per_length') || 0),
						aluminium_powder_coating_charge: flt(val('aluminium_powder_coating_charge') || 0),
						description: val('description') || ''
					});

					let normal_price = get_aluminium_normal_price(final_item.aluminium_rate_per_kg, final_item.aluminium_weight_per_length);
					if (normal_price > 0) {
						final_item.rate = get_aluminium_rate_for_selling_price(normal_price, final_item.price_list) + final_item.aluminium_powder_coating_charge;
						final_item.amount = calculate_item_amount(final_item);
						return Promise.resolve(final_item);
					}

					return fetch_item_selling_rate(final_item.item_code, get_aluminium_backend_price_list(final_item.price_list)).then(function (rate) {
						final_item.rate = flt(rate) + final_item.aluminium_powder_coating_charge;
						final_item.amount = calculate_item_amount(final_item);
						return final_item;
					});
				});

				frappe.dom.freeze('Calculating...');
				Promise.all(calls).then(function (finished_items) {
					frappe.dom.unfreeze();
					// Reopening this dialog via "Edit Aluminium Details" hands back
					// items that already exist in qb_state.items — update those in
					// place by id instead of pushing duplicates. Anything new (first
					// pass from the item picker) still gets appended as before.
					finished_items.forEach(function (final_item) {
						let existing_index = window.qb_state.items.findIndex(function (it) { return it.id === final_item.id; });
						if (existing_index === -1) {
							window.qb_state.items.push(final_item);
						} else {
							window.qb_state.items[existing_index] = final_item;
						}
					});
					// Rows removed from the grid during a re-edit (originally in
					// qb_state.items, no longer in finished_items) should disappear
					// from the quotation too, not just from this dialog.
					let kept_ids = finished_items.map(function (it) { return it.id; });
					let dropped_ids = original_ids.filter(function (id) { return kept_ids.indexOf(id) === -1; });
					if (dropped_ids.length) {
						window.qb_state.items = window.qb_state.items.filter(function (it) { return dropped_ids.indexOf(it.id) === -1; });
					}
					close_builder_dialog(d);
					render_items_table(page);
				});
			}
		});

		d.show();
		bind_batch_table_keynav(d);

		// Clearing "None" on focus is what makes the search usable: the browser filters the
		// datalist by whatever is already in the box, so an untouched cell would otherwise
		// only ever offer "None". On the way out the typed text is snapped to a real colour.
		let $color_cells = d.fields_dict.batch_table.$wrapper;
		$color_cells.on('focus', '.qb-aluminium-color-input', function () {
			let current = resolve_aluminium_color_option($(this).val(), color_options);
			$(this).data('qb-prev-color', current);
			if (current === 'None') {
				$(this).val('');
			}
		});
		$color_cells.on('blur', '.qb-aluminium-color-input', function () {
			let resolved = resolve_aluminium_color_option($(this).val(), color_options);
			$(this).val(resolved);

			// Most batches are all one colour, so a colour change cascades down the
			// column: whichever row is changed overwrites every row below it (rows
			// above are untouched). Changing row 1 therefore recolours the whole table.
			let prev = $(this).data('qb-prev-color') || 'None';
			if (resolved === 'None' || resolved === prev) {
				return;
			}
			$(this).closest('tr').nextAll('tr').find('.qb-aluminium-color-input').val(resolved);
		});

		// Same aluminium item, different color/coating — clone whatever is
		// currently in the row (including anything the user has already typed)
		// right below it, blank out the color so it stands out for reselection,
		// and push it into `items` so Save picks it up like any other row.
		//
		// The row's "copies" input lets the user type how many duplicates they
		// need instead of clicking ⧉ repeatedly — Enter in that field (or a
		// click on ⧉) clones the row that many times in one go.
		function duplicate_aluminium_row($row, count) {
			let $wrapper = d.fields_dict.batch_table.$wrapper;
			let source_id = $row.data('id');
			let source = items.find(function (it) { return it.id === source_id; });
			if (!source) {
				return null;
			}

			function val(field) {
				return $row.find(`[data-field="${field}"]`).val();
			}

			let $insert_after = $row;
			let $first_clone_row = null;
			for (let i = 0; i < count; i++) {
				let clone = Object.assign({}, source, {
					id: frappe.utils.get_random(8),
					aluminium_color: '',
					qty: flt(val('qty') || 1) || 1,
					aluminium_rate_per_kg: flt(val('aluminium_rate_per_kg') || 0),
					aluminium_weight_per_length: flt(val('aluminium_weight_per_length') || 0),
					aluminium_powder_coating_charge: flt(val('aluminium_powder_coating_charge') || 0),
					description: val('description') || ''
				});
				items.push(clone);

				$insert_after.after(build_row_html(clone, 0));
				$insert_after = $wrapper.find(`tr[data-id="${clone.id}"]`);
				// build_row_html falls back to "None" for a blank color — clear it
				// back out here so the new row visibly needs a color pick.
				$insert_after.find('.qb-aluminium-color-input').val('');
				if (!$first_clone_row) {
					$first_clone_row = $insert_after;
				}
			}

			$wrapper.find('tbody tr').each(function (idx) {
				$(this).find('.qb-batch-row-no').text(idx + 1);
			});
			return $first_clone_row;
		}

		function handle_aluminium_duplicate_trigger($row, $count_input) {
			let count = Math.max(1, cint($count_input.val()) || 1);
			let $first_clone_row = duplicate_aluminium_row($row, count);
			if ($first_clone_row) {
				$first_clone_row.find('.qb-aluminium-color-input').trigger('focus');
			}
		}

		$color_cells.on('click', '.qb-duplicate-row', function () {
			let $row = $(this).closest('tr');
			handle_aluminium_duplicate_trigger($row, $row.find('.qb-duplicate-count'));
		});

		$color_cells.on('keydown', '.qb-duplicate-count', function (e) {
			if (e.key !== 'Enter') {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			handle_aluminium_duplicate_trigger($(this).closest('tr'), $(this));
		});

		// Drop a row the user added by mistake — remove it from `items` so Save
		// doesn't pick it up, and remove the <tr> so the numbering can be redone.
		$color_cells.on('click', '.qb-remove-row', function () {
			let $wrapper = d.fields_dict.batch_table.$wrapper;
			let $row = $(this).closest('tr');
			let source_id = $row.data('id');
			items = items.filter(function (it) { return it.id !== source_id; });

			$row.remove();
			$wrapper.find('tbody tr').each(function (idx) {
				$(this).find('.qb-batch-row-no').text(idx + 1);
			});
		});
	});
}

// Categories whose rate is just the chosen Selling Price's Item Price (no
// per-piece formula of their own) — they share one simple Fill Details grid.
const QB_SIMPLE_BATCH_CATEGORIES = ['Fittings', 'Rubber', 'Silicone'];

// Fittings/Rubber/Silicone have no per-piece formula — Rate is whatever the
// chosen Selling Price's Item Price resolves to, so Save only fetches it for
// rows that don't have one yet (keeping any rate already set via ✏️) and
// multiplies by Qty. Same add/re-edit/duplicate/remove flow as Aluminium.
function open_simple_batch_details_dialog(page, category, items) {
	if (!items || !items.length) {
		return;
	}

	// Ids already in qb_state.items (a re-edit via "Edit ... Details") — used on
	// Save to drop rows the user removed from the grid.
	let original_ids = items.filter(function (it) {
		return window.qb_state.items.some(function (existing) { return existing.id === it.id; });
	}).map(function (it) { return it.id; });

	let qty_step = category === 'Fittings' ? '1' : 'any';

	function build_row_html(it, row_number) {
		return `
			<tr data-id="${it.id}">
				<td style="text-align:center;white-space:nowrap;" class="qb-batch-row-no">${row_number}</td>
				<td style="white-space:nowrap;">${frappe.utils.escape_html(it.item_name || it.item_code)}</td>
				<td><input type="number" min="0" step="${qty_step}" class="form-control input-sm qb-batch-input" data-field="qty" value="${flt(it.qty || 1) || 1}" style="width:80px;"></td>
				<td style="white-space:nowrap;">${frappe.utils.escape_html(get_item_uom_label(it) || '-')}</td>
				<td><input type="text" class="form-control input-sm qb-batch-input" data-field="description" value="${frappe.utils.escape_html(it.description || '')}" style="width:200px;"></td>
				<td style="text-align:center;white-space:nowrap;">
					<input type="number" min="1" step="1" value="1" class="form-control input-sm qb-duplicate-count" title="Number of copies — press Enter here to clone" style="width:46px;display:inline-block;vertical-align:middle;margin-right:2px;">
					<button type="button" class="btn btn-xs btn-default qb-duplicate-row" title="Duplicate row — clones the count field's number of copies">⧉</button>
					<button type="button" class="btn btn-xs btn-danger qb-remove-row" title="Remove row">✕</button>
				</td>
			</tr>
		`;
	}

	let rows_html = items.map(function (it, index) {
		return build_row_html(it, index + 1);
	}).join('');

	let table_html = `
		<div class="table-responsive" style="max-height:55vh;overflow:auto;">
			<table class="table table-bordered" style="background:var(--card-bg); margin-bottom:0;">
				<thead style="background:var(--control-bg);position:sticky;top:0;z-index:1;">
					<tr>
						<th style="text-align:center;white-space:nowrap;">No</th>
						<th style="white-space:nowrap;">Item</th>
						<th style="white-space:nowrap;">Qty</th>
						<th style="white-space:nowrap;">UOM</th>
						<th style="white-space:nowrap;">Description</th>
						<th style="white-space:nowrap;"></th>
					</tr>
				</thead>
				<tbody>${rows_html}</tbody>
			</table>
		</div>
	`;

	let d = new frappe.ui.Dialog({
		title: `${category} Items — Fill Details`,
		size: 'large',
		fields: [
			{ fieldtype: 'HTML', fieldname: 'batch_table', options: table_html }
		],
		primary_action_label: 'Save Items',
		primary_action: function () {
			let $wrapper = d.fields_dict.batch_table.$wrapper;

			let calls = items.map(function (it) {
				let $row = $wrapper.find(`tr[data-id="${it.id}"]`);
				function val(field) {
					return $row.find(`[data-field="${field}"]`).val();
				}

				let final_item = Object.assign({}, it, {
					qty: flt(val('qty') || 1) || 1,
					description: val('description') || ''
				});

				if (flt(final_item.rate) > 0) {
					final_item.amount = calculate_item_amount(final_item);
					return Promise.resolve(final_item);
				}

				return fetch_item_selling_rate(final_item.item_code, final_item.price_list).then(function (rate) {
					final_item.rate = rate;
					final_item.amount = calculate_item_amount(final_item);
					return final_item;
				});
			});

			frappe.dom.freeze('Calculating...');
			Promise.all(calls).then(function (finished_items) {
				frappe.dom.unfreeze();
				finished_items.forEach(function (final_item) {
					let existing_index = window.qb_state.items.findIndex(function (it) { return it.id === final_item.id; });
					if (existing_index === -1) {
						window.qb_state.items.push(final_item);
					} else {
						window.qb_state.items[existing_index] = final_item;
					}
				});
				let kept_ids = finished_items.map(function (it) { return it.id; });
				let dropped_ids = original_ids.filter(function (id) { return kept_ids.indexOf(id) === -1; });
				if (dropped_ids.length) {
					window.qb_state.items = window.qb_state.items.filter(function (it) { return dropped_ids.indexOf(it.id) === -1; });
				}
				close_builder_dialog(d);
				render_items_table(page);
			});
		}
	});

	d.show();
	bind_batch_table_keynav(d);

	let $wrapper = d.fields_dict.batch_table.$wrapper;

	function renumber_rows() {
		$wrapper.find('tbody tr').each(function (idx) {
			$(this).find('.qb-batch-row-no').text(idx + 1);
		});
	}

	// Clone the row (with whatever has been typed into it) `count` times right
	// below itself, and push the clones into `items` so Save picks them up.
	function duplicate_row($row, count) {
		let source = items.find(function (it) { return it.id === $row.data('id'); });
		if (!source) {
			return null;
		}

		let $insert_after = $row;
		let $first_clone_row = null;
		for (let i = 0; i < count; i++) {
			let clone = Object.assign({}, source, {
				id: frappe.utils.get_random(8),
				qty: flt($row.find('[data-field="qty"]').val() || 1) || 1,
				description: $row.find('[data-field="description"]').val() || ''
			});
			items.push(clone);

			$insert_after.after(build_row_html(clone, 0));
			$insert_after = $wrapper.find(`tr[data-id="${clone.id}"]`);
			if (!$first_clone_row) {
				$first_clone_row = $insert_after;
			}
		}

		renumber_rows();
		return $first_clone_row;
	}

	function handle_duplicate_trigger($row, $count_input) {
		let count = Math.max(1, cint($count_input.val()) || 1);
		let $first_clone_row = duplicate_row($row, count);
		if ($first_clone_row) {
			$first_clone_row.find('[data-field="qty"]').trigger('focus');
		}
	}

	$wrapper.on('click', '.qb-duplicate-row', function () {
		let $row = $(this).closest('tr');
		handle_duplicate_trigger($row, $row.find('.qb-duplicate-count'));
	});

	$wrapper.on('keydown', '.qb-duplicate-count', function (e) {
		if (e.key !== 'Enter') {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		handle_duplicate_trigger($(this).closest('tr'), $(this));
	});

	$wrapper.on('click', '.qb-remove-row', function () {
		let $row = $(this).closest('tr');
		let source_id = $row.data('id');
		items = items.filter(function (it) { return it.id !== source_id; });
		$row.remove();
		renumber_rows();
	});
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
							Expected columns: <b>numbering</b>, <b>width</b>, <b>height</b>, <b>pcs</b>, <b>w+</b>, <b>h+</b>, <b>holes</b>, <b>notches</b>, <b>sandblast</b>, <b>polish_width_side</b>, <b>polish_height_side</b>, <b>details</b>.
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
// What Generate Quotation sends — also sent to preview_quotation_from_builder, so the
// Review totals are the ones the saved quotation will have.
function get_quotation_api_args(state) {
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
		api_args.customer_name = state.customer_name;
		api_args.customer_pin = state.customer_pin;
	}

	// If editing an existing quotation, pass its name so the API updates it
	if (state.editing_quotation) {
		api_args.quotation_name = state.editing_quotation;
	}

	return api_args;
}

// The Review tab's own sums miss what the server adds on save (glass polishing/holes/notches/
// sandblasting rows, ceiling components, its area rounding). Price the quotation exactly as
// Generate would, without saving, and total it the way the Quotation Manager does
// (get_manager_quotation_subtotal/_tax/_total) so the two always agree.
let qb_review_preview_seq = 0;
function refresh_review_totals_from_server($summary) {
	let state = window.qb_state;
	if (!state.customer || !(state.items || []).length) {
		return;
	}

	let seq = ++qb_review_preview_seq;
	let $totals = $summary.find('.qb-review-subtotal, .qb-review-vat, .qb-review-grand, .qb-review-unadj-subtotal, .qb-review-unadj-vat, .qb-review-unadj-grand, .qb-review-adj-difference');
	$totals.css('opacity', 0.4);

	frappe.call({
		method: 'crystal_alluminium_works.api.preview_quotation_from_builder',
		args: get_quotation_api_args(state),
		callback: function (r) {
			if (seq !== qb_review_preview_seq) return;  // a newer render superseded this one
			let preview = r.message;
			if (!preview || preview.error) return;      // keep the Builder's own sums

			let has_real_tax = flt(preview.total_taxes_and_charges) > 0;
			let subtotal = has_real_tax
				? flt(preview.grand_total) - flt(preview.total_taxes_and_charges)
				: flt(preview.grand_total);
			let vat = has_real_tax ? flt(preview.total_taxes_and_charges) : subtotal * QB_VAT_RATE;
			let grand = has_real_tax ? flt(preview.grand_total) : subtotal + vat;

			$summary.find('.qb-review-subtotal').text(format_currency(subtotal, 'KES'));
			$summary.find('.qb-review-vat').text(format_currency(vat, 'KES'));
			$summary.find('.qb-review-grand').text(format_currency(grand, 'KES'));

			// Before-adjustment figures: Builder-priced rows reversed, service rows as-is.
			let adjustment = state.price_adjustment;
			if (adjustment && adjustment.percent) {
				let multiplier = adjustment.type === '-' ? (1 - adjustment.percent / 100) : (1 + adjustment.percent / 100);
				let manual = flt(preview.manual_amount);
				let unadj_subtotal = multiplier ? subtotal - manual + manual / multiplier : subtotal;
				let unadj_vat = has_real_tax && subtotal ? vat * unadj_subtotal / subtotal : unadj_subtotal * QB_VAT_RATE;
				let unadj_grand = unadj_subtotal + unadj_vat;
				let difference = grand - unadj_grand;
				$summary.find('.qb-review-unadj-subtotal').text(format_currency(unadj_subtotal, 'KES'));
				$summary.find('.qb-review-unadj-vat').text(format_currency(unadj_vat, 'KES'));
				$summary.find('.qb-review-unadj-grand').text(format_currency(unadj_grand, 'KES'));
				$summary.find('.qb-review-adj-difference').text(`${difference < 0 ? '−' : '+'}${format_currency(Math.abs(difference), 'KES')}`);
			}
		},
		always: function () {
			if (seq === qb_review_preview_seq) $totals.css('opacity', 1);
		}
	});
}

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

	let api_args = get_quotation_api_args(state);
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
					<button class="qb-add-btn" data-category="Glass" data-glass-type="Ordinary">+ Ordinary Glass</button>
					<button class="qb-add-btn" data-category="Glass" data-glass-type="Laminated">+ Laminated Glass</button>
					<button class="qb-add-btn" data-category="Glass" data-glass-type="Ready Laminated">+ Ready Laminated Glass</button>
					<button class="qb-add-btn" data-category="Glass" data-glass-type="Toughened">+ Toughened Glass</button>
					<button class="qb-nav-btn primary qb-edit-glass-details-btn" style="display:none;" title="Reopen the Fill Details grid for the resized Glass items already added">✎ Edit Glass Details</button>
					<button class="qb-add-btn" data-category="Aluminium">+ Aluminium</button>
					<button class="qb-nav-btn primary qb-edit-aluminium-details-btn" style="display:none;" title="Reopen the Fill Details grid for the Aluminium items already added">✎ Edit Aluminium Details</button>
					<button class="qb-add-btn" data-category="Fittings">+ Fittings</button>
					<button class="qb-nav-btn primary qb-edit-simple-details-btn" data-category="Fittings" style="display:none;" title="Reopen the Fill Details grid for the Fittings items already added">✎ Edit Fittings Details</button>
					<button class="qb-add-btn" data-category="Ceiling">+ Ceiling</button>
					<button class="qb-add-btn" data-category="Rubber">+ Rubber</button>
					<button class="qb-nav-btn primary qb-edit-simple-details-btn" data-category="Rubber" style="display:none;" title="Reopen the Fill Details grid for the Rubber items already added">✎ Edit Rubber Details</button>
					<button class="qb-add-btn" data-category="Silicone">+ Silicone</button>
					<button class="qb-nav-btn primary qb-edit-simple-details-btn" data-category="Silicone" style="display:none;" title="Reopen the Fill Details grid for the Silicone items already added">✎ Edit Silicone Details</button>
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
						<div class="qb-price-adjust-popover" style="display:none;position:absolute;bottom:calc(100% + 10px);right:0;width:290px;background:var(--card-bg);border:1px solid var(--border-color);border-radius:10px;box-shadow:var(--shadow-lg, 0 4px 16px rgba(0,0,0,0.15));padding:16px;z-index:50;">
							<div style="font-weight:600;font-size:13px;margin-bottom:10px;">Adjust Inc.Rate for all items</div>
							<div class="qb-price-adjust-toggle" style="display:flex;gap:6px;margin-bottom:10px;">
								<button type="button" class="qb-price-adjust-sign" data-sign="-" style="flex:1;padding:8px;border-radius:6px;border:1px solid var(--border-color);background:var(--subtle-fg);font-weight:700;cursor:pointer;">− Discount</button>
								<button type="button" class="qb-price-adjust-sign" data-sign="+" style="flex:1;padding:8px;border-radius:6px;border:1px solid var(--border-color);background:var(--subtle-fg);font-weight:700;cursor:pointer;">+ Markup</button>
							</div>
							<div style="display:flex;align-items:center;gap:6px;margin-bottom:12px;">
								<input type="number" class="qb-price-adjust-input form-control" min="0" max="100" step="any" placeholder="0" style="flex:1;">
								<span style="font-weight:600;">%</span>
							</div>
							<!-- Or work back from the total the customer is to pay: the % above is derived from it
								 (and typing a % shows the total it gives). Only the type and % are saved. -->
							<div style="border-top:1px solid var(--border-color);padding-top:10px;margin-bottom:12px;">
								<div style="font-size:12px;font-weight:600;margin-bottom:6px;">Or sell at a total (inc. VAT)</div>
								<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-bottom:6px;">
									<span>Total before adjustment</span>
									<span class="qb-price-adjust-current">—</span>
								</div>
								<input type="number" class="qb-price-adjust-target form-control" min="0" step="any" placeholder="Target total, e.g. 34559">
								<div class="qb-price-adjust-target-note" style="font-size:11px;color:var(--text-muted);margin-top:6px;min-height:15px;"></div>
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
