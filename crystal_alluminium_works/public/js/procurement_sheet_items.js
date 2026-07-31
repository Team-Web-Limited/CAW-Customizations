// Glass sheet / ceiling piece entry for the procurement flow.
//
// Loaded on Material Request, Purchase Order, Purchase Receipt and Purchase
// Invoice (see hooks.doctype_js — the same file is registered for all four, so
// the buyer gets the identical entry experience at every step and values carry
// through the standard MR -> PO -> PR / PI mapping). A Purchase Invoice with
// "Update Stock" ticked takes stock in without a receipt, which is why it is a
// full entry point here and not just a billing document.
//
// Glass is stocked in Square Foot and ceiling boards in Square Meter, but both
// are ordered per physical piece at a per-piece price. The user enters sheet
// size + pcs (or pcs alone for ceiling) + rate per piece; qty and rate are
// derived here for immediate feedback and re-derived server-side on save by
// crystal_alluminium_works.purchase_handler, which is the source of truth.

const CAW_PROCUREMENT_DOCTYPES = {
	'Material Request': 'Material Request Item',
	'Purchase Order': 'Purchase Order Item',
	'Purchase Receipt': 'Purchase Receipt Item',
	'Purchase Invoice': 'Purchase Invoice Item'
};

const CAW_STOCK_CATEGORIES = new Set(['Aluminium', 'Glass', 'Fittings', 'Ceiling', 'Rubber', 'Silicone']);

// size -> sft, loaded once per desk session
let caw_sheet_map = null;
let caw_sheet_sizes = [];
let caw_sheet_promise = null;

function caw_load_sheet_sizes() {
	if (caw_sheet_promise) return caw_sheet_promise;
	caw_sheet_promise = frappe.call({
		method: 'crystal_alluminium_works.api.get_glass_sheet_configs'
	}).then(r => {
		caw_sheet_map = {};
		caw_sheet_sizes = [];
		(r.message || []).forEach(cfg => {
			caw_sheet_map[cfg.size] = flt(cfg.sft);
			caw_sheet_sizes.push(cfg.size);
		});
	});
	return caw_sheet_promise;
}

function caw_set_sheet_size_options(frm) {
	// The child grid keeps its own copy of each docfield (not a live reference
	// to frappe.meta), so mutating the meta docfield alone never reaches an
	// already-rendered row — update_docfield_property is the API meant for
	// exactly this (dynamic Select options on a grid column).
	let grid = frm.get_field('items') && frm.get_field('items').grid;
	if (!grid) return;
	grid.update_docfield_property('custom_sheet_size', 'options', ['', ...caw_sheet_sizes].join('\n'));
}

// Narrow the Item Code lookup to the row's chosen category, so picking
// "Aluminium" lists only aluminium items instead of the whole catalogue.
//
// This must be re-asserted rather than set once: ERPNext's own class-based
// controllers (MaterialRequestController.onload, BuyingController.setup_queries)
// set their own item_code query, and those run as "old style" cscript handlers,
// which frappe's script_manager always queues AFTER every frappe.ui.form.on
// handler. Worse, form.js fires trigger("onload") without awaiting it before
// calling render_form(), so onload's controller tasks and our refresh handler
// interleave unpredictably — whoever writes get_query last wins by luck.
// Re-asserting on category change (the action immediately preceding the item
// lookup) makes us the last writer at the only moment that matters.
function caw_set_item_code_query(frm) {
	if (!frm.fields_dict || !frm.fields_dict.items) return;
	frm.set_query('item_code', 'items', function(doc, cdt, cdn) {
		let row = locals[cdt][cdn] || {};
		// Keep routing through ERPNext's item_query: it applies the Party
		// Specific Item restrictions for the supplier and excludes disabled /
		// template items, which a bare filters dict would silently drop.
		let filters = { is_stock_item: 1 };
		if (doc.supplier) filters.supplier = doc.supplier;
		if (row.custom_product_category) {
			filters.item_group = row.custom_product_category;
			if (row.custom_product_category === 'Glass') {
				filters.custom_glass_type = ['!=', 'Laminated'];
			}
		}
		return { query: 'erpnext.controllers.queries.item_query', filters: filters };
	});
}

function caw_recompute_row(frm, cdt, cdn) {
	let row = locals[cdt][cdn];
	if (!row) return;

	let pcs = 0;
	let qty = 0;
	let per_piece = 0;

	if (row.custom_product_category === 'Glass') {
		if (!row.custom_sheet_size) return;
		let sft = flt((caw_sheet_map || {})[row.custom_sheet_size] || row.custom_sheet_sft || 0);
		pcs = flt(row.custom_sheet_pcs || 0);
		if (sft <= 0 || pcs <= 0) return;
		frappe.model.set_value(cdt, cdn, 'custom_glass_sale_mode', 'Sheet');
		frappe.model.set_value(cdt, cdn, 'custom_sheet_sft', sft);
		per_piece = sft;
		qty = flt(sft * pcs);
	} else if (row.custom_product_category === 'Ceiling') {
		let area = flt(row.custom_sheet_sft || 0); // reused as sqm/piece for ceiling
		pcs = flt(row.custom_ceiling_pcs || 0);
		if (pcs <= 0) return;
		if (area <= 0) {
			// Row came from a mapped document, so the per-board area was never
			// fetched on this form. Fetch it, then run the computation again.
			frappe.call({
				method: 'crystal_alluminium_works.api.get_ceiling_piece_area',
				args: { item_code: row.item_code },
				callback: function(r) {
					if (flt(r.message || 0) <= 0) return;
					frappe.model.set_value(cdt, cdn, 'custom_sheet_sft', flt(r.message));
					caw_recompute_row(frm, cdt, cdn);
				}
			});
			return;
		}
		per_piece = area;
		qty = flt(area * pcs);
	} else {
		return;
	}

	// Piece-driven quantities are in the item's stock UOM, so the row must not
	// also carry a UOM conversion or the stock qty would be scaled twice.
	if (row.stock_uom && row.uom !== row.stock_uom) {
		frappe.model.set_value(cdt, cdn, 'uom', row.stock_uom);
		frappe.model.set_value(cdt, cdn, 'conversion_factor', 1);
	}
	frappe.model.set_value(cdt, cdn, 'qty', qty);

	// Damaged sheets/boards are counted in pieces like everything else on the
	// row; standard rejected_qty is in stock UOM. Only the receipt and the
	// invoice can reject, so the field is absent on request/order rows.
	if (frappe.meta.has_field(cdt, 'custom_rejected_pcs') && per_piece > 0) {
		frappe.model.set_value(
			cdt, cdn, 'rejected_qty', flt(per_piece * flt(row.custom_rejected_pcs || 0))
		);
	}

	// Supplier quotes per sheet/piece; ERPNext values stock per stock UOM.
	let rate_per_piece = flt(row.custom_rate_per_piece || 0);
	if (rate_per_piece > 0 && qty > 0) {
		frappe.model.set_value(cdt, cdn, 'rate', flt(pcs * rate_per_piece) / qty);
	}
}

function caw_on_item_selected(frm, cdt, cdn) {
	let row = locals[cdt][cdn];
	if (!row || !row.item_code) return;

	frappe.db.get_value('Item', row.item_code, ['item_group', 'stock_uom']).then(res => {
		let v = (res && res.message) || {};
		let category = v.item_group;
		if (!CAW_STOCK_CATEGORIES.has(category)) {
			category = null;
		}
		frappe.model.set_value(cdt, cdn, 'custom_product_category', category);

		if (category === 'Ceiling') {
			// Fixed area per board, from Ceiling Configuration; parked in
			// custom_sheet_sft so one field drives both piece-based categories.
			frappe.call({
				method: 'crystal_alluminium_works.api.get_ceiling_piece_area',
				args: { item_code: row.item_code },
				callback: function(r) {
					frappe.model.set_value(cdt, cdn, 'custom_sheet_sft', flt(r.message || 0));
					caw_recompute_row(frm, cdt, cdn);
				}
			});
		}
	});
}

// Purchase Invoice / Purchase Receipt only: buyers sometimes know the total
// billed/received amount for a line before they know the per-unit rate (e.g.
// a supplier invoice quotes a lump sum for the accepted quantity). Amount is
// read-only by default in ERPNext (it's derived as qty * rate); here we flip
// that and derive rate from amount / accepted qty instead.
//
// Deriving rate on the 'amount' event alone isn't enough: entering the
// accepted qty on a fresh row kicks off transaction.js's own qty handler,
// which asynchronously refetches the price-list rate / pricing rule and
// re-applies it via set_value *after* our handler has already run, silently
// overwriting the rate (and, through the standard qty*rate recompute, the
// amount) the user just typed. That's the "have to touch rate again" bug.
// __caw_locked_amount records the amount the user actually wants for the
// row; the rate/qty handlers below re-derive rate from it every time
// anything nudges rate, so any later async price-list write gets corrected
// back rather than winning the race.
const CAW_AMOUNT_DRIVEN_DOCTYPES = {
	'Purchase Invoice': 'Purchase Invoice Item',
	'Purchase Receipt': 'Purchase Receipt Item'
};

function caw_enforce_amount_driven_rate(cdt, cdn) {
	let row = locals[cdt][cdn];
	if (row?.__caw_locked_amount === undefined) return;

	let qty = flt(row.qty);
	if (qty <= 0) return;

	let derived_rate = flt(row.__caw_locked_amount) / qty;
	if (Math.abs(flt(row.rate) - derived_rate) > 0.0001) {
		frappe.model.set_value(cdt, cdn, 'rate', derived_rate);
	}
}

Object.entries(CAW_AMOUNT_DRIVEN_DOCTYPES).forEach(([parent_doctype, child_doctype]) => {
	frappe.ui.form.on(parent_doctype, {
		refresh: function(frm) {
			let grid = frm.get_field('items')?.grid;
			if (!grid) return;
			grid.update_docfield_property('amount', 'read_only', 0);
		}
	});

	frappe.ui.form.on(child_doctype, {
		item_code: function(frm, cdt, cdn) {
			// New item on the row means whatever amount lock existed belonged
			// to the previous item; let standard price-list/pricing-rule logic
			// set the rate fresh until the user re-enters an amount.
			delete locals[cdt][cdn].__caw_locked_amount;
		},
		amount: function(frm, cdt, cdn) {
			let row = locals[cdt][cdn];
			if (flt(row.amount) <= 0) {
				delete row.__caw_locked_amount;
				return;
			}
			row.__caw_locked_amount = flt(row.amount);
			caw_enforce_amount_driven_rate(cdt, cdn);
		},
		qty: function(frm, cdt, cdn) {
			caw_enforce_amount_driven_rate(cdt, cdn);
		},
		rate: function(frm, cdt, cdn) {
			caw_enforce_amount_driven_rate(cdt, cdn);
		}
	});
});

Object.entries(CAW_PROCUREMENT_DOCTYPES).forEach(([parent_doctype, child_doctype]) => {
	frappe.ui.form.on(parent_doctype, {
		onload: function(frm) {
			caw_set_item_code_query(frm);
			caw_load_sheet_sizes().then(() => caw_set_sheet_size_options(frm));
		},
		refresh: function(frm) {
			caw_set_item_code_query(frm);
			caw_load_sheet_sizes().then(() => caw_set_sheet_size_options(frm));
		},
		// Fires after refresh, so it reclaims get_query from any controller
		// onload task that resolved late (see caw_set_item_code_query).
		onload_post_render: function(frm) {
			caw_set_item_code_query(frm);
		}
	});

	frappe.ui.form.on(child_doctype, {
		items_add: function(frm) {
			caw_set_item_code_query(frm);
		},
		item_code: function(frm, cdt, cdn) {
			caw_on_item_selected(frm, cdt, cdn);
		},
		custom_product_category: function(frm, cdt, cdn) {
			// Re-assert here above all: this fires the instant the user picks a
			// category, i.e. immediately before they open the Item Code lookup.
			caw_set_item_code_query(frm);

			// Category is picked before the item now; if it no longer matches
			// whatever item was already selected, clear that item rather than
			// leave a stale item_code / category pairing.
			let row = locals[cdt][cdn];
			if (row.item_code && row.custom_product_category) {
				frappe.db.get_value('Item', row.item_code, 'item_group').then(res => {
					let item_group = (res && res.message && res.message.item_group) || '';
					if (item_group !== row.custom_product_category) {
						frappe.model.set_value(cdt, cdn, 'item_code', '');
					}
				});
			}
			caw_recompute_row(frm, cdt, cdn);
		},
		custom_sheet_size: function(frm, cdt, cdn) {
			caw_recompute_row(frm, cdt, cdn);
		},
		custom_sheet_pcs: function(frm, cdt, cdn) {
			caw_recompute_row(frm, cdt, cdn);
		},
		custom_ceiling_pcs: function(frm, cdt, cdn) {
			caw_recompute_row(frm, cdt, cdn);
		},
		custom_rejected_pcs: function(frm, cdt, cdn) {
			caw_recompute_row(frm, cdt, cdn);
		},
		custom_rate_per_piece: function(frm, cdt, cdn) {
			caw_recompute_row(frm, cdt, cdn);
		}
	});
});
