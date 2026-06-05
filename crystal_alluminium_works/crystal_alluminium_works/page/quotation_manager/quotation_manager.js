frappe.pages['quotation-manager'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Quotation Manager',
		single_column: true
	});

	page.set_secondary_action('Back', function() {
		window.history.back();
	});

	wrapper.page = page; // Store page for use in on_page_show
};

const QM_CEILING_COMPONENTS = [
	{ label: 'Board', ratio: 0.36, mode: 'divide' },
	{ label: 'MainT', ratio: 0.25, mode: 'multiply' },
	{ label: 'Sub Cross 4ft', ratio: 1.33, mode: 'multiply' },
	{ label: 'Sub Cross 2ft', ratio: 1.33, mode: 'multiply' },
	{ label: 'Wall angle', ratio: 0.25, mode: 'multiply' }
];
const QM_CEILING_BOARD_ITEM_CODES = new Set(['AMC', 'AGC']);
const QM_VAT_RATE = 0.16;

function get_manager_quotation_subtotal(doc) {
	return flt(doc.grand_total || 0);
}

function get_manager_quotation_tax(doc) {
	let subtotal = get_manager_quotation_subtotal(doc);
	let explicit_tax = flt(doc.total_taxes_and_charges || 0);
	return explicit_tax || (subtotal * QM_VAT_RATE);
}

function get_manager_quotation_total(doc) {
	return get_manager_quotation_subtotal(doc) + get_manager_quotation_tax(doc);
}

function is_manager_ceiling_board_item(item) {
	return QM_CEILING_BOARD_ITEM_CODES.has((item.item_code || '').trim());
}

function get_manager_ceiling_single_label(item) {
	if (is_manager_ceiling_board_item(item)) {
		return 'Board';
	}

	return (item.item_name || item.item_code || '').trim();
}

function get_manager_item_uom_label(item) {
	if (item.custom_product_category === 'Glass' && item.custom_glass_sale_mode === 'Full Sheet') {
		return 'Nos';
	}

	if (item.uom) {
		return item.uom;
	}

	if (item.custom_product_category === 'Aluminium') {
		return 'Meter';
	}

	if (item.custom_product_category === 'Ceiling') {
		return 'Square Meter';
	}

	if (item.custom_product_category === 'Glass') {
		return 'Square Foot';
	}

	return '';
}

function get_manager_item_uom_qty(item) {
	if (item.custom_product_category === 'Aluminium') {
		return flt(item.custom_aluminium_metres || 0);
	}

	if (item.custom_product_category === 'Ceiling') {
		return flt(item.custom_ceiling_sq_m || 0);
	}

	if (item.custom_product_category === 'Glass') {
		if (item.custom_glass_sale_mode === 'Sheet') {
			return flt(item.qty || 0);
		}

		if (item.custom_glass_sale_mode === 'Full Sheet') {
			return flt(item.qty || 0);
		}

		return flt(item.custom_area_sqft || 0) * flt(item.qty || 0);
	}

	return flt(item.qty || 0);
}

function get_manager_breakdown_label(label, parent_item) {
	let display = (label || '').trim().replace(/^Glass\s+/i, '');

	if (/sandblasting/i.test(display) && !/\(/.test(display) && parent_item.custom_sandblast_type) {
		display = `${display} (${parent_item.custom_sandblast_type})`;
	}

	return display || (label || '');
}

function get_manager_breakdown_uom(label, parent_item) {
	let normalized = (label || '').toLowerCase();

	if (normalized.includes('polishing')) {
		return 'Rft';
	}

	if (normalized.includes('hole') || normalized.includes('notch')) {
		return 'Nos';
	}

	if (normalized.includes('sandblasting') || normalized.includes('glass')) {
		return parent_item.custom_glass_sale_mode === 'Full Sheet' ? 'Nos' : 'Square Foot';
	}

	return '';
}

function format_manager_review_number(value, precision = 3) {
	let number = flt(value || 0);
	let rounded = parseFloat(number.toFixed(precision));
	return Number.isFinite(rounded) ? rounded : 0;
}

function get_manager_sheet_size_dimensions(size) {
	let parts = String(size || '')
		.split(/x/i)
		.map(part => (part || '').trim())
		.filter(Boolean);

	return {
		width: parts[0] || '',
		height: parts[1] || ''
	};
}

function get_manager_ceiling_component_breakdown(quantity) {
	quantity = flt(quantity || 0);
	return QM_CEILING_COMPONENTS.map(component => {
		let ratio = flt(component.ratio || 0);
		let qty = component.mode === 'divide' && ratio ? quantity / ratio : quantity * ratio;
		return { label: component.label, qty: Math.trunc(qty) };
	});
}

function get_manager_polish_sides_label(item) {
	let total = cint(item.custom_polish_width_sides || 0) + cint(item.custom_polish_height_sides || 0);
	return total ? `Polish ${total} side${total === 1 ? '' : 's'}` : '';
}

function get_builder_glass_base_rate(item) {
	let areaSqft = flt(item.custom_area_sqft || 0);
	if (item.custom_glass_sale_mode === 'Full Sheet' || item.custom_glass_sale_mode === 'Sheet' || !areaSqft) {
		return flt(item.rate || 0);
	}

	return flt(item.rate || 0) / areaSqft;
}

async function get_sheet_builder_details(item, glass_type) {
	if (item.custom_glass_sale_mode !== 'Sheet') {
		return { pcs: item.qty, sheet_size: '', sheet_sft: 0 };
	}

	let saved_pcs = flt(item.custom_sheet_pcs || 0);
	let saved_sft = flt(item.custom_sheet_sft || 0);
	let saved_size = item.custom_sheet_size || '';
	if (saved_pcs || saved_sft || saved_size) {
		return {
			pcs: saved_pcs,
			sheet_size: saved_size,
			sheet_sft: saved_sft
		};
	}

	let configured_sheets = await frappe.call({
		method: 'crystal_alluminium_works.api.get_glass_sheet_configs',
		args: { glass_type: glass_type || 'Ordinary' }
	});
	let rows = configured_sheets.message || [];
	let matching_sheet = rows.find(row => flt(row.sft || 0) && flt(item.qty || 0) % flt(row.sft || 0) === 0) || rows[0] || {};
	let sheet_sft = flt(matching_sheet.sft || 0);

	return {
		pcs: sheet_sft ? flt(item.qty || 0) / sheet_sft : 0,
		sheet_size: matching_sheet.size || '',
		sheet_sft: sheet_sft
	};
}

function render_manager_review_glass_row(item, index) {
	if (item.custom_glass_sale_mode === 'Sheet') {
		let pieces = flt(item.custom_sheet_pcs || item.qty || 0);
		let sheet_dimensions = get_manager_sheet_size_dimensions(item.custom_sheet_size);
		return `
			<tr>
				<td style="text-align:center; white-space:nowrap;">-</td>
				<td style="text-align:center; white-space:nowrap;">-</td>
				<td style="text-align:center; white-space:nowrap;">-</td>
				<td style="text-align:center; white-space:nowrap;">-</td>
				<td style="text-align:center; white-space:nowrap;">-</td>
				<td style="text-align:center; white-space:nowrap;">-</td>
				<td style="text-align:center; white-space:nowrap;">-</td>
				<td style="text-align:center; white-space:nowrap;">${format_manager_review_number(item.qty || item.custom_sheet_sft || 0)}</td>
				<td style="white-space:nowrap;">-</td>
				<td style="text-align:center; white-space:nowrap;">${item.custom_numbering || '-'}</td>
				<td style="text-align:center; white-space:nowrap;">${sheet_dimensions.width ? frappe.utils.escape_html(sheet_dimensions.width) : '-'}</td>
				<td style="text-align:center; white-space:nowrap;">${sheet_dimensions.height ? frappe.utils.escape_html(sheet_dimensions.height) : '-'}</td>
				<td style="text-align:center; white-space:nowrap;">${pieces || '-'}</td>
				<td style="font-weight:500; white-space:nowrap;">${frappe.utils.escape_html(item.item_name || item.item_code || '')}</td>
				<td style="white-space:pre-wrap;">${item.description ? frappe.utils.escape_html(item.description) : '-'}</td>
			</tr>
		`;
	}

	let pieces = flt(item.qty || 0);
	let pw = (flt(item.custom_width_mm || 0) / 305) * pieces;
	let ph = (flt(item.custom_height_mm || 0) / 305) * pieces;

	return `
		<tr>
			<td style="text-align:center; white-space:nowrap;">${format_manager_review_number(item.custom_base_width_ft || item.custom_width_ft || 0)}</td>
			<td style="text-align:center; white-space:nowrap;">${format_manager_review_number(item.custom_base_height_ft || item.custom_height_ft || 0)}</td>
			<td style="text-align:center; white-space:nowrap;">${format_manager_review_number(item.custom_width_allowance || 0)}</td>
			<td style="text-align:center; white-space:nowrap;">${format_manager_review_number(item.custom_height_allowance || 0)}</td>
			<td style="text-align:center; white-space:nowrap;">${format_manager_review_number(pw)}</td>
			<td style="text-align:center; white-space:nowrap;">${format_manager_review_number(ph)}</td>
			<td style="text-align:center; white-space:nowrap;">${format_manager_review_number(item.custom_perimeter_rft || 0)}</td>
			<td style="text-align:center; white-space:nowrap;">${format_manager_review_number(item.custom_area_sqft || 0)}</td>
			<td style="white-space:nowrap;">${get_manager_polish_sides_label(item) || '-'}</td>
			<td style="text-align:center; white-space:nowrap;">${item.custom_numbering || '-'}</td>
			<td style="text-align:center; white-space:nowrap;">${format_manager_review_number(item.custom_width_mm || 0, 0)}</td>
			<td style="text-align:center; white-space:nowrap;">${format_manager_review_number(item.custom_height_mm || 0, 0)}</td>
			<td style="text-align:center; white-space:nowrap;">${pieces || '-'}</td>
			<td style="font-weight:500; white-space:nowrap;">${frappe.utils.escape_html(item.item_name || item.item_code || '')}</td>
			<td style="white-space:pre-wrap;">${item.description ? frappe.utils.escape_html(item.description) : '-'}</td>
		</tr>
	`;
}

function render_manager_review_aluminium_row(item, index, doc) {
	let price_list = doc ? doc.selling_price_list : 'Retail';
	let rate_per_m = item.custom_aluminium_metres ? (item.rate / item.custom_aluminium_metres) : item.rate;
	return `
		<tr>
			<td style="text-align:center;">${index + 1}</td>
			<td style="font-weight:500;">${frappe.utils.escape_html(item.item_name || item.item_code || '')}</td>
			<td style="text-align:center;">${item.custom_aluminium_color ? frappe.utils.escape_html(item.custom_aluminium_color) : '-'}</td>
			<td style="white-space:pre-wrap;">${item.description ? frappe.utils.escape_html(item.description) : '-'}</td>
			<td style="text-align:center;">${item.qty || '-'}</td>
			<td style="text-align:center;">
				<span style="background:var(--subtle-fg);padding:2px 8px;border-radius:6px;font-size:12px;">${price_list}</span>
			</td>
			<td style="text-align:right;">${format_currency(rate_per_m, doc ? doc.currency : 'KES')}</td>
			<td style="text-align:right;font-weight:600;">${format_currency(item.amount, doc ? doc.currency : 'KES')}</td>
		</tr>
	`;
}

function render_manager_review_fittings_row(item, index, doc) {
	let price_list = doc ? doc.selling_price_list : 'Retail';
	return `
		<tr>
			<td style="text-align:center;">${index + 1}</td>
			<td style="font-weight:500;">${frappe.utils.escape_html(item.item_name || item.item_code || '')}</td>
			<td style="white-space:pre-wrap;">${item.description ? frappe.utils.escape_html(item.description) : '-'}</td>
			<td style="text-align:center;">${item.qty || '-'}</td>
			<td style="text-align:center;">
				<span style="background:var(--subtle-fg);padding:2px 8px;border-radius:6px;font-size:12px;">${price_list}</span>
			</td>
			<td style="text-align:right;">${format_currency(item.rate, doc ? doc.currency : 'KES')}</td>
			<td style="text-align:right;font-weight:600;">${format_currency(item.amount, doc ? doc.currency : 'KES')}</td>
		</tr>
	`;
}

function render_manager_review_ceiling_row(item, index, doc, display_amount = null) {
	let price_list = doc ? doc.selling_price_list : 'Retail';
	let quantity = flt(item.custom_ceiling_sq_m || 0);
	let is_bundle = quantity > 0;
	let rate = is_bundle && quantity ? (flt(item.rate || 0) / quantity) : flt(item.rate || 0);
	let amount = display_amount === null ? item.amount : display_amount;
	let components = get_manager_ceiling_component_breakdown(quantity);
	let item_label = get_manager_ceiling_single_label(item);
	let component_cells = QM_CEILING_COMPONENTS.map((component, idx) => {
		if (is_bundle) {
			return format_manager_review_number((components[idx] || {}).qty, 0);
		}

		return item_label === component.label ? format_manager_review_number(item.qty || 0, 0) : '-';
	}).map(value => `<td style="text-align:center;white-space:nowrap;">${value}</td>`).join('');

	return `
		<tr>
			<td style="text-align:center;">${index + 1}</td>
			<td style="font-weight:500;">${frappe.utils.escape_html(item.item_name || item.item_code || '')}</td>
			<td style="text-align:center;">${is_bundle ? format_manager_review_number(quantity) : '-'}</td>
			<td style="text-align:center;white-space:nowrap;">${is_bundle ? 'sft' : '-'}</td>
			${component_cells}
			<td style="text-align:center;">
				<span style="background:var(--subtle-fg);padding:2px 8px;border-radius:6px;font-size:12px;">${price_list}</span>
			</td>
			<td style="text-align:right;">${format_currency(rate, doc ? doc.currency : 'KES')}</td>
			<td style="text-align:right;font-weight:600;">${format_currency(amount, doc ? doc.currency : 'KES')}</td>
		</tr>
	`;
}

function render_manager_review_other_row(item, index, doc, display_amount = null) {
	let category = item.custom_product_category || item.item_group || 'Other';
	let cat_color = {'Fittings':'#e67e22','Rubber':'#8e44ad','Silicone':'#16a085'}[category] || '#7f8c8d';
	let price_list = doc ? doc.selling_price_list : 'Retail';
	let rate = item.rate;
	let amount = display_amount === null ? item.amount : display_amount;
	return `
		<tr>
			<td style="text-align:center;">${index + 1}</td>
			<td>
				<span style="background:${cat_color}20;color:${cat_color};padding:3px 10px;border-radius:10px;font-size:12px;font-weight:600;">${category}</span>
			</td>
			<td style="font-weight:500;">${frappe.utils.escape_html(item.item_name || item.item_code || '')}</td>
			<td style="white-space:pre-wrap;">${item.description ? frappe.utils.escape_html(item.description) : '-'}</td>
			<td style="text-align:center;">${item.qty || '-'}</td>
			<td style="text-align:center;">
				<span style="background:var(--subtle-fg);padding:2px 8px;border-radius:6px;font-size:12px;">${price_list}</span>
			</td>
			<td style="text-align:right;">${format_currency(rate, doc ? doc.currency : 'KES')}</td>
			<td style="text-align:right;font-weight:600;">${format_currency(amount, doc ? doc.currency : 'KES')}</td>
		</tr>
	`;
}

frappe.pages['quotation-manager'].on_page_show = function(wrapper) {
	let page = wrapper.page || (wrapper.control ? wrapper.control.page : null);
	
	if (!page) {
		// Fallback: try to find the page object if it wasn't attached
		page = $(wrapper).data('page');
	}

	let route = frappe.get_route();
	let quotation_name = route[1] || (frappe.get_route_options() ? frappe.get_route_options().quotation : null);

	if (!quotation_name) {
		$(wrapper).find('.layout-main-section').html(`
			<div class="msg-box" style="padding: 40px; text-align: center; color: var(--text-muted);">
				<div style="font-size: 48px; margin-bottom: 20px;">📄</div>
				<h3>No Quotation Selected</h3>
				<p>Please select a quotation from the list or generate a new one from the Builder.</p>
				<div style="margin-top: 20px;">
					<button class="btn btn-primary" onclick="frappe.set_route('quotations')">View All Quotations</button>
					<button class="btn btn-default" onclick="frappe.set_route('quotation-builder')">Open Builder</button>
				</div>
			</div>
		`);
		return;
	}

	render_quotation_dashboard(page, quotation_name, wrapper);
};

function render_quotation_dashboard(page, quotation_name, wrapper) {
	let $body = page ? $(page.body) : $(wrapper).find('.layout-main-section');
	$body.html('<div style="padding: 40px; text-align: center;"><span class="spinner"></span> Loading Quotation Details...</div>');

	frappe.db.get_doc('Quotation', quotation_name).then(async doc => {
		if (page) page.set_title(`Quotation: ${doc.name}`);
		
		let state_color = {
			'Draft': 'orange',
			'Open': 'blue',
			'Converted': 'green',
			'Ordered': 'green',
			'Lost': 'red',
			'Cancelled': 'darkgrey'
		}[doc.status] || 'grey';

		// Fetch linked Sales Orders (kept for legacy quotations created before direct invoicing)
		let sales_orders = await frappe.db.get_list('Sales Order', {
			filters: { 'items.prevdoc_docname': quotation_name },
			fields: ['name', 'status', 'docstatus']
		});

		let so_names = sales_orders.map(so => so.name);
		let sales_invoices = await frappe.db.get_list('Sales Invoice', {
			filters: { custom_source_quotation: quotation_name },
			fields: ['name', 'status', 'docstatus']
		});

		if (so_names.length > 0) {
			// Keep legacy Sales Order-linked invoices visible too.
			let linked_sales_invoices = await frappe.db.get_list('Sales Invoice', {
				filters: { 'items.sales_order': ['in', so_names] },
				fields: ['name', 'status', 'docstatus']
			});
			let invoice_map = {};
			[...(sales_invoices || []), ...(linked_sales_invoices || [])].forEach(invoice => {
				invoice_map[invoice.name] = invoice;
			});
			sales_invoices = Object.values(invoice_map);
		}

		let existing_job_card = await get_existing_job_card_for_quotation(quotation_name);
		let subtotal_amount = get_manager_quotation_subtotal(doc);
		let tax_amount = get_manager_quotation_tax(doc);
		let total_amount = get_manager_quotation_total(doc);
		let manual_items = doc.items.filter(item => !item.custom_auto_generated);
		let glass_items = manual_items.filter(i => i.custom_product_category === 'Glass');
		let aluminium_items = manual_items.filter(i => i.custom_product_category === 'Aluminium');
		let fittings_items = manual_items.filter(i => i.custom_product_category === 'Fittings');
		let ceiling_items = manual_items.filter(i => i.custom_product_category === 'Ceiling');
		let other_items = manual_items.filter(i =>
			!['Glass', 'Aluminium', 'Fittings', 'Ceiling'].includes(i.custom_product_category)
		);

		let service_rows_by_parent = {};
		doc.items.forEach(item => {
			if (!item.custom_auto_generated) return;
			let parent_idx = item.custom_parent_row_idx;
			if (!service_rows_by_parent[parent_idx]) {
				service_rows_by_parent[parent_idx] = [];
			}
			service_rows_by_parent[parent_idx].push(item);
		});

		let get_item_total = (item) => {
			let child_rows = service_rows_by_parent[item.idx] || [];
			return item.amount + child_rows.reduce((sum, child) => sum + (child.amount || 0), 0);
		};

		let glass_total = glass_items.reduce((s, i) => s + get_item_total(i), 0);
		let aluminium_total = aluminium_items.reduce((s, i) => s + get_item_total(i), 0);
		let fittings_total = fittings_items.reduce((s, i) => s + get_item_total(i), 0);
		let ceiling_total = ceiling_items.reduce((s, i) => s + get_item_total(i), 0);
		let other_total = other_items.reduce((s, i) => s + get_item_total(i), 0);

		let glass_html = '';
		if (glass_items.length) {
			glass_html = `
				<div style="margin-bottom:24px;">
					<h5 style="margin:0 0 10px 0;font-size:15px;font-weight:600;color:#3498db;display:flex;align-items:center;gap:8px;">
						<span style="background:#3498db20;padding:3px 10px;border-radius:10px;font-size:12px;">🔷</span> Glass Items
						<span style="margin-left:auto;font-size:13px;color:var(--text-muted);font-weight:500;">Subtotal: ${format_currency(glass_total, doc.currency)}</span>
					</h5>
					<div class="qm-table-wrap">
						<table class="qm-table qm-review-table" style="background:var(--card-bg); margin-bottom:0;">
							<thead>
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
									<th style="text-align:center;white-space:nowrap;">No</th>
									<th style="text-align:center;white-space:nowrap;">WIDTH</th>
									<th style="text-align:center;white-space:nowrap;">HEIGHT</th>
									<th style="text-align:center;white-space:nowrap;">Pcs</th>
									<th style="white-space:nowrap;">Glass Type</th>
									<th style="white-space:nowrap;">Description</th>
								</tr>
							</thead>
							<tbody>
								${glass_items.map((i, index) => render_manager_review_glass_row(i, index)).join('')}
							</tbody>
						</table>
					</div>
				</div>
			`;
		}

		let aluminium_html = '';
		if (aluminium_items.length) {
			aluminium_html = `
				<div style="margin-bottom:24px;">
					<h5 style="margin:0 0 10px 0;font-size:15px;font-weight:600;color:#95a5a6;display:flex;align-items:center;gap:8px;">
						<span style="background:#95a5a620;padding:3px 10px;border-radius:10px;font-size:12px;">⬜</span> Aluminium Items
						<span style="margin-left:auto;font-size:13px;color:var(--text-muted);font-weight:500;">Subtotal: ${format_currency(aluminium_total, doc.currency)}</span>
					</h5>
					<div class="qm-table-wrap">
						<table class="qm-table qm-review-table" style="background:var(--card-bg); margin-bottom:0; min-width:800px;">
							<thead>
								<tr>
									<th style="text-align:center;white-space:nowrap;">No</th>
									<th style="white-space:nowrap;">Item</th>
									<th style="text-align:center;white-space:nowrap;">Color</th>
									<th style="white-space:nowrap;">Description</th>
									<th style="text-align:center;white-space:nowrap;">Pcs</th>
									<th style="text-align:center;white-space:nowrap;">Price List</th>
									<th style="text-align:right;white-space:nowrap;">Rate/m</th>
									<th style="text-align:right;white-space:nowrap;">Amount</th>
								</tr>
							</thead>
							<tbody>
								${aluminium_items.map((i, index) => render_manager_review_aluminium_row(i, index, doc)).join('')}
							</tbody>
						</table>
					</div>
				</div>
			`;
		}

		let fittings_html = '';
		if (fittings_items.length) {
			fittings_html = `
				<div style="margin-bottom:24px;">
					<h5 style="margin:0 0 10px 0;font-size:15px;font-weight:600;color:#e67e22;display:flex;align-items:center;gap:8px;">
						<span style="background:#e67e2220;padding:3px 10px;border-radius:10px;font-size:12px;">🔶</span> Fittings Items
						<span style="margin-left:auto;font-size:13px;color:var(--text-muted);font-weight:500;">Subtotal: ${format_currency(fittings_total, doc.currency)}</span>
					</h5>
					<div class="qm-table-wrap">
						<table class="qm-table qm-review-table" style="background:var(--card-bg); margin-bottom:0; min-width:800px;">
							<thead>
								<tr>
									<th style="text-align:center;white-space:nowrap;">No</th>
									<th style="white-space:nowrap;">Item</th>
									<th style="white-space:nowrap;">Description</th>
									<th style="text-align:center;white-space:nowrap;">Qty</th>
									<th style="text-align:center;white-space:nowrap;">Price List</th>
									<th style="text-align:right;white-space:nowrap;">Rate</th>
									<th style="text-align:right;white-space:nowrap;">Amount</th>
								</tr>
							</thead>
							<tbody>
								${fittings_items.map((i, index) => render_manager_review_fittings_row(i, index, doc)).join('')}
							</tbody>
						</table>
					</div>
				</div>
			`;
		}

		let ceiling_html = '';
		if (ceiling_items.length) {
			ceiling_html = `
				<div style="margin-bottom:24px;">
					<h5 style="margin:0 0 10px 0;font-size:15px;font-weight:600;color:#2ecc71;display:flex;align-items:center;gap:8px;">
						<span style="background:#2ecc7120;padding:3px 10px;border-radius:10px;font-size:12px;">🟩</span> Ceiling Items
						<span style="margin-left:auto;font-size:13px;color:var(--text-muted);font-weight:500;">Subtotal: ${format_currency(ceiling_total, doc.currency)}</span>
					</h5>
					<div class="qm-table-wrap">
						<table class="qm-table qm-review-table" style="background:var(--card-bg); margin-bottom:0; min-width:1180px;">
							<thead>
								<tr>
									<th style="text-align:center;white-space:nowrap;">No</th>
									<th style="white-space:nowrap;">Item</th>
									<th style="text-align:center;white-space:nowrap;">Quantity</th>
									<th style="text-align:center;white-space:nowrap;">UOM</th>
									${QM_CEILING_COMPONENTS.map(component => `<th style="text-align:center;white-space:nowrap;">${frappe.utils.escape_html(component.label)}</th>`).join('')}
									<th style="text-align:center;white-space:nowrap;">Price List</th>
									<th style="text-align:right;white-space:nowrap;">Rate</th>
									<th style="text-align:right;white-space:nowrap;">Amount</th>
								</tr>
							</thead>
							<tbody>
								${ceiling_items.map((i, index) => render_manager_review_ceiling_row(i, index, doc, get_item_total(i))).join('')}
							</tbody>
						</table>
					</div>
				</div>
			`;
		}

		let other_html = '';
		if (other_items.length) {
			other_html = `
				<div style="margin-bottom:24px;">
					<h5 style="margin:0 0 10px 0;font-size:15px;font-weight:600;color:#e67e22;display:flex;align-items:center;gap:8px;">
						<span style="background:#e67e2220;padding:3px 10px;border-radius:10px;font-size:12px;">🔶</span> Other Items
						<span style="margin-left:auto;font-size:13px;color:var(--text-muted);font-weight:500;">Subtotal: ${format_currency(other_total, doc.currency)}</span>
					</h5>
					<div class="qm-table-wrap">
						<table class="qm-table qm-review-table" style="background:var(--card-bg); margin-bottom:0; min-width:800px;">
							<thead>
								<tr>
									<th style="text-align:center;white-space:nowrap;">No</th>
									<th style="white-space:nowrap;">Category</th>
									<th style="white-space:nowrap;">Item</th>
									<th style="white-space:nowrap;">Description</th>
									<th style="text-align:center;white-space:nowrap;">Qty</th>
									<th style="text-align:center;white-space:nowrap;">Price List</th>
									<th style="text-align:right;white-space:nowrap;">Rate</th>
									<th style="text-align:right;white-space:nowrap;">Amount</th>
								</tr>
							</thead>
							<tbody>
								${other_items.map((i, index) => render_manager_review_other_row(i, index, doc, get_item_total(i))).join('')}
							</tbody>
						</table>
					</div>
				</div>
			`;
		}

		let html = `
		<style>
			.qm-dashboard { max-width: 100%; margin: 0 auto; padding: 20px; font-family: var(--font-stack); }
			.qm-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding: 20px; background: var(--card-bg); border-radius: 8px; box-shadow: var(--shadow-sm); }
			.qm-header h2 { margin: 0; font-size: 20px; }
			.qm-badge { padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
			.qm-badge.orange { background: #fdf3e1; color: #e67e22; }
			.qm-badge.blue { background: #e8f4fd; color: #3498db; }
			.qm-badge.green { background: #eafaf1; color: #2ecc71; }
			.qm-badge.red { background: #fdedec; color: #e74c3c; }
			.qm-badge.darkgrey { background: #f2f3f4; color: #7f8c8d; }
			
			.qm-card { background: var(--card-bg); border-radius: 8px; box-shadow: var(--shadow-sm); margin-bottom: 20px; overflow: hidden; }
			.qm-card-header { padding: 16px 20px; border-bottom: 1px solid var(--border-color); font-weight: 600; font-size: 16px; background: var(--control-bg); }
			.qm-card-body { padding: 20px; }
			
			.qm-info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
			.qm-info-label { font-size: 12px; color: var(--text-muted); margin-bottom: 4px; }
			.qm-info-val { font-size: 14px; font-weight: 500; }
			
			.qm-table-wrap { overflow-x: auto; }
			.qm-review-table { min-width: 1180px; }
			.qm-table { width: 100%; border-collapse: collapse; }
			.qm-table th { background: var(--control-bg); padding: 12px 16px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-align: left; border-bottom: 1px solid var(--border-color); }
			.qm-table td { padding: 12px 16px; border-bottom: 1px solid var(--border-color); font-size: 14px; }
			.qm-table tr:last-child td { border-bottom: none; }
			
			.qm-total-row { display: flex; justify-content: space-between; padding: 16px 20px; background: var(--control-bg); border-top: 1px solid var(--border-color); }
			.qm-total-val { font-size: 20px; font-weight: 700; color: var(--primary); }
			
			.qm-actions { display: flex; gap: 10px; flex-wrap: wrap; }
			.qm-toggle-icon.rotated { transform: rotate(90deg); }

			.qm-workflow-tracker { display: flex; align-items: center; justify-content: space-between; padding: 20px; background: var(--card-bg); border-radius: 8px; box-shadow: var(--shadow-sm); margin-bottom: 20px; }
			.qm-workflow-step { flex: 1; text-align: center; position: relative; }
			.qm-workflow-step:not(:last-child)::after { content: ''; position: absolute; top: 12px; right: -50%; width: 100%; height: 2px; background: var(--border-color); z-index: 1; }
			.qm-workflow-step.active:not(:last-child)::after { background: var(--primary); }
			.qm-workflow-icon { width: 24px; height: 24px; border-radius: 50%; background: var(--border-color); color: white; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; position: relative; z-index: 2; margin-bottom: 8px; }
			.qm-workflow-step.active .qm-workflow-icon { background: var(--primary); }
			.qm-workflow-label { font-size: 12px; font-weight: 600; color: var(--text-muted); }
			.qm-workflow-step.active .qm-workflow-label { color: var(--text-color); }
			.qm-workflow-link { display: block; font-size: 11px; margin-top: 4px; color: var(--primary); text-decoration: none; }
			.qm-workflow-link:hover { text-decoration: underline; }
		</style>

		<div class="qm-dashboard">
			<!-- Workflow Tracker -->
			<div class="qm-workflow-tracker">
				<div class="qm-workflow-step active">
					<div class="qm-workflow-icon">✓</div>
					<div class="qm-workflow-label">Quotation</div>
					<a href="#" onclick="frappe.set_route('Form', 'Quotation', '${doc.name}')" class="qm-workflow-link">${doc.name}</a>
				</div>
				<div class="qm-workflow-step ${sales_orders.length > 0 ? 'active' : ''}">
					<div class="qm-workflow-icon">${sales_orders.length > 0 ? '✓' : '2'}</div>
					<div class="qm-workflow-label">Sales Order</div>
					${sales_orders.map(so => `<a href="#" onclick="frappe.set_route('sales-order-manager', '${so.name}')" class="qm-workflow-link">${so.name}</a>`).join('')}
					${sales_orders.length === 0 ? '<span style="font-size: 11px; color: var(--text-muted);">Pending</span>' : ''}
				</div>
				<div class="qm-workflow-step ${sales_invoices.length > 0 ? 'active' : ''}">
					<div class="qm-workflow-icon">${sales_invoices.length > 0 ? '✓' : '3'}</div>
					<div class="qm-workflow-label">Invoice</div>
					${sales_invoices.map(si => `<a href="#" onclick="frappe.set_route('sales-invoice-manager', '${si.name}')" class="qm-workflow-link">${si.name}</a>`).join('')}
					${sales_invoices.length === 0 ? '<span style="font-size: 11px; color: var(--text-muted);">Pending</span>' : ''}
				</div>
			</div>

			<div class="qm-header">
				<div>
					<h2>${doc.customer_name || doc.party_name}</h2>
					<div style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">Created: ${frappe.datetime.global_date_format(doc.creation)}</div>
				</div>
				<div style="text-align: right;">
					<span class="qm-badge ${state_color}">${doc.status}</span>
				</div>
			</div>

			<div class="qm-card">
				<div class="qm-card-header">Quotation Items</div>
				<div class="qm-card-body" style="padding-bottom: 0;">
					${glass_html}
					${aluminium_html}
					${fittings_html}
					${ceiling_html}
					${other_html}
					${(!glass_html && !aluminium_html && !fittings_html && !ceiling_html && !other_html) ? '<p style="text-align:center;color:var(--text-muted);padding:20px;">No items in this quotation.</p>' : ''}
				</div>
				<div class="qm-total-row" style="display:block;">
					<div style="display:flex; justify-content:space-between; align-items:center; font-size:13px; color:var(--text-muted); text-transform:uppercase; margin-bottom:8px;">
						<span>Subtotal</span>
						<span>${format_currency(subtotal_amount, doc.currency)}</span>
					</div>
					<div style="display:flex; justify-content:space-between; align-items:center; font-size:13px; color:var(--text-muted); text-transform:uppercase; padding-bottom:10px; border-bottom:1px solid var(--border-color);">
						<span>V.A.T (16%)</span>
						<span>${format_currency(tax_amount, doc.currency)}</span>
					</div>
					<div style="display:flex; justify-content:space-between; align-items:end; gap:16px; margin-top:12px;">
						<span style="font-size: 16px; font-weight: 600;">Grand Total</span>
						<span class="qm-total-val">${format_currency(total_amount, doc.currency)}</span>
					</div>
				</div>
			</div>

			<div class="qm-card">
				<div class="qm-card-header">Actions</div>
				<div class="qm-card-body qm-actions">
					${get_action_buttons(doc, sales_orders, sales_invoices, existing_job_card)}
				</div>
			</div>
		</div>
		`;

		$(page.body).html(html);
		bind_action_events(page, doc, sales_orders, sales_invoices, existing_job_card);
	}).catch(err => {
		$(page.body).html(`
			<div class="msg-box" style="padding: 40px; text-align: center; color: var(--text-muted);">
				<h3>Error Loading Quotation</h3>
				<p>${err.message || 'Could not find the specified quotation.'}</p>
				<button class="btn btn-default" onclick="window.history.back()">Go Back</button>
			</div>
		`);
	});
}

function get_action_buttons(doc, sales_orders, sales_invoices, existing_job_card) {
	let buttons = '';
	let has_sales_orders = sales_orders && sales_orders.length > 0;
	let has_sales_invoices = sales_invoices && sales_invoices.length > 0;
	let has_job_card = !!(existing_job_card && existing_job_card.name);

	if (doc.docstatus === 0) { // Draft
		buttons += `
			<button class="btn btn-primary" id="btn-submit-quo">
				<i class="fa fa-check" style="margin-right:6px;"></i>Submit Quotation
			</button>
			<button class="btn btn-default" id="btn-edit-builder">
				<i class="fa fa-pencil" style="margin-right:6px;"></i>Edit in Builder
			</button>
			<button class="btn btn-default" id="btn-print">
				<i class="fa fa-download" style="margin-right:6px;"></i>Download PDF
			</button>
		`;
	} else if (doc.docstatus === 1 && has_sales_invoices) {
		buttons += `
			<button class="btn btn-primary" onclick="frappe.set_route('sales-invoice-manager', '${sales_invoices[0].name}')">
				<i class="fa fa-arrow-right" style="margin-right:6px;"></i>Go to Sales Invoice
			</button>
			<button class="btn btn-default" id="btn-print">
				<i class="fa fa-print" style="margin-right:6px;"></i>Download Quotation
			</button>
			<p style="color:var(--text-muted); width:100%; margin-top:10px; font-size: 13px;">
				This quotation has been <strong>accepted</strong> and invoiced directly.
			</p>
		`;
	} else if (doc.docstatus === 1 && doc.status === 'Open') {
		// Submitted + Open, NO linked Sales Invoice yet
		buttons += `
			<button class="btn btn-primary" id="${has_job_card ? 'btn-view-job-card' : 'btn-create-sales-order'}">
				<i class="fa fa-briefcase" style="margin-right:6px;"></i>${has_job_card ? 'View Job Card' : 'Create Sales Order'}
			</button>
			<button class="btn btn-default" id="btn-print">
				<i class="fa fa-print" style="margin-right:6px;"></i>Print PDF
			</button>
			<button class="btn btn-danger-light" id="btn-mark-lost" style="border:1px solid #e74c3c; color:#e74c3c; background:transparent; margin-left: auto;">
				<i class="fa fa-times" style="margin-right:6px;"></i>Mark as Lost
			</button>
			<p style="color:var(--text-muted); width:100%; margin-top:10px; font-size: 13px;">
				Quotation is <strong>Open</strong> — waiting for customer acceptance. Click <strong>Create Sales Order</strong> when the customer accepts.
			</p>
		`;
		if (has_sales_orders) {
			buttons += `
				<button class="btn btn-default" onclick="frappe.set_route('sales-order-manager', '${sales_orders[0].name}')">
					<i class="fa fa-external-link" style="margin-right:6px;"></i>Open Existing Sales Order
				</button>
			`;
		}
	} else if (doc.docstatus === 1 && doc.status === 'Lost') {
		buttons += `
			<button class="btn btn-default" id="btn-print">
				<i class="fa fa-print" style="margin-right:6px;"></i>Print PDF
			</button>
			<p style="color:var(--text-muted); width:100%; margin-top:10px; font-size: 13px;">
				❌ This quotation was marked as <strong>Lost</strong>.
			</p>
		`;
	} else if (doc.docstatus === 1 && doc.status === 'Expired') {
		buttons += `
			<p style="color:var(--text-muted); width:100%; font-size: 13px;">
				⏰ This quotation has <strong>expired</strong>. You may create a new quotation from the Builder.
			</p>
		`;
	} else if (doc.docstatus === 2) { // Cancelled
		buttons += `
			<p style="color:var(--text-muted); width:100%; font-size: 13px;">
				🚫 This quotation has been <strong>cancelled</strong>.
			</p>
		`;
	}

	return buttons || '<span style="color:var(--text-muted);">No actions available.</span>';
}

function normalize_job_card_payment_mode(value) {
	return String(value || '').trim().toLowerCase() === 'cash customer' || String(value || '').trim().toLowerCase() === 'cash'
		? 'cash'
		: 'invoice';
}

function get_job_card_payment_mode_label(value) {
	return normalize_job_card_payment_mode(value) === 'cash' ? 'Cash Customer' : 'Invoice Customer';
}

function get_job_card_payment_option_choices(payment_mode) {
	return normalize_job_card_payment_mode(payment_mode) === 'cash'
		? ['Cash', 'Paybill', 'Cheque']
		: ['Cheque'];
}

function refresh_job_card_payment_options(dialog) {
	let payment_mode = dialog.get_value('payment_mode');
	let options = get_job_card_payment_option_choices(payment_mode);
	let option_value = options[0] || '';
	dialog.set_df_property('payment_option', 'options', options.join('\n'));
	dialog.set_value('payment_option', option_value);

	let is_invoice = normalize_job_card_payment_mode(payment_mode) === 'invoice';
	dialog.set_df_property('payment_amount', 'hidden', is_invoice ? 1 : 0);
	dialog.set_df_property('balance_amount', 'hidden', is_invoice ? 1 : 0);
	dialog.set_df_property('payment_amount', 'reqd', is_invoice ? 0 : 1);
}

async function get_job_card_customer_defaults(customer_name) {
	if (!customer_name) {
		return {};
	}

	try {
		let customer = await frappe.db.get_doc('Customer', customer_name);
		return {
			customer: customer.name,
			customer_name: customer.customer_name || customer.name,
			customer_pin: customer.tax_id || '',
			phone_number: customer.mobile_no || customer.phone || '',
			payment_mode: customer.tax_id ? 'invoice' : 'cash'
		};
	} catch (e) {
		try {
			let customers = await frappe.db.get_list('Customer', {
				filters: { customer_name: customer_name },
				fields: ['name', 'customer_name', 'tax_id', 'mobile_no', 'phone'],
				limit: 1
			});
			let customer = customers && customers[0];
			return customer ? {
				customer: customer.name,
				customer_name: customer.customer_name || customer.name,
				customer_pin: customer.tax_id || '',
				phone_number: customer.mobile_no || customer.phone || '',
				payment_mode: customer.tax_id ? 'invoice' : 'cash'
			} : {};
		} catch (search_error) {
			return {};
		}
	}
}

function get_quotation_customer_reference(doc) {
	return doc.party_name || doc.customer || doc.customer_name || '';
}

function update_job_card_balance(dialog) {
	let payment_limit = flt(dialog._payment_limit !== undefined && dialog._payment_limit !== null
		? dialog._payment_limit
		: dialog.get_value('quotation_amount') || 0);
	dialog.set_value('balance_amount', payment_limit);
}

function get_job_card_outstanding_balance(job_card, quotation_amount) {
	let total = flt(quotation_amount || 0);
	if (!job_card) {
		return total;
	}

	let balance = flt(job_card.balance_amount || 0);
	let paid = flt(job_card.payment_amount || 0);
	if (balance <= 0 && paid < total) {
		return total - paid;
	}

	return balance;
}

function validate_job_card_payment_amount(dialog) {
	if (normalize_job_card_payment_mode(dialog.get_value('payment_mode')) === 'invoice') {
		return true;
	}

	let payment_limit = flt(dialog._payment_limit !== undefined && dialog._payment_limit !== null
		? dialog._payment_limit
		: dialog.get_value('quotation_amount') || 0, 2);
	let payment_amount = flt(dialog.get_value('payment_amount') || 0, 2);

	if (payment_amount < 0) {
		frappe.msgprint(__('Payment amount cannot be less than zero.'));
		return false;
	}

	if (payment_amount > payment_limit) {
		frappe.msgprint(__('Payment amount cannot exceed the current balance amount of {0}.', [
			format_currency(payment_limit)
		]));
		return false;
	}

	return true;
}

async function get_existing_job_card_for_quotation(quotation) {
	if (!quotation) {
		return null;
	}

	let job_cards = await frappe.db.get_list('CAW Job Card', {
		filters: { quotation: quotation },
		fields: ['name', 'payment_amount', 'balance_amount'],
		order_by: 'creation desc',
		limit: 1
	});

	return job_cards && job_cards.length ? job_cards[0] : null;
}

async function apply_job_card_customer_defaults(dialog) {
	let customer = dialog.get_value('customer');
	// Fallback: read the raw input value if get_value returns empty
	// (Frappe Link controls may not have committed the value yet)
	if (!customer && dialog.fields_dict.customer && dialog.fields_dict.customer.$input) {
		customer = dialog.fields_dict.customer.$input.val();
	}
	if (!customer) return;
	let customer_defaults = await get_job_card_customer_defaults(customer);
	await dialog.set_value('customer_name', customer_defaults.customer_name || '');
	await dialog.set_value('customer_pin', customer_defaults.customer_pin || '');
	await dialog.set_value('phone_number', customer_defaults.phone_number || '');
}

function queue_job_card_customer_defaults(dialog) {
	clearTimeout(dialog._job_card_customer_defaults_timer);
	dialog._job_card_customer_defaults_timer = setTimeout(function() {
		apply_job_card_customer_defaults(dialog);
	}, 300);
}

async function open_job_card_modal(page, doc) {
	let quotation_customer = get_quotation_customer_reference(doc);
	let defaults = await get_job_card_customer_defaults(quotation_customer);
	let existing_job_card = await get_existing_job_card_for_quotation(doc.name);
	let quotation_total = get_manager_quotation_total(doc);
	let payment_limit = get_job_card_outstanding_balance(existing_job_card, quotation_total);
	let d = new frappe.ui.Dialog({
		title: 'Create Sales Order',
		fields: [
			{ fieldtype: 'Section Break', label: 'Customer Details' },
			{
				fieldtype: 'Select',
				fieldname: 'payment_mode',
				label: 'Payment Mode',
				options: 'Cash Customer\nInvoice Customer',
				default: get_job_card_payment_mode_label(defaults.payment_mode),
				reqd: 1,
				change: function() {
					refresh_job_card_payment_options(d);
				}
			},
			{
				fieldtype: 'Select',
				fieldname: 'payment_option',
				label: 'Payment Options',
				options: get_job_card_payment_option_choices(get_job_card_payment_mode_label(defaults.payment_mode)).join('\n'),
				default: get_job_card_payment_option_choices(get_job_card_payment_mode_label(defaults.payment_mode))[0],
				reqd: 1
			},
			{
				fieldtype: 'Link',
				fieldname: 'customer',
				label: 'Customer',
				options: 'Customer',
				default: defaults.customer || quotation_customer,
				reqd: 1,
				change: function() {
					queue_job_card_customer_defaults(d);
				},
				get_query: function() {
					return {
						query: 'crystal_alluminium_works.api.search_builder_customers',
						filters: {
							payment_mode: normalize_job_card_payment_mode(d.get_value('payment_mode'))
						}
					};
				}
			},
			{ fieldtype: 'Column Break' },
			{ fieldtype: 'Data', fieldname: 'customer_name', label: 'Customer Name', default: defaults.customer_name || doc.customer_name || quotation_customer },
			{ fieldtype: 'Data', fieldname: 'customer_pin', label: 'Customer PIN', default: defaults.customer_pin || '' },
			{ fieldtype: 'Data', fieldname: 'phone_number', label: 'Phone Number', default: defaults.phone_number || '' },
			{ fieldtype: 'Section Break', label: 'Payment' },
			{ fieldtype: 'Currency', fieldname: 'quotation_amount', label: 'Quotation Amount', read_only: 1, default: quotation_total },
			{ fieldtype: 'Column Break' },
			{ fieldtype: 'Currency', fieldname: 'payment_amount', label: 'Payment Amount', default: payment_limit, reqd: 1 },
			{ fieldtype: 'Currency', fieldname: 'balance_amount', label: 'Balance', read_only: 1, default: payment_limit }
		],
		primary_action_label: 'Save',
		primary_action: function(values) {
			if (!validate_job_card_payment_amount(d)) {
				return;
			}

			let is_invoice = normalize_job_card_payment_mode(values.payment_mode) === 'invoice';

			frappe.call({
				method: 'crystal_alluminium_works.api.create_job_card_from_quotation',
				args: {
					quotation: doc.name,
					customer: values.customer,
					customer_name: values.customer_name,
					payment_mode: normalize_job_card_payment_mode(values.payment_mode),
					payment_option: values.payment_option,
					customer_pin: values.customer_pin,
					phone_number: values.phone_number,
					quotation_amount: values.quotation_amount,
					payment_amount: is_invoice ? 0 : values.payment_amount,
					balance_amount: is_invoice ? values.quotation_amount : values.balance_amount
				},
				freeze: true,
				freeze_message: 'Creating Job Card...',
				callback: function(r) {
					if (r.message) {
						d.hide();
						frappe.show_alert({ message: `Job Card ${r.message} created`, indicator: 'green' });
						frappe.set_route('job-cards');
					}
				}
			});
		}
	});

	d._payment_limit = payment_limit;
	d.show();
	refresh_job_card_payment_options(d);
	if (defaults.customer || quotation_customer) {
		await d.set_value('customer', defaults.customer || quotation_customer);
	}
	update_job_card_balance(d);

	d.fields_dict.payment_amount.$input.on('input', function() {
		update_job_card_balance(d);
	});

	d.fields_dict.payment_mode.$input.on('change', function() {
		refresh_job_card_payment_options(d);
		d.set_value('customer', '');
		d.set_value('customer_name', '');
		d.set_value('customer_pin', '');
		d.set_value('phone_number', '');
	});

	d.fields_dict.customer.$input.on('awesomplete-selectcomplete', function() {
		// Use a longer delay for awesomplete selection to ensure the Link
		// control has committed the selected value before we read it
		clearTimeout(d._job_card_customer_defaults_timer);
		d._job_card_customer_defaults_timer = setTimeout(function() {
			apply_job_card_customer_defaults(d);
		}, 500);
	});
}

function bind_action_events(page, doc, sales_orders, sales_invoices, existing_job_card) {
	// ── Edit in Builder (Draft only) ──
	$('#btn-edit-builder').on('click', async () => {
		let customer_meta = doc.party_name
			? await frappe.db.get_value('Customer', doc.party_name, 'tax_id')
			: null;
		let payment_mode = customer_meta && customer_meta.message && customer_meta.message.tax_id ? 'invoice' : 'cash';

		// Pre-populate the builder state from the existing quotation, then navigate
		window.qb_state = {
			customer: doc.party_name || doc.customer_name,
			payment_mode: payment_mode,
			items: [],
			step: 2, // Go straight to items step
			editing_quotation: doc.name // Track that we are editing an existing quotation
		};

			let glass_type_by_item_code = {};
			let glass_item_codes = [...new Set(
				doc.items
					.filter(item => !item.custom_auto_generated && (item.custom_product_category || item.item_group || '') === 'Glass' && item.item_code)
					.map(item => item.item_code)
			)];

			if (glass_item_codes.length) {
				let item_docs = await frappe.db.get_list('Item', {
					filters: { name: ['in', glass_item_codes] },
					fields: ['name', 'custom_glass_type'],
					limit: glass_item_codes.length
				});
				glass_type_by_item_code = (item_docs || []).reduce((acc, row) => {
					acc[row.name] = row.custom_glass_type || 'Ordinary';
					return acc;
				}, {});
			}

			let service_rows_by_parent = {};
			doc.items.forEach(item => {
				if (!item.custom_auto_generated) return;
				let parent_idx = item.custom_parent_row_idx;
				if (!service_rows_by_parent[parent_idx]) {
					service_rows_by_parent[parent_idx] = [];
				}
				service_rows_by_parent[parent_idx].push(item);
			});

			// Convert quotation items back into builder format (skip auto-generated rows)
			for (const item of doc.items) {
				if (item.custom_auto_generated) continue; // Skip service rows

				let category = item.custom_product_category || item.item_group || '';
				let aluminium_metres = item.custom_aluminium_metres || 0;
				let ceiling_sq_m = item.custom_ceiling_sq_m || 0;
				let glass_area_sqft = flt(item.custom_area_sqft || 0);
				let child_rows = service_rows_by_parent[item.idx] || [];
				let glass_type = category === 'Glass' ? (glass_type_by_item_code[item.item_code] || 'Ordinary') : '';
				let sheet_details = await get_sheet_builder_details(item, glass_type);
				let display_amount = item.amount + child_rows.reduce((sum, child) => sum + (child.amount || 0), 0);
				let builder_item = {
					id: frappe.utils.get_random(8),
					category: category,
				item_code: item.item_code,
				item_name: item.item_name,
				uom: item.uom || '',
				description: item.description || '',
				price_list: doc.selling_price_list || 'Retail',
				qty: item.qty,
				pcs: item.custom_glass_sale_mode === 'Sheet' ? sheet_details.pcs : item.qty,
				metres: aluminium_metres || 1,
				aluminium_color: item.custom_aluminium_color || '',
				quantity: ceiling_sq_m || 0,
				square_metres: ceiling_sq_m || 0,
				ceiling_mode: ceiling_sq_m ? 'bundle' : 'single',
				rate: category === 'Aluminium' && aluminium_metres
					? (item.rate / aluminium_metres)
					: (category === 'Ceiling' && ceiling_sq_m
						? (item.rate / ceiling_sq_m)
						: (category === 'Glass' ? get_builder_glass_base_rate(item) : item.rate)),
					amount: display_amount,
					// Glass-specific
					sale_mode: item.custom_glass_sale_mode || 'Resized',
					glass_mode: item.custom_glass_sale_mode === 'Sheet' ? 'Sheet' : 'Cut Size',
				width_mm: item.custom_width_mm || 0,
				height_mm: item.custom_height_mm || 0,
				width_allowance: item.custom_width_allowance || 0,
				height_allowance: item.custom_height_allowance || 0,
				base_width_ft: item.custom_base_width_ft || (item.custom_width_ft ? item.custom_width_ft - (item.custom_width_allowance || 0) : 0),
				base_height_ft: item.custom_base_height_ft || (item.custom_height_ft ? item.custom_height_ft - (item.custom_height_allowance || 0) : 0),
				width_ft: item.custom_width_ft || 0,
				height_ft: item.custom_height_ft || 0,
				area_sqft: item.custom_area_sqft || 0,
				perimeter_rft: item.custom_perimeter_rft || 0,
					sheet_size: item.custom_glass_sale_mode === 'Sheet' ? sheet_details.sheet_size : '',
					sheet_sft: item.custom_glass_sale_mode === 'Sheet' ? sheet_details.sheet_sft : 0,
					polishing: item.custom_polishing || 0,
					polish_width_sides: item.custom_polish_width_sides || (item.custom_polishing ? 2 : 0),
					polish_height_sides: item.custom_polish_height_sides || (item.custom_polishing ? 2 : 0),
					polish_type: item.custom_polish_type || '4-6',
					holes: item.custom_holes || 0,
					hole_type: item.custom_hole_type || '5mm',
					notches: item.custom_notches || 0,
					notch_type: item.custom_notch_type || 'Standard',
					numbering: item.custom_numbering || '',
					sandblast_type: item.custom_sandblast_type || 'None',
					glass_type: glass_type,
					glass_type_filter: glass_type,
					glass_breakdown: category === 'Glass'
						? [
							{
								label: 'Base Material',
								qty: ['Full Sheet', 'Sheet'].includes(item.custom_glass_sale_mode) ? item.qty : (glass_area_sqft * item.qty),
								rate: get_builder_glass_base_rate(item),
								amount: item.amount
							},
							...child_rows.map(child => ({
								label: child.item_name || child.item_code,
								qty: child.qty,
								rate: child.rate,
								amount: child.amount
							}))
						]
						: []
				};
				window.qb_state.items.push(builder_item);
			}

		frappe.set_route('quotation-builder');
	});

	// ── Submit Quotation (Draft → Open) ──
	$('#btn-submit-quo').on('click', () => {
		frappe.confirm(
			'<b>Submit this quotation?</b><br><br>Once submitted, the quotation becomes official and can no longer be directly edited. You can still amend it if needed.',
			() => {
				frappe.call({
					method: 'crystal_alluminium_works.api.submit_quotation',
					args: { name: doc.name },
					freeze: true,
					freeze_message: 'Submitting Quotation...',
					callback: function(r) {
						if (!r.exc) {
							frappe.show_alert({message: 'Quotation Submitted — now Open', indicator: 'green'});
							render_quotation_dashboard(page, doc.name);
						}
					}
				});
			}
		);
	});

	$('#btn-create-sales-order').on('click', () => {
		open_job_card_modal(page, doc);
	});

	$('#btn-view-job-card').on('click', () => {
		if (existing_job_card && existing_job_card.name) {
			frappe.set_route('job-card-detail', existing_job_card.name);
		}
	});



	// ── Mark as Lost ──
	$('#btn-mark-lost').on('click', () => {
		let d = new frappe.ui.Dialog({
			title: 'Mark Quotation as Lost',
			fields: [
				{
					label: 'Reason for Lost',
					fieldname: 'reason',
					fieldtype: 'Small Text',
					reqd: 1,
					description: 'Why did the customer decline this quotation?'
				}
			],
			primary_action_label: 'Set as Lost',
			primary_action: function(values) {
				frappe.call({
					method: 'erpnext.selling.doctype.quotation.quotation.set_status',
					args: {
						status: 'Lost',
						name: doc.name,
						reason: values.reason
					},
					freeze: true,
					callback: function(r) {
						if (!r.exc) {
							frappe.show_alert({message: 'Quotation marked as Lost', indicator: 'red'});
							d.hide();
							render_quotation_dashboard(page, doc.name);
						}
					}
				});
			}
		});
		d.show();
	});

	// ── Print PDF ──
	$('#btn-print').on('click', () => {
		let print_url = frappe.urllib.get_full_url(
			`/api/method/crystal_alluminium_works.api.download_crystal_quotation_pdf?name=${encodeURIComponent(doc.name)}`
		);
		window.open(print_url, '_blank');
	});
}
