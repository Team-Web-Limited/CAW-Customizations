/**
 * CAW Item Builder — a self-contained port of the Quotation Builder's category-specific
 * "add item" modal, so other desk pages (e.g. Sales Invoice Manager's edit-items flow) can
 * offer the exact same Glass / Aluminium / Ceiling / Fittings entry experience and pricing.
 *
 * Usage:
 *   CAWItemBuilder.open({
 *     category: 'Glass',            // Glass | Aluminium | Ceiling | Fittings | Rubber | Silicone
 *     onSave: function (item) {...} // receives the finalised builder item (rate/amount priced)
 *   });
 *
 * The `item` handed to onSave has the same shape the Quotation Builder produces, so callers can
 * map it to a quotation/invoice row exactly like `create_quotation_from_builder` does server-side.
 *
 * This intentionally duplicates the Quotation Builder's logic rather than importing it, because
 * that page's helpers live in its own page closure. Keep the two in sync when pricing rules change.
 */
(function () {
	'use strict';

	const ALUMINIUM_PRICE_FACTOR = 1.07;
	const ALUMINIUM_PRICE_OPTIONS = 'Normal Price\nMill Finished Price\nSpecial Price';
	const ALUMINIUM_PRICE_LABEL_TO_PRICE_LIST = {
		'Normal Price': 'Retail', 'Mill Finished Price': 'Wholesale', 'Special Price': 'Special',
		'Retail': 'Retail', 'Wholesale': 'Wholesale', 'Special': 'Special',
	};
	const ALUMINIUM_PRICE_LIST_TO_LABEL = {
		'Retail': 'Normal Price', 'Wholesale': 'Mill Finished Price', 'Special': 'Special Price',
	};
	const GLASS_DIMENSION_UOM_OPTIONS = 'inches\nmm';
	const DEFAULT_GLASS_DIMENSION_UOM = 'mm';
	const SHEET_GLASS_TYPES = new Set(['Ordinary', 'Ready Laminated']);
	const POLISH_TYPE_OPTIONS = '4-6\n8-10\n14-35';
	const DEFAULT_POLISH_TYPE = '4-6';
	const HOLE_TYPE_OPTIONS = '5mm\n6mm\n8mm\n10mm\n15mm\n20mm';
	const DEFAULT_HOLE_TYPE = '5mm';
	const NOTCH_TYPE_OPTIONS = 'Standard\nSmall\nMirror Screws\nTimber Box';
	const DEFAULT_NOTCH_TYPE = 'Standard';
	// Loaded from crystal_alluminium_works.api.get_ceiling_board_item_codes at module load —
	// see CEILING_BOARD_ITEM_CODES in pricing_engine.py for the single source of truth.
	// get_query below runs synchronously, so this is fetched eagerly rather than lazily,
	// seeded with the known codes as a fallback in case it's used before the fetch resolves.
	let CEILING_BOARD_ITEM_CODES = new Set(['AMC', 'AGC']);
	frappe.call({
		method: 'crystal_alluminium_works.api.get_ceiling_board_item_codes',
		callback: r => { CEILING_BOARD_ITEM_CODES = new Set(r.message || []); },
	});

	const CACHE = { aluminium_colors: null, sheet_configs: null };

	// ── small helpers (ported) ──────────────────────────────────────────
	function normalize_dimension_uom(uom) {
		return (uom || '').toLowerCase() === 'inches' ? 'inches' : 'mm';
	}
	function dimension_input_to_mm(value, uom) {
		let n = flt(value || 0);
		return normalize_dimension_uom(uom) === 'inches' ? n * 25.4 : n;
	}
	function mm_to_dimension_input(value, uom) {
		let n = flt(value || 0);
		return normalize_dimension_uom(uom) === 'inches' ? n / 25.4 : n;
	}
	function get_dimension_label(uom) {
		return normalize_dimension_uom(uom) === 'inches' ? 'inches' : 'mm';
	}
	function aluminium_price_label(price_list) {
		return ALUMINIUM_PRICE_LIST_TO_LABEL[price_list] || price_list || 'Normal Price';
	}
	function aluminium_backend_price_list(price_list) {
		return ALUMINIUM_PRICE_LABEL_TO_PRICE_LIST[price_list] || price_list || 'Retail';
	}
	function aluminium_normal_price(rate_per_kg, weight_per_length) {
		return flt(rate_per_kg || 0) * flt(weight_per_length || 0);
	}
	function aluminium_rate_for_selling_price(normal_price, selling_price) {
		let label = aluminium_price_label(selling_price);
		if (label === 'Mill Finished Price') return ALUMINIUM_PRICE_FACTOR ? normal_price / ALUMINIUM_PRICE_FACTOR : normal_price;
		if (label === 'Special Price') return normal_price * ALUMINIUM_PRICE_FACTOR;
		return normal_price;
	}
	function ceiling_mode_price_list(ceiling_mode) {
		return ceiling_mode === 'bundle' ? 'Wholesale' : 'Retail';
	}
	function is_sheet_glass_type(glass_type) {
		return SHEET_GLASS_TYPES.has(glass_type || '');
	}
	function normalize_aluminium_color_selection(value) {
		return value === 'None' ? '' : (value || '');
	}
	function get_aluminium_color_options() {
		let options = ['None'];
		(CACHE.aluminium_colors || []).forEach(c => {
			if (c && c.trim().toLowerCase() !== 'none') options.push(c);
		});
		return options.join('\n');
	}
	function ensure_aluminium_colors(cb) {
		if (CACHE.aluminium_colors) { cb(CACHE.aluminium_colors); return; }
		frappe.call({
			method: 'crystal_alluminium_works.api.get_aluminium_colors',
			callback: r => { CACHE.aluminium_colors = r.message || []; cb(CACHE.aluminium_colors); },
		});
	}
	function ensure_sheet_configs(cb) {
		if (CACHE.sheet_configs) { cb(CACHE.sheet_configs); return; }
		frappe.call({
			method: 'crystal_alluminium_works.api.get_glass_sheet_configs',
			callback: r => { CACHE.sheet_configs = r.message || []; cb(CACHE.sheet_configs); },
		});
	}
	function get_sheet_sft_from_size(item, size) {
		let match = (item.sheet_configs || []).find(row => row.size === size);
		return match ? flt(match.sft || 0) : 0;
	}
	function glass_form_perimeter_rft(width_ft, height_ft) {
		return Math.trunc(2 * (flt(width_ft || 0) + flt(height_ft || 0)) * 1000) / 1000;
	}
	function glass_form_area_sqft(width_ft, height_ft) {
		return flt(width_ft || 0) * flt(height_ft || 0);
	}
	function glass_base_width_ft(item) {
		let allowance = flt(item.width_allowance || 0);
		if (flt(item.base_width_ft || 0)) return flt(item.base_width_ft || 0);
		if (flt(item.width_ft || 0) && allowance) return flt(item.width_ft || 0) - allowance;
		return flt(item.width_ft || 0);
	}
	function glass_base_height_ft(item) {
		let allowance = flt(item.height_allowance || 0);
		if (flt(item.base_height_ft || 0)) return flt(item.base_height_ft || 0);
		if (flt(item.height_ft || 0) && allowance) return flt(item.height_ft || 0) - allowance;
		return flt(item.height_ft || 0);
	}
	function glass_adjusted_width_ft(item) {
		let width = flt(item.width_ft || 0);
		return width ? width : glass_base_width_ft(item) + flt(item.width_allowance || 0);
	}
	function glass_adjusted_height_ft(item) {
		let height = flt(item.height_ft || 0);
		return height ? height : glass_base_height_ft(item) + flt(item.height_allowance || 0);
	}
	function glass_polishing_rft(item) {
		let width_sides = cint(item.polish_width_sides || 0);
		let height_sides = cint(item.polish_height_sides || 0);
		if (!width_sides && !height_sides && cint(item.polishing || 0)) { width_sides = 2; height_sides = 2; }
		let value = flt(item.qty || 0) * (
			(width_sides * (flt(item.width_mm || 0) / 305)) + (height_sides * (flt(item.height_mm || 0) / 305))
		);
		return Math.trunc(value * 1000) / 1000;
	}
	function calculate_item_amount(item) {
		let qty = flt(item.qty || 0);
		let rate = flt(item.rate || 0) / 1.16;
		if (item.category === 'Aluminium') return qty * rate;
		if (item.category === 'Ceiling') {
			if (item.ceiling_mode === 'bundle') return flt(item.quantity || item.square_metres || 0) * rate;
			return qty * rate;
		}
		if (item.category === 'Glass') {
			if (item.sale_mode === 'Sheet' || item.sale_mode === 'Full Sheet') return qty * rate;
			let w = glass_adjusted_width_ft(item), h = glass_adjusted_height_ft(item);
			let area = (w && h) ? glass_form_area_sqft(w, h) : flt(item.area_sqft || 0);
			return qty * area * rate;
		}
		return qty * rate;
	}

	function seed_item(category, extra) {
		return Object.assign({
			id: 'caw-' + Math.random().toString(36).slice(2, 10),
			category: category,
			item_code: '', item_name: '', description: '',
			price_list: category === 'Aluminium' ? 'Normal Price' : 'Retail',
			qty: 1, rate: 0, amount: 0,
			dimension_uom: DEFAULT_GLASS_DIMENSION_UOM,
		}, extra || {});
	}

	// ── entry point: pre-step per category, then the item modal ─────────
	function open(opts) {
		const category = opts && opts.category;
		if (!category) { frappe.msgprint('Please select a product category first.'); return; }

		// Edit mode: a fully-formed item is supplied — skip the category pre-steps and open the
		// modal pre-filled. Sheet-glass needs its sheet configs loaded before the fields build.
		if (opts.item) {
			let it = opts.item;
			if (it.category === 'Glass' && (it.sale_mode === 'Sheet' || it.glass_mode === 'Sheet') && !(it.sheet_configs && it.sheet_configs.length)) {
				ensure_sheet_configs(function (cfgs) { it.sheet_configs = cfgs; open_modal(it, opts); });
			} else {
				open_modal(it, opts);
			}
			return;
		}

		if (category === 'Glass') {
			let glass_type = opts.glass_type || '';
			let sheet_ok = is_sheet_glass_type(glass_type);
			let fields = [
				{ fieldtype: 'Select', fieldname: 'dimension_uom', label: 'Dimension UOM', options: GLASS_DIMENSION_UOM_OPTIONS, default: DEFAULT_GLASS_DIMENSION_UOM, reqd: 1 },
			];
			// Sheet mode only exists for sheet-type glass (Ordinary / Ready Laminated).
			if (sheet_ok) {
				fields.push({ fieldtype: 'Select', fieldname: 'glass_mode', label: 'Glass Mode', options: 'Cut Size\nSheet', default: 'Cut Size', reqd: 1 });
			}
			let choice = new frappe.ui.Dialog({
				title: glass_type ? `Add ${glass_type} Glass` : 'Add Glass Item',
				fields: fields,
				primary_action_label: 'Continue',
				primary_action: function (v) {
					choice.hide();
					let uom = normalize_dimension_uom(v.dimension_uom);
					let base = { dimension_uom: uom, glass_type: glass_type, glass_type_filter: glass_type };
					if (sheet_ok && v.glass_mode === 'Sheet') {
						ensure_sheet_configs(function (cfgs) {
							open_modal(seed_item('Glass', Object.assign({ glass_mode: 'Sheet', sale_mode: 'Sheet', price_list: 'Wholesale', sheet_configs: cfgs }, base)), opts);
						});
					} else {
						open_modal(seed_item('Glass', Object.assign({ glass_mode: 'Cut Size', sale_mode: 'Resized' }, base)), opts);
					}
				},
			});
			choice.show();
			return;
		}

		if (category === 'Ceiling') {
			let choice = new frappe.ui.Dialog({
				title: 'Add Ceiling Item',
				fields: [
					{ fieldtype: 'Select', fieldname: 'ceiling_mode', label: 'Mode', options: 'Bundle\nSingle', default: 'Bundle', reqd: 1, description: 'Bundle prices a full ceiling by area (sqm); Single is a per-piece line.' },
				],
				primary_action_label: 'Continue',
				primary_action: function (v) {
					choice.hide();
					let mode = v.ceiling_mode === 'Single' ? 'single' : 'bundle';
					open_modal(seed_item('Ceiling', { ceiling_mode: mode, price_list: ceiling_mode_price_list(mode), quantity: mode === 'bundle' ? 100 : 0 }), opts);
				},
			});
			choice.show();
			return;
		}

		open_modal(seed_item(category, {}), opts);
	}

	// ── the category-specific item modal (ported from Quotation Builder) ─
	function open_modal(item, opts) {
		let is_glass = item.category === 'Glass';
		let is_ceiling = item.category === 'Ceiling';
		let is_ceiling_bundle = is_ceiling && item.ceiling_mode === 'bundle';
		let is_sheet_glass = is_glass && (item.glass_mode === 'Sheet' || item.sale_mode === 'Sheet');

		let fields = [
			{
				fieldtype: 'Link', options: 'Item', fieldname: 'item_code', label: 'Item', reqd: 1,
				get_query: function () {
					if (is_glass) {
						let filters = [
							['Item', 'item_group', '=', 'Glass'],
							['Item', 'item_name', 'not like', '%Polishing%'],
							['Item', 'item_name', 'not like', '%Drilling%'],
							['Item', 'item_name', 'not like', '%Sandblasting%'],
							['Item', 'item_name', 'not like', '%Hole%'],
							['Item', 'item_name', 'not like', '%Notch%'],
						];
						if (item.glass_type_filter) filters.push(['Item', 'custom_glass_type', '=', item.glass_type_filter]);
						return { filters: filters };
					}
					if (is_ceiling_bundle) {
						return { filters: [
							['Item', 'item_group', '=', 'Ceiling'],
							['Item', 'item_code', 'in', Array.from(CEILING_BOARD_ITEM_CODES)],
						] };
					}
					return { filters: { item_group: item.category } };
				},
				default: item.item_code,
				change: function () { queue_fetch_rate(true); },
			},
			{ fieldtype: 'HTML', fieldname: 'stock_balance_html', label: 'Stock Balance' },
			{ fieldtype: 'Column Break' },
			{
				fieldtype: 'Select',
				options: item.category === 'Aluminium' ? ALUMINIUM_PRICE_OPTIONS : 'Retail\nWholesale\nSpecial',
				fieldname: 'price_list', label: 'Selling Price', reqd: 1,
				read_only: is_sheet_glass || is_ceiling ? 1 : 0,
				default: item.category === 'Aluminium'
					? aluminium_price_label(item.price_list)
					: (is_ceiling ? ceiling_mode_price_list(item.ceiling_mode) : (is_sheet_glass ? 'Wholesale' : (item.price_list || 'Retail'))),
				change: function () { queue_fetch_rate(false); },
			},
			{ fieldtype: 'Section Break' },
			{
				fieldtype: (item.category === 'Aluminium' || is_ceiling || is_glass) ? 'Int' : 'Float',
				fieldname: is_sheet_glass ? 'pcs' : 'qty', label: 'Pcs',
				default: is_sheet_glass ? (item.pcs || 1) : (item.qty || 1),
				reqd: is_ceiling_bundle ? 0 : 1, read_only: is_ceiling_bundle ? 1 : 0, hidden: is_ceiling_bundle ? 1 : 0,
			},
			{ fieldtype: 'Column Break' },
			{
				fieldtype: 'Currency', fieldname: 'rate',
				label: item.category === 'Aluminium' ? 'Rate Per Piece' : (is_ceiling ? (is_ceiling_bundle ? 'Rate Per Sqm' : 'Rate Per Piece') : 'Rate'),
				default: item.rate || 0, read_only: item.category === 'Aluminium' || is_sheet_glass ? 1 : 0,
			},
		];

		if (is_sheet_glass) {
			let sheet_options = (item.sheet_configs || []).map(r => r.size).filter(Boolean).join('\n');
			fields.push(
				{ fieldtype: 'Section Break', label: 'Sheet Details' },
				{ fieldtype: 'Select', fieldname: 'sheet_size', label: 'Size', options: sheet_options, default: item.sheet_size || ((item.sheet_configs || [])[0] || {}).size || '', reqd: 1 },
				{ fieldtype: 'Column Break' },
				{ fieldtype: 'Float', fieldname: 'sheet_sft', label: 'SFT / Sheet', read_only: 1, default: item.sheet_sft || get_sheet_sft_from_size(item, item.sheet_size || ((item.sheet_configs || [])[0] || {}).size) },
				{ fieldtype: 'Section Break' },
				{ fieldtype: 'Float', fieldname: 'sheet_qty', label: 'Qty', read_only: 1, default: flt(item.qty || 0) },
				{ fieldtype: 'Section Break', label: 'Item Details' },
				{ fieldtype: 'Data', fieldname: 'glass_type', label: 'Glass Type', read_only: 1, hidden: 1, default: item.glass_type || 'Ordinary' },
				{ fieldtype: 'Small Text', fieldname: 'description', label: 'Description', default: item.description || '' }
			);
		}

		if (item.category === 'Aluminium') {
			fields.push(
				{ fieldtype: 'Section Break', label: 'Aluminium Pricing' },
				{ fieldtype: 'Currency', fieldname: 'aluminium_rate_per_kg', label: 'Rate / Kg', default: item.aluminium_rate_per_kg || 0 },
				{ fieldtype: 'Column Break' },
				{ fieldtype: 'Float', fieldname: 'aluminium_weight_per_length', label: 'Weight / Length', default: item.aluminium_weight_per_length || 0 },
				{ fieldtype: 'Section Break', label: 'Item Details' },
				{ fieldtype: 'Select', fieldname: 'aluminium_color', label: 'Color', options: get_aluminium_color_options(), default: item.aluminium_color || 'None' },
				{ fieldtype: 'Column Break' },
				{ fieldtype: 'Small Text', fieldname: 'description', label: 'Description', default: item.description || '' }
			);
		}

		if (is_ceiling_bundle) {
			fields.push({ fieldtype: 'Float', fieldname: 'quantity', label: 'Quantity (sqm)', default: item.quantity || 100, reqd: 1 });
		}

		if (is_glass && !is_sheet_glass) {
			let uom = normalize_dimension_uom(item.dimension_uom);
			let label = get_dimension_label(uom);
			fields.push(
				{ fieldtype: 'Section Break', label: 'Glass Dimensions' },
				{ fieldtype: 'Float', fieldname: 'width_mm', label: `Width (${label})`, default: mm_to_dimension_input(item.width_mm || 0, uom) },
				{ fieldtype: 'Float', fieldname: 'height_mm', label: `Height (${label})`, default: mm_to_dimension_input(item.height_mm || 0, uom) },
				{ fieldtype: 'Column Break' },
				{ fieldtype: 'Float', fieldname: 'base_width_ft', label: 'Width (ft)', read_only: 1, default: glass_base_width_ft(item) },
				{ fieldtype: 'Float', fieldname: 'base_height_ft', label: 'Height (ft)', read_only: 1, default: glass_base_height_ft(item) },
				{ fieldtype: 'Section Break', label: 'Allowance' },
				{ fieldtype: 'Float', fieldname: 'width_allowance', label: 'W+', default: item.width_allowance || 0 },
				{ fieldtype: 'Float', fieldname: 'height_allowance', label: 'H+', default: item.height_allowance || 0 },
				{ fieldtype: 'Column Break' },
				{ fieldtype: 'Float', fieldname: 'width_ft', label: 'Width + W (ft)', read_only: 1, default: glass_adjusted_width_ft(item) },
				{ fieldtype: 'Float', fieldname: 'height_ft', label: 'Height + H (ft)', read_only: 1, default: glass_adjusted_height_ft(item) },
				{ fieldtype: 'Section Break' },
				{ fieldtype: 'Float', fieldname: 'area_sqft', label: 'Area (sqft)', read_only: 1, default: glass_form_area_sqft(glass_adjusted_width_ft(item), glass_adjusted_height_ft(item)) },
				{ fieldtype: 'Column Break' },
				{ fieldtype: 'Float', fieldname: 'perimeter_rft', label: 'Perimeter (rft)', read_only: 1, default: glass_form_perimeter_rft(glass_adjusted_width_ft(item), glass_adjusted_height_ft(item)) },
				{ fieldtype: 'Section Break', label: 'Processing Options' },
				{ fieldtype: 'Int', fieldname: 'polish_width_sides', label: 'Polish Width Sides', default: item.polish_width_sides || 0, description: 'Allowed values: 0, 1, 2' },
				{ fieldtype: 'Column Break' },
				{ fieldtype: 'Int', fieldname: 'polish_height_sides', label: 'Polish Height Sides', default: item.polish_height_sides || 0, description: 'Allowed values: 0, 1, 2' },
				{ fieldtype: 'Column Break' },
				{ fieldtype: 'Select', fieldname: 'polish_type', label: 'Polish Type', options: POLISH_TYPE_OPTIONS, default: item.polish_type || DEFAULT_POLISH_TYPE },
				{ fieldtype: 'Section Break' },
				{ fieldtype: 'Int', fieldname: 'holes', label: 'Number of Holes', default: item.holes || 0 },
				{ fieldtype: 'Column Break' },
				{ fieldtype: 'Select', fieldname: 'hole_type', label: 'Hole Type', options: HOLE_TYPE_OPTIONS, default: item.hole_type || DEFAULT_HOLE_TYPE },
				{ fieldtype: 'Section Break' },
				{ fieldtype: 'Int', fieldname: 'notches', label: 'Number of Notches', default: item.notches || 0 },
				{ fieldtype: 'Column Break' },
				{ fieldtype: 'Select', fieldname: 'notch_type', label: 'Notch Type', options: NOTCH_TYPE_OPTIONS, default: item.notch_type || DEFAULT_NOTCH_TYPE },
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
			primary_action_label: opts.item ? 'Save Item' : 'Add Item',
			primary_action: function (values) { on_save(values); },
		});

		function finalize() {
			d.hide();
			opts.onSave(item);
		}

		function on_save(values) {
			item.item_code = values.item_code;
			item.item_name = item.item_name || values.item_code;
			item.description = values.description || '';
			item.price_list = is_ceiling ? ceiling_mode_price_list(item.ceiling_mode) : (values.price_list || 'Retail');
			item.qty = values.qty || 1;

			if (item.category === 'Aluminium') {
				item.price_list = aluminium_price_label(values.price_list || 'Normal Price');
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
					args: { item_code: item.item_code, price_list: item.price_list, quantity: item.quantity },
					freeze: true, freeze_message: 'Calculating...',
					callback: function (r) {
						item.rate = (r.message && r.message.base_rate != null) ? r.message.base_rate : item.rate;
						item.amount = (r.message && r.message.total != null) ? r.message.total : calculate_item_amount(item);
						finalize();
					},
				});
				return;
			}

			if (is_ceiling) { item.amount = calculate_item_amount(item); finalize(); return; }

			if (is_glass && is_sheet_glass) {
				let sheet_size = values.sheet_size || '';
				let sheet_sft = get_sheet_sft_from_size(item, sheet_size) || flt(values.sheet_sft || 0);
				let pcs = flt(values.pcs || 0);
				if (!sheet_size || sheet_sft <= 0) { frappe.msgprint('Please select a configured sheet size.'); return; }
				if (pcs <= 0) { frappe.msgprint('Please enter Pcs greater than 0.'); return; }
				item.sale_mode = 'Sheet'; item.glass_mode = 'Sheet'; item.price_list = 'Wholesale';
				item.pcs = pcs; item.sheet_size = sheet_size; item.sheet_sft = sheet_sft;
				item.qty = sheet_sft * pcs; item.area_sqft = item.qty;
				item.width_mm = 0; item.height_mm = 0; item.width_allowance = 0; item.height_allowance = 0;
				item.base_width_ft = 0; item.base_height_ft = 0; item.width_ft = 0; item.height_ft = 0; item.perimeter_rft = 0;
				item.polishing = 0; item.polish_width_sides = 0; item.polish_height_sides = 0; item.polish_type = DEFAULT_POLISH_TYPE;
				item.holes = 0; item.hole_type = DEFAULT_HOLE_TYPE; item.notches = 0; item.notch_type = DEFAULT_NOTCH_TYPE;
				item.numbering = ''; item.sandblast_type = 'None';
				item.glass_type = values.glass_type || 'Ordinary';
				frappe.call({
					method: 'crystal_alluminium_works.api.calculate_glass_total',
					args: {
						item_code: item.item_code, price_list: item.price_list, qty: item.qty, sale_mode: item.sale_mode,
						width_mm: 0, height_mm: 0, width_allowance: 0, height_allowance: 0, polishing: 0,
						polish_width_sides: 0, polish_height_sides: 0, holes: 0, notches: 0, sandblast_type: 'None',
						polish_type: DEFAULT_POLISH_TYPE, hole_type: DEFAULT_HOLE_TYPE, notch_type: DEFAULT_NOTCH_TYPE,
					},
					freeze: true, freeze_message: 'Calculating...',
					callback: function (r) {
						item.rate = (r.message && r.message.base_rate != null) ? r.message.base_rate : item.rate;
						item.amount = (r.message && r.message.total != null) ? r.message.total : 0;
						finalize();
					},
				});
				return;
			}

			if (is_glass) {
				let uom = normalize_dimension_uom(item.dimension_uom);
				let pws = cint(values.polish_width_sides || 0);
				let phs = cint(values.polish_height_sides || 0);
				if (![0, 1, 2].includes(pws) || ![0, 1, 2].includes(phs)) {
					frappe.msgprint('Polish width side and polish height side can only be 0, 1, or 2.'); return;
				}
				item.sale_mode = 'Resized'; item.dimension_uom = uom;
				item.width_mm = dimension_input_to_mm(values.width_mm || 0, uom);
				item.height_mm = dimension_input_to_mm(values.height_mm || 0, uom);
				item.width_allowance = values.width_allowance || 0;
				item.height_allowance = values.height_allowance || 0;
				item.base_width_ft = values.base_width_ft || 0;
				item.base_height_ft = values.base_height_ft || 0;
				item.width_ft = values.width_ft || 0;
				item.height_ft = values.height_ft || 0;
				item.area_sqft = values.area_sqft || 0;
				item.polish_width_sides = pws; item.polish_height_sides = phs;
				item.polish_type = values.polish_type || DEFAULT_POLISH_TYPE;
				item.polishing = pws > 0 || phs > 0 ? 1 : 0;
				item.perimeter_rft = glass_polishing_rft(item);
				item.holes = values.holes || 0; item.hole_type = values.hole_type || DEFAULT_HOLE_TYPE;
				item.notches = values.notches || 0; item.notch_type = values.notch_type || DEFAULT_NOTCH_TYPE;
				item.numbering = values.numbering || '';
				item.sandblast_type = values.sandblast_type || 'None';
				item.glass_type = values.glass_type || 'Ordinary';
				item.qty = values.qty || 1;
				frappe.call({
					method: 'crystal_alluminium_works.api.calculate_glass_total',
					args: {
						item_code: item.item_code, price_list: item.price_list, qty: item.qty, sale_mode: item.sale_mode,
						width_mm: item.width_mm, height_mm: item.height_mm, width_allowance: item.width_allowance, height_allowance: item.height_allowance,
						polishing: item.polishing, polish_width_sides: item.polish_width_sides, polish_height_sides: item.polish_height_sides,
						holes: item.holes, notches: item.notches, sandblast_type: item.sandblast_type,
						polish_type: item.polish_type, hole_type: item.hole_type, notch_type: item.notch_type,
					},
					freeze: true, freeze_message: 'Calculating...',
					callback: function (r) {
						if (r.message) {
							item.base_width_ft = r.message.base_width_ft != null ? r.message.base_width_ft : item.base_width_ft;
							item.base_height_ft = r.message.base_height_ft != null ? r.message.base_height_ft : item.base_height_ft;
							item.width_ft = r.message.width_ft != null ? r.message.width_ft : item.width_ft;
							item.height_ft = r.message.height_ft != null ? r.message.height_ft : item.height_ft;
							item.area_sqft = r.message.area_sqft != null ? r.message.area_sqft : item.area_sqft;
							item.perimeter_rft = r.message.perimeter_rft != null ? r.message.perimeter_rft : item.perimeter_rft;
							item.rate = r.message.base_rate != null ? r.message.base_rate : item.rate;
							item.amount = r.message.total != null ? r.message.total : 0;
						} else {
							item.amount = calculate_item_amount(item);
						}
						finalize();
					},
				});
				return;
			}

			// Fittings / Rubber / Silicone — flat item + qty + rate.
			item.amount = calculate_item_amount(item);
			finalize();
		}

		d.show();

		if (item.category === 'Aluminium') {
			ensure_aluminium_colors(function () {
				let field = d.get_field('aluminium_color');
				if (!field) return;
				field.df.options = get_aluminium_color_options();
				field.refresh();
				d.set_value('aluminium_color', item.aluminium_color || 'None');
			});
		}

		if (is_glass) {
			d.$wrapper.find('.modal-dialog').css({ 'max-width': '90%', 'width': '700px', 'height': '80vh', 'margin': '10vh auto' });
			d.$wrapper.find('.modal-content').css({ 'height': '100%', 'display': 'flex', 'flex-direction': 'column' });
			d.$wrapper.find('.modal-header').css({ 'flex-shrink': '0' });
			d.$wrapper.find('.modal-body').css({ 'flex': '1', 'overflow-y': 'auto', 'min-height': '0' });
			d.$wrapper.find('.modal-footer').css({ 'flex-shrink': '0', 'border-top': '1px solid var(--border-color)' });
		}

		if (is_sheet_glass) {
			let update_sheet_qty = function () {
				let sheet_size = d.get_value('sheet_size') || '';
				let sheet_sft = get_sheet_sft_from_size(item, sheet_size);
				let pcs = flt(d.get_value('pcs') || 0);
				d.set_value('sheet_sft', sheet_sft);
				d.set_value('sheet_qty', sheet_sft * pcs);
			};
			if (d.fields_dict.sheet_size && d.fields_dict.sheet_size.$input) d.fields_dict.sheet_size.$input.on('change', update_sheet_qty);
			if (d.fields_dict.pcs && d.fields_dict.pcs.$input) d.fields_dict.pcs.$input.on('input change', update_sheet_qty);
			setTimeout(update_sheet_qty, 0);
		}

		if (is_glass && !is_sheet_glass) {
			let update_allowance_dimensions = function (baseWidthFt, baseHeightFt) {
				let wa = flt(d.get_value('width_allowance') || 0);
				let ha = flt(d.get_value('height_allowance') || 0);
				let aw = flt(baseWidthFt || 0) + wa, ah = flt(baseHeightFt || 0) + ha;
				d.set_value('base_width_ft', baseWidthFt || 0);
				d.set_value('base_height_ft', baseHeightFt || 0);
				d.set_value('width_ft', aw);
				d.set_value('height_ft', ah);
				d.set_value('area_sqft', glass_form_area_sqft(aw, ah));
				d.set_value('perimeter_rft', glass_form_perimeter_rft(aw, ah));
			};
			let recalc = function () {
				let uom = normalize_dimension_uom(item.dimension_uom);
				let w = dimension_input_to_mm(d.get_value('width_mm') || 0, uom);
				let h = dimension_input_to_mm(d.get_value('height_mm') || 0, uom);
				if (w > 0 && h > 0) {
					frappe.call({
						method: 'crystal_alluminium_works.pricing_engine.calculate_dimensions',
						args: { width_mm: w, height_mm: h, item_code: d.get_value('item_code') || '', glass_type: d.get_value('glass_type') || '' },
						async: false,
						callback: function (r) { if (r.message) update_allowance_dimensions(r.message.width_ft, r.message.height_ft); },
					});
				} else {
					update_allowance_dimensions(0, 0);
				}
			};
			d.fields_dict.width_mm.$input.on('change', recalc);
			d.fields_dict.height_mm.$input.on('change', recalc);
			d.fields_dict.width_allowance.$input.on('change', recalc);
			d.fields_dict.height_allowance.$input.on('change', recalc);
		}

		// ── rate auto-fetch (ported) ────────────────────────────────
		function queue_fetch_rate(fetch_item_details) { fetch_rate(fetch_item_details !== false); }

		function fetch_item_price_rate(ic, price_list) {
			frappe.call({
				method: 'frappe.client.get_value',
				args: { doctype: 'Item Price', filters: { item_code: ic, price_list: price_list, selling: 1 }, fieldname: 'price_list_rate' },
				callback: function (r) {
					if (r.message && r.message.price_list_rate) {
						d.set_value('rate', r.message.price_list_rate);
					} else {
						frappe.db.get_value('Item', ic, 'standard_rate', function (r2) {
							if (r2 && r2.standard_rate) d.set_value('rate', r2.standard_rate);
						});
					}
				},
			});
		}

		function update_aluminium_rate_from_inputs() {
			let normal_price = aluminium_normal_price(d.get_value('aluminium_rate_per_kg') || 0, d.get_value('aluminium_weight_per_length') || 0);
			if (normal_price > 0) { d.set_value('rate', aluminium_rate_for_selling_price(normal_price, d.get_value('price_list'))); return true; }
			return false;
		}

		function fetch_rate(fetch_item_details) {
			try {
				let ic = d.get_value('item_code') || (d.fields_dict.item_code && d.fields_dict.item_code.$input && d.fields_dict.item_code.$input.val()) || item.item_code;
				if (ic && d.fields_dict.stock_balance_html) {
					frappe.call({
						method: 'crystal_alluminium_works.api.get_item_stock_balance',
						args: { item_code: ic },
						callback: function (r) {
							let balances = r.message || [];
							let html = `<div style="padding:10px;background:var(--subtle-fg);border:1px solid var(--border-color);border-radius:6px;margin-top:5px;">
								<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px;letter-spacing:0.3px;">Current Stock Balance</div>`;
							if (balances.length) {
								html += balances.map(b => {
									let dn = (b.warehouse || '').replace('Stores - CA', '').trim();
									let lbl = dn ? `<span class="text-muted">${frappe.utils.escape_html(dn)}:</span> ` : '';
									return `<div style="margin-bottom:4px;font-size:13px;display:flex;justify-content:space-between;gap:20px;">${lbl}<strong style="color:var(--text-color);">${frappe.utils.escape_html(b.balance)}</strong></div>`;
								}).join('');
							} else {
								html += `<div style="font-size:13px;color:var(--text-muted);">No stock available in any warehouse.</div>`;
							}
							html += '</div>';
							d.fields_dict.stock_balance_html.html(html);
						},
					});
				}

				let pl = d.get_value('price_list') || (item.category === 'Aluminium' ? aluminium_price_label(item.price_list) : (is_sheet_glass ? 'Wholesale' : (item.price_list || 'Retail')));
				if (!ic || !pl) return;
				let lookup_price_list = item.category === 'Aluminium' ? aluminium_backend_price_list(pl) : pl;

				if (item.category === 'Aluminium') {
					if (fetch_item_details) {
						frappe.call({
							method: 'frappe.client.get_value',
							args: { doctype: 'Item', filters: { name: ic }, fieldname: ['item_name', 'stock_uom', 'custom_aluminium_rate_per_kg', 'custom_aluminium_weight_per_length'] },
							callback: function (r) {
								if (r.message) {
									item.item_name = r.message.item_name || item.item_name || ic;
									item.uom = r.message.stock_uom || item.uom;
									d.set_value('aluminium_rate_per_kg', flt(r.message.custom_aluminium_rate_per_kg || 0));
									d.set_value('aluminium_weight_per_length', flt(r.message.custom_aluminium_weight_per_length || 0));
								}
								if (!update_aluminium_rate_from_inputs()) fetch_item_price_rate(ic, lookup_price_list);
							},
						});
					} else if (!update_aluminium_rate_from_inputs()) {
						fetch_item_price_rate(ic, lookup_price_list);
					}
				} else {
					frappe.db.get_value('Item', ic, ['item_name', 'stock_uom'], function (res) {
						item.item_name = (res && res.item_name) || item.item_name || ic;
						item.uom = (res && res.stock_uom) || item.uom;
					});
					fetch_item_price_rate(ic, lookup_price_list);
				}

				if (is_glass) {
					frappe.db.get_value('Item', ic, 'custom_glass_type', function (r) {
						d.set_value('glass_type', (r && r.custom_glass_type) || 'Ordinary');
					});
				}
			} catch (e) {
				console.error('CAW Item Builder rate fetch failed', e);
			}
		}

		d.fields_dict.item_code.$input.on('change awesomplete-selectcomplete', function () { queue_fetch_rate(true); });
		d.fields_dict.price_list.$input.on('change', function () { queue_fetch_rate(false); });

		if (item.category === 'Aluminium') {
			let recalc_aluminium = function () {
				let ic = d.get_value('item_code');
				if (!update_aluminium_rate_from_inputs() && ic) fetch_item_price_rate(ic, aluminium_backend_price_list(d.get_value('price_list')));
			};
			d.fields_dict.aluminium_rate_per_kg.$input.on('input change', recalc_aluminium);
			d.fields_dict.aluminium_weight_per_length.$input.on('input change', recalc_aluminium);
		}
	}

	window.CAWItemBuilder = { open: open };
})();
