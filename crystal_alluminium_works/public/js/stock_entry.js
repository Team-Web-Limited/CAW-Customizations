// Material Issue rows, category-first like the procurement tables (procurement_sheet_items.js):
// pick a Product Category, the Item lookup narrows to it, and glass is issued as sheet size +
// sheets, ceiling as board pieces. qty is derived here for immediate feedback and re-derived on
// save by crystal_alluminium_works.stock_entry_handler, which also tags glass rows "Sheets
// Consumed" so the sheet-count ledger drops along with the SFT balance.

const CAW_SE_CATEGORIES = new Set(['Aluminium', 'Glass', 'Fittings', 'Ceiling', 'Rubber', 'Silicone']);

let caw_se_sheet_map = null;
let caw_se_sheet_sizes = [];
let caw_se_sheet_promise = null;

function caw_se_is_material_issue(frm) {
	return frm.doc.stock_entry_type === 'Material Issue';
}

function caw_se_load_sheet_sizes() {
	if (caw_se_sheet_promise) return caw_se_sheet_promise;
	caw_se_sheet_promise = frappe.call({
		method: 'crystal_alluminium_works.api.get_glass_sheet_configs'
	}).then(r => {
		caw_se_sheet_map = {};
		caw_se_sheet_sizes = [];
		(r.message || []).forEach(cfg => {
			caw_se_sheet_map[cfg.size] = flt(cfg.sft);
			caw_se_sheet_sizes.push(cfg.size);
		});
	});
	return caw_se_sheet_promise;
}

function caw_se_set_sheet_size_options(frm) {
	let grid = frm.get_field('items') && frm.get_field('items').grid;
	if (!grid) return;
	grid.update_docfield_property('custom_sheet_size', 'options', ['', ...caw_se_sheet_sizes].join('\n'));
}

// ERPNext's StockEntry controller sets this lookup to all stock items during its own setup, so
// it is re-asserted on refresh and right before the user opens the lookup (category change /
// new row), the same reasoning as caw_set_item_code_query in procurement_sheet_items.js.
function caw_se_set_item_code_query(frm) {
	if (!frm.fields_dict || !frm.fields_dict.items) return;
	frm.set_query('item_code', 'items', function(doc, cdt, cdn) {
		let row = locals[cdt][cdn] || {};
		let filters = { is_stock_item: 1 };
		if (doc.stock_entry_type === 'Material Issue' && row.custom_product_category) {
			filters.item_group = row.custom_product_category;
		}
		return erpnext.queries.item(filters);
	});
}

function caw_se_recompute_row(frm, cdt, cdn) {
	if (!caw_se_is_material_issue(frm)) return;
	let row = locals[cdt][cdn];
	if (!row) return;

	let qty = 0;
	if (row.custom_product_category === 'Glass') {
		let sft = flt((caw_se_sheet_map || {})[row.custom_sheet_size] || 0);
		let pcs = flt(row.custom_sheet_pcs || 0);
		if (sft <= 0 || pcs <= 0) return;
		qty = flt(sft * pcs);
	} else if (row.custom_product_category === 'Ceiling') {
		let pcs = flt(row.custom_ceiling_pcs || 0);
		if (pcs <= 0 || !row.item_code) return;
		frappe.call({
			method: 'crystal_alluminium_works.api.get_ceiling_piece_area',
			args: { item_code: row.item_code },
			callback: function(r) {
				let area = flt(r.message || 0);
				if (area > 0) caw_se_set_stock_qty(cdt, cdn, flt(area * pcs));
			}
		});
		return;
	} else {
		return;
	}
	caw_se_set_stock_qty(cdt, cdn, qty);
}

function caw_se_set_stock_qty(cdt, cdn, qty) {
	let row = locals[cdt][cdn];
	// Piece-driven quantities are in the stock UOM; a UOM conversion would scale them twice.
	if (row.stock_uom && row.uom !== row.stock_uom) {
		frappe.model.set_value(cdt, cdn, 'uom', row.stock_uom);
		frappe.model.set_value(cdt, cdn, 'conversion_factor', 1);
	}
	frappe.model.set_value(cdt, cdn, 'qty', qty);
}

frappe.ui.form.on('Stock Entry', {
	onload: function(frm) {
		caw_se_set_item_code_query(frm);
		caw_se_load_sheet_sizes().then(() => caw_se_set_sheet_size_options(frm));
	},
	refresh: function(frm) {
		caw_se_set_item_code_query(frm);
		caw_se_load_sheet_sizes().then(() => caw_se_set_sheet_size_options(frm));
	},
	onload_post_render: function(frm) {
		caw_se_set_item_code_query(frm);
	},
	stock_entry_type: function(frm) {
		caw_se_set_item_code_query(frm);
	}
});

frappe.ui.form.on('Stock Entry Detail', {
	items_add: function(frm) {
		caw_se_set_item_code_query(frm);
	},
	item_code: function(frm, cdt, cdn) {
		// Fill the category from the item when it was picked first (or without a category).
		let row = locals[cdt][cdn];
		if (!caw_se_is_material_issue(frm) || !row.item_code || row.custom_product_category) return;
		frappe.db.get_value('Item', row.item_code, 'item_group').then(res => {
			let group = (res && res.message && res.message.item_group) || '';
			if (CAW_SE_CATEGORIES.has(group)) {
				frappe.model.set_value(cdt, cdn, 'custom_product_category', group);
			}
		});
	},
	custom_product_category: function(frm, cdt, cdn) {
		caw_se_set_item_code_query(frm);
		// A category that no longer matches the chosen item clears the item.
		let row = locals[cdt][cdn];
		if (row.item_code && row.custom_product_category) {
			frappe.db.get_value('Item', row.item_code, 'item_group').then(res => {
				let group = (res && res.message && res.message.item_group) || '';
				if (group !== row.custom_product_category) {
					frappe.model.set_value(cdt, cdn, 'item_code', '');
				}
			});
		}
		caw_se_recompute_row(frm, cdt, cdn);
	},
	custom_sheet_size: function(frm, cdt, cdn) {
		caw_se_recompute_row(frm, cdt, cdn);
	},
	custom_sheet_pcs: function(frm, cdt, cdn) {
		caw_se_recompute_row(frm, cdt, cdn);
	},
	custom_ceiling_pcs: function(frm, cdt, cdn) {
		caw_se_recompute_row(frm, cdt, cdn);
	}
});
