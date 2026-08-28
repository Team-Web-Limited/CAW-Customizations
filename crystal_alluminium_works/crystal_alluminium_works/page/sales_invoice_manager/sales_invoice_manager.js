frappe.pages['sales-invoice-manager'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Sales Invoice Manager',
		single_column: true,
	});

	page.set_secondary_action('Back', function() {
		window.history.back();
	});

	wrapper.page = page;
	load_ceiling_board_item_codes();
};

const SALES_INVOICE_VAT_RATE = 0.16;
const SALES_INVOICE_CEILING_COMPONENTS = [
	{ label: 'Board', ratio: 0.36, mode: 'divide' },
	{ label: 'MainT', ratio: 0.25, mode: 'multiply' },
	{ label: 'Sub Cross 4ft', ratio: 1.33, mode: 'multiply' },
	{ label: 'Sub Cross 2ft', ratio: 1.33, mode: 'multiply' },
	{ label: 'Wall angle', ratio: 0.25, mode: 'multiply' }
];
// Loaded from crystal_alluminium_works.api.get_ceiling_board_item_codes on page load —
// see CEILING_BOARD_ITEM_CODES in pricing_engine.py for the single source of truth.
// Seeded with the known codes as a fallback in case something renders before the fetch resolves.
let SALES_INVOICE_CEILING_BOARD_ITEM_CODES = new Set(['AMC', 'AGC']);

function load_ceiling_board_item_codes() {
	frappe.call({
		method: 'crystal_alluminium_works.api.get_ceiling_board_item_codes',
		callback: function (r) {
			SALES_INVOICE_CEILING_BOARD_ITEM_CODES = new Set(r.message || []);
		}
	});
}

function get_sales_invoice_route_context() {
	let route = frappe.get_route();
	let route_options = typeof frappe.get_route_options === 'function'
		? frappe.get_route_options()
		: (frappe.route_options || {});

	return {
		invoice_name: route[1] || route_options.sales_invoice || null,
		default_payment_mode: route[2] || route_options.payment_mode || null
	};
}

function sales_invoice_is_ceiling_bundle(item) {
	return flt(item.custom_ceiling_sq_m || 0) > 0;
}

function sales_invoice_is_ceiling_board_item(item) {
	return SALES_INVOICE_CEILING_BOARD_ITEM_CODES.has((item.item_code || '').trim());
}

function get_sales_invoice_ceiling_single_label(item) {
	if (sales_invoice_is_ceiling_board_item(item)) {
		return 'Board';
	}

	return (item.item_name || item.item_code || '').trim();
}

function get_sales_invoice_ceiling_review_config(items) {
	let has_bundle = (items || []).some(sales_invoice_is_ceiling_bundle);
	if (has_bundle) {
		return {
			has_bundle: true,
			show_quantity: true,
			show_uom: true,
			columns: SALES_INVOICE_CEILING_COMPONENTS.map(component => ({
				label: component.label,
				key: component.label,
				bundle_component: true
			}))
		};
	}

	let seen = new Set();
	let columns = [];
	(items || []).forEach(item => {
		let label = get_sales_invoice_ceiling_single_label(item);
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

function get_sales_invoice_ceiling_component_qty(item, column, child_rows) {
	let quantity = flt(item.custom_ceiling_sq_m || 0);
	if (!quantity) {
		return '-';
	}

	if (column.key === 'Board') {
		return Math.trunc(quantity / 0.36);
	}

	let component_row = (child_rows || []).find(child =>
		(child.item_code || child.item_name || '').trim() === column.key
	);
	if (component_row) {
		return Math.trunc(flt(component_row.qty || 0));
	}
	return '-';
}

function get_sales_invoice_item_uom_label(item) {
	if (item.custom_product_category === 'Glass' && item.custom_glass_sale_mode === 'Full Sheet') {
		return 'Nos';
	}

	if (item.uom) {
		return item.uom;
	}

	if (item.custom_product_category === 'Ceiling') {
		return 'Square Meter';
	}

	if (item.custom_product_category === 'Glass') {
		return 'Square Foot';
	}

	if (item.custom_product_category === 'Aluminium') {
		return 'Nos';
	}

	return '';
}

function get_sales_invoice_item_uom_qty(item) {
	if (item.custom_product_category === 'Aluminium') {
		// Sold per whole piece; qty is the piece count.
		return flt(item.qty || 0);
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

function get_sales_invoice_breakdown_label(label, parent_item) {
	let display = (label || '').trim().replace(/^Glass\s+/i, '');

	if (/sandblasting/i.test(display) && !/\(/.test(display) && parent_item.custom_sandblast_type) {
		display = `${display} (${parent_item.custom_sandblast_type})`;
	}

	return display || (label || '');
}

function get_sales_invoice_breakdown_uom(label, parent_item) {
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

function format_sales_invoice_review_number(value, precision = 3) {
	let number = flt(value || 0);
	let rounded = parseFloat(number.toFixed(precision));
	return Number.isFinite(rounded) ? rounded : 0;
}

function get_sales_invoice_polish_sides_label(item) {
	let total = cint(item.custom_polish_width_sides || 0) + cint(item.custom_polish_height_sides || 0);
	return total ? `Polish ${total} side${total === 1 ? '' : 's'}` : '';
}

function render_sales_invoice_glass_row(item, index) {
	if (item.custom_glass_sale_mode === 'Sheet' || item.custom_glass_sale_mode === 'Full Sheet') {
		let pieces = flt(item.custom_sheet_pcs || item.qty || 0);
		let t_sft = flt(item.qty || item.custom_sheet_sft || 0);
		if (item.custom_glass_sale_mode === 'Full Sheet') {
			t_sft = flt(item.custom_sheet_sft || 0) * flt(item.qty || 0);
		} else if (item.custom_product_category === 'Glass' && item.custom_glass_sale_mode === 'Sheet') {
			t_sft = flt(item.qty || item.custom_sheet_sft || 0);
		}

		return `
			<tr>
				<td style="text-align:center; white-space:nowrap;">-</td>
				<td style="text-align:center; white-space:nowrap;">-</td>
				<td style="text-align:center; white-space:nowrap;">-</td>
				<td style="text-align:center; white-space:nowrap;">-</td>
				<td style="text-align:center; white-space:nowrap;">-</td>
				<td style="text-align:center; white-space:nowrap;">-</td>
				<td style="text-align:center; white-space:nowrap;">-</td>
				<td style="text-align:center; white-space:nowrap;">${format_sales_invoice_review_number(t_sft)}</td>
				<td style="white-space:nowrap;">-</td>
				<td style="text-align:center; white-space:nowrap;">${index + 1}</td>
				<td style="text-align:center; white-space:nowrap;">-</td>
				<td style="text-align:center; white-space:nowrap;">-</td>
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
			<td style="text-align:center; white-space:nowrap;">${format_sales_invoice_review_number(item.custom_base_width_ft || item.custom_width_ft || 0)}</td>
			<td style="text-align:center; white-space:nowrap;">${format_sales_invoice_review_number(item.custom_base_height_ft || item.custom_height_ft || 0)}</td>
			<td style="text-align:center; white-space:nowrap;">${format_sales_invoice_review_number(item.custom_width_allowance || 0)}</td>
			<td style="text-align:center; white-space:nowrap;">${format_sales_invoice_review_number(item.custom_height_allowance || 0)}</td>
			<td style="text-align:center; white-space:nowrap;">${format_sales_invoice_review_number(pw)}</td>
			<td style="text-align:center; white-space:nowrap;">${format_sales_invoice_review_number(ph)}</td>
			<td style="text-align:center; white-space:nowrap;">${format_sales_invoice_review_number(item.custom_perimeter_rft || 0)}</td>
			<td style="text-align:center; white-space:nowrap;">${format_sales_invoice_review_number(item.custom_area_sqft || 0)}</td>
			<td style="white-space:nowrap;">${get_sales_invoice_polish_sides_label(item) || '-'}</td>
			<td style="text-align:center; white-space:nowrap;">${index + 1}</td>
			<td style="text-align:center; white-space:nowrap;">${format_sales_invoice_review_number(item.custom_width_mm || 0, 0)}</td>
			<td style="text-align:center; white-space:nowrap;">${format_sales_invoice_review_number(item.custom_height_mm || 0, 0)}</td>
			<td style="text-align:center; white-space:nowrap;">${pieces || '-'}</td>
			<td style="font-weight:500; white-space:nowrap;">${frappe.utils.escape_html(item.item_name || item.item_code || '')}</td>
			<td style="white-space:pre-wrap;">${item.description ? frappe.utils.escape_html(item.description) : '-'}</td>
		</tr>
	`;
}

function render_sales_invoice_aluminium_row(item, index, doc) {
	let price_list = doc ? doc.selling_price_list : 'Retail';
	let rate_per_m = item.rate;  // rate is per whole piece
	return `
		<tr>
			<td style="text-align:center;">${index + 1}</td>
			<td style="font-weight:500;">${frappe.utils.escape_html(item.item_name || item.item_code || '')}</td>
			<td style="text-align:center;">${item.custom_aluminium_color ? frappe.utils.escape_html(item.custom_aluminium_color) : '-'}</td>
			<td style="white-space:pre-wrap;">${item.description ? frappe.utils.escape_html(item.description) : '-'}</td>
			<td style="text-align:center;">${item.qty || '-'}</td>
			<td style="text-align:center;">${format_sales_invoice_review_number(item.qty || 0)}</td>
			<td style="text-align:center;">
				<span style="background:var(--subtle-fg);padding:2px 8px;border-radius:6px;font-size:12px;">${price_list}</span>
			</td>
			<td style="text-align:right;">${format_currency(rate_per_m, doc ? doc.currency : 'KES')}</td>
			<td style="text-align:right;font-weight:600;">${format_currency(item.amount, doc ? doc.currency : 'KES')}</td>
		</tr>
	`;
}

function render_sales_invoice_fittings_row(item, index, doc) {
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

function render_sales_invoice_other_row(item, index, doc) {
	let category = item.custom_product_category || item.item_group || 'Other';
	let cat_color = {'Fittings':'#e67e22','Rubber':'#8e44ad','Silicone':'#16a085'}[category] || '#7f8c8d';
	let price_list = doc ? doc.selling_price_list : 'Retail';
	let rate = item.rate;
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
			<td style="text-align:right;font-weight:600;">${format_currency(item.amount, doc ? doc.currency : 'KES')}</td>
		</tr>
	`;
}

function render_sales_invoice_ceiling_row(item, index, doc, ceiling_review, service_rows_by_parent) {
	let is_bundle = sales_invoice_is_ceiling_bundle(item);
	let child_rows = service_rows_by_parent[item.idx] || [];
	let ceiling_quantity = flt(item.custom_ceiling_sq_m || 0);
	let item_label = get_sales_invoice_ceiling_single_label(item);
	let price_list = item.custom_price_list || (doc ? doc.selling_price_list : 'Retail');
	let rate = is_bundle && ceiling_quantity ? item.rate / ceiling_quantity : item.rate;
	let amount = item.amount + child_rows.reduce((sum, child) => sum + (child.amount || 0), 0);
	let uom = get_sales_invoice_item_uom_label(item);

	if (is_bundle || sales_invoice_is_ceiling_board_item(item)) {
		uom = uom || 'Square Meter';
	} else {
		uom = uom || 'Nos';
	}

	let ceiling_cells = ceiling_review.columns.map(column => {
		if (is_bundle) {
			return `<td style="text-align:center;white-space:nowrap;">${get_sales_invoice_ceiling_component_qty(item, column, child_rows)}</td>`;
		}

		return `<td style="text-align:center;white-space:nowrap;">${item_label === column.key ? format_sales_invoice_review_number(item.qty || 0, 0) : '-'}</td>`;
	}).join('');

	return `
		<tr>
			<td style="text-align:center;">${index + 1}</td>
			<td style="font-weight:500;">${frappe.utils.escape_html(item.item_name || item.item_code || '')}</td>
			<td style="text-align:center;">${format_sales_invoice_review_number(item.qty || 0, 2)}</td>
			${ceiling_review.show_quantity ? `<td style="text-align:center;">${is_bundle ? format_sales_invoice_review_number(ceiling_quantity) : '-'}</td>` : ''}
			${ceiling_review.show_uom ? `<td style="text-align:center;white-space:nowrap;">${frappe.utils.escape_html(uom)}</td>` : ''}
			${ceiling_cells}
			<td style="text-align:center;">
				<span style="background:var(--subtle-fg);padding:2px 8px;border-radius:6px;font-size:12px;">${frappe.utils.escape_html(price_list)}</span>
			</td>
			<td style="text-align:right;">${format_currency(rate, doc ? doc.currency : 'KES')}</td>
			<td style="text-align:right;font-weight:600;">${format_currency(amount, doc ? doc.currency : 'KES')}</td>
		</tr>
	`;
}

function download_sales_invoice_pdf(docname) {
	const print_url = frappe.urllib.get_full_url(
		`/api/method/crystal_alluminium_works.api.download_crystal_sales_invoice_pdf?name=${encodeURIComponent(docname)}`
	);

	window.open(print_url, '_blank');
}

function get_sales_invoice_total_for_payment(doc) {
	return flt(doc.grand_total || 0);
}

function sales_invoice_uses_visual_vat(doc) {
	return flt(doc.total_taxes_and_charges || 0) === 0;
}

function get_sales_invoice_display_total(doc) {
	let total = get_sales_invoice_total_for_payment(doc);
	return sales_invoice_uses_visual_vat(doc) ? flt(total * (1 + SALES_INVOICE_VAT_RATE)) : total;
}

function get_sales_invoice_display_outstanding(doc) {
	let outstanding = flt(doc.outstanding_amount || 0);
	return sales_invoice_uses_visual_vat(doc) ? flt(outstanding * (1 + SALES_INVOICE_VAT_RATE)) : outstanding;
}

function get_sales_invoice_display_tax_total(doc) {
	if (!sales_invoice_uses_visual_vat(doc)) {
		return flt(doc.total_taxes_and_charges || 0);
	}

	return flt(get_sales_invoice_total_for_payment(doc) * SALES_INVOICE_VAT_RATE);
}

function sales_invoice_is_unpaid_state(doc) {
	return ['Unpaid', 'Overdue'].includes(doc.status || '');
}

function get_sales_invoice_paid_amount(doc) {
	if (doc.docstatus !== 1) {
		return 0;
	}

	if (sales_invoice_is_unpaid_state(doc)) {
		return 0;
	}

	let total = get_sales_invoice_display_total(doc);
	let outstanding = get_sales_invoice_display_outstanding(doc);
	return Math.max(0, flt(total - outstanding));
}

function get_sales_invoice_display_paid_amount(doc, source_job_card) {
	// A partial invoice is a final receipt for only the released items.  The
	// linked Job Card still carries the balance for the entire quotation, so
	// using its cumulative figures here makes this invoice appear underpaid.
	if (source_job_card && !cint(doc.custom_is_partial)) {
		return flt(source_job_card.payment_amount || 0);
	}

	return doc.docstatus === 1 ? get_sales_invoice_paid_amount(doc) : 0;
}

function get_sales_invoice_outstanding_for_ui(doc, source_job_card) {
	if (source_job_card && !cint(doc.custom_is_partial)) {
		return flt(source_job_card.balance_amount || 0);
	}

	if (doc.docstatus !== 1 || sales_invoice_is_unpaid_state(doc)) {
		return get_sales_invoice_display_total(doc);
	}

	return get_sales_invoice_display_outstanding(doc);
}

function get_sales_invoice_workflow_job_card_state(source_job_card) {
	let has_job_card = !!(source_job_card && source_job_card.name);

	return {
		is_complete: has_job_card,
		icon: has_job_card ? '✓' : '2',
		link_html: has_job_card
			? `<a href="#" onclick="frappe.set_route('job-card-detail', '${source_job_card.name}')" class="sim-link">${source_job_card.name}</a>`
			: '<span style="font-size: 11px; color: var(--text-muted);">Not linked</span>'
	};
}

function get_sales_invoice_payment_method_display(source_job_card) {
	if (!source_job_card) {
		return '—';
	}

	let payment_methods = Array.isArray(source_job_card.payment_methods)
		? source_job_card.payment_methods.filter(Boolean)
		: [];

	if (payment_methods.length) {
		return payment_methods.join(', ');
	}

	return source_job_card.payment_option || '—';
}

frappe.pages['sales-invoice-manager'].on_page_show = function(wrapper) {
	let page = wrapper.page || (wrapper.control ? wrapper.control.page : null);

	if (!page) {
		page = $(wrapper).data('page');
	}

	let route_context = get_sales_invoice_route_context();
	let invoice_name = route_context.invoice_name;
	let default_payment_mode = route_context.default_payment_mode;

	if (!invoice_name) {
		$(wrapper).find('.layout-main-section').html(`
			<div class="msg-box" style="padding: 40px; text-align: center; color: var(--text-muted);">
				<h3>No Sales Invoice Selected</h3>
				<p>Please select a Sales Invoice from the custom list.</p>
				<div style="margin-top: 20px;">
					<button class="btn btn-primary" onclick="frappe.set_route('sales-invoices')">View Sales Invoices</button>
				</div>
			</div>
		`);
		return;
	}

	render_sales_invoice_dashboard(page, invoice_name, wrapper, default_payment_mode);
};

async function render_sales_invoice_dashboard(page, invoice_name, wrapper, default_payment_mode) {
	let $body = page ? $(page.body) : $(wrapper).find('.layout-main-section');
	$body.html('<div style="padding: 40px; text-align: center;"><span class="spinner"></span> Loading Sales Invoice...</div>');

	try {
		const doc = await frappe.db.get_doc('Sales Invoice', invoice_name);
		const source_job_card_response = await frappe.call({
			method: 'crystal_alluminium_works.api.get_sales_invoice_source_job_card',
			args: { invoice_name: doc.name },
		});
		const source_job_card = source_job_card_response.message || null;
		if (page) {
			page.set_title(`Sales Invoice: ${doc.name}`);
		}

		const quotation_name = doc.custom_source_quotation || null;
		const workflow_job_card = get_sales_invoice_workflow_job_card_state(source_job_card);
		const manual_items = (doc.items || []).filter(item => !item.custom_auto_generated);
		const glass_items = manual_items.filter(i => i.custom_product_category === 'Glass');
		const aluminium_items = manual_items.filter(i => i.custom_product_category === 'Aluminium');
		const fittings_items = manual_items.filter(i => i.custom_product_category === 'Fittings');
		const ceiling_items = manual_items.filter(i => i.custom_product_category === 'Ceiling');
		const other_items = manual_items.filter(i =>
			!['Glass', 'Aluminium', 'Fittings', 'Ceiling'].includes(i.custom_product_category)
		);

		let service_rows_by_parent = {};
		(doc.items || []).forEach(item => {
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
					<div class="sim-table-wrap">
						<table class="sim-table sim-review-table" style="background:var(--card-bg); margin-bottom:0;">
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
								${glass_items.map((i, index) => render_sales_invoice_glass_row(i, index)).join('')}
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
					<div class="sim-table-wrap">
						<table class="sim-table sim-review-table" style="background:var(--card-bg); margin-bottom:0; min-width:800px;">
							<thead>
								<tr>
									<th style="text-align:center;white-space:nowrap;">No</th>
									<th style="white-space:nowrap;">Item</th>
									<th style="text-align:center;white-space:nowrap;">Color</th>
									<th style="white-space:nowrap;">Description</th>
									<th style="text-align:center;white-space:nowrap;">Qty</th>
									<th style="text-align:center;white-space:nowrap;">Pieces</th>
									<th style="text-align:center;white-space:nowrap;">Price List</th>
									<th style="text-align:right;white-space:nowrap;">Rate</th>
									<th style="text-align:right;white-space:nowrap;">Amount</th>
								</tr>
							</thead>
							<tbody>
								${aluminium_items.map((i, index) => render_sales_invoice_aluminium_row(i, index, doc)).join('')}
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
					<div class="sim-table-wrap">
						<table class="sim-table sim-review-table" style="background:var(--card-bg); margin-bottom:0; min-width:800px;">
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
								${fittings_items.map((i, index) => render_sales_invoice_fittings_row(i, index, doc)).join('')}
							</tbody>
						</table>
					</div>
				</div>
			`;
		}

		let ceiling_html = '';
		if (ceiling_items.length) {
			let ceiling_review = get_sales_invoice_ceiling_review_config(ceiling_items);
			ceiling_html = `
				<div style="margin-bottom:24px;">
					<h5 style="margin:0 0 10px 0;font-size:15px;font-weight:600;color:#2ecc71;display:flex;align-items:center;gap:8px;">
						<span style="background:#2ecc7120;padding:3px 10px;border-radius:10px;font-size:12px;">🟩</span> Ceiling Items
						<span style="margin-left:auto;font-size:13px;color:var(--text-muted);font-weight:500;">Subtotal: ${format_currency(ceiling_total, doc.currency)}</span>
					</h5>
					<div class="sim-table-wrap">
						<table class="sim-table sim-review-table" style="background:var(--card-bg); margin-bottom:0; min-width:900px;">
							<thead>
								<tr>
									<th style="text-align:center;white-space:nowrap;">No</th>
									<th style="white-space:nowrap;">Item</th>
									<th style="text-align:center;white-space:nowrap;">Qty</th>
									${ceiling_review.show_quantity ? '<th style="text-align:center;white-space:nowrap;">Quantity</th>' : ''}
									${ceiling_review.show_uom ? '<th style="text-align:center;white-space:nowrap;">UOM</th>' : ''}
									${ceiling_review.columns.map(column => `<th style="text-align:center;white-space:nowrap;">${frappe.utils.escape_html(column.label)}</th>`).join('')}
									<th style="text-align:center;white-space:nowrap;">Price List</th>
									<th style="text-align:right;white-space:nowrap;">Rate</th>
									<th style="text-align:right;white-space:nowrap;">Amount</th>
								</tr>
							</thead>
							<tbody>
								${ceiling_items.map((i, index) => render_sales_invoice_ceiling_row(i, index, doc, ceiling_review, service_rows_by_parent)).join('')}
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
					<div class="sim-table-wrap">
						<table class="sim-table sim-review-table" style="background:var(--card-bg); margin-bottom:0; min-width:800px;">
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
								${other_items.map((i, index) => render_sales_invoice_other_row(i, index, doc)).join('')}
							</tbody>
						</table>
					</div>
				</div>
			`;
		}

		let html = `
		<style>
			.sim-dashboard { max-width: 100%; margin: 0 auto; padding: 20px; font-family: var(--font-stack); }
			.sim-badge { padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
			.sim-badge.orange { background: #fdf3e1; color: #e67e22; }
			.sim-badge.blue { background: #e8f4fd; color: #3498db; }
			.sim-badge.green { background: #eafaf1; color: #2ecc71; }
			.sim-badge.red { background: #fdedec; color: #e74c3c; }
			.sim-badge.purple { background: #f4ecf7; color: #8e44ad; }
			.sim-badge.grey { background: #f2f3f4; color: #7f8c8d; }
			.sim-card { background: var(--card-bg); border-radius: 8px; box-shadow: var(--shadow-sm); margin-bottom: 20px; overflow: hidden; }
			.sim-card-header { padding: 16px 20px; border-bottom: 1px solid var(--border-color); font-weight: 600; font-size: 16px; background: var(--control-bg); }
			.sim-card-body { padding: 20px; }
			.sim-info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 18px; }
			.sim-info-label { font-size: 12px; color: var(--text-muted); margin-bottom: 4px; }
			.sim-info-val { font-size: 14px; font-weight: 500; }
			.sim-table-wrap { overflow-x: auto; }
			.sim-review-table { min-width: 1180px; }
			.sim-table { width: 100%; border-collapse: collapse; }
			.sim-table th { background: var(--control-bg); padding: 12px 16px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-align: left; border-bottom: 1px solid var(--border-color); }
			.sim-table td { padding: 12px 16px; border-bottom: 1px solid var(--border-color); font-size: 14px; }
			.sim-table tr:last-child td { border-bottom: none; }
			.sim-total-breakdown { border-top: 1px solid var(--border-color); background: var(--control-bg); }
			.sim-subtotal-row { display: flex; justify-content: space-between; padding: 8px 20px; font-size: 14px; color: var(--text-muted); }
			.sim-subtotal-row:first-child { padding-top: 16px; }
			.sim-total-row { display: flex; justify-content: space-between; padding: 16px 20px; background: var(--control-bg); border-top: 1px solid var(--border-color); margin-top: 8px; }
			.sim-total-val { font-size: 20px; font-weight: 700; color: var(--primary); }
			.sim-actions { display: flex; gap: 10px; flex-wrap: wrap; }
			.sim-action-note { width: 100%; display: flex; align-items: center; padding: 8px 10px; border-radius: 6px; background: #fff7e6; color: #8a5a00; font-size: 13px; }
			.sim-toggle-icon.rotated { transform: rotate(90deg); }
			.sim-workflow { display: flex; align-items: center; justify-content: space-between; padding: 20px; background: var(--card-bg); border-radius: 8px; box-shadow: var(--shadow-sm); margin-bottom: 20px; gap: 12px; flex-wrap: wrap; }
			.sim-step { flex: 1; text-align: center; position: relative; min-width: 160px; }
			.sim-step:not(:last-child)::after { content: ''; position: absolute; top: 12px; right: -50%; width: 100%; height: 2px; background: var(--border-color); z-index: 1; }
			.sim-step.active:not(:last-child)::after { background: var(--primary); }
			.sim-icon { width: 24px; height: 24px; border-radius: 50%; background: var(--border-color); color: white; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; position: relative; z-index: 2; margin-bottom: 8px; }
			.sim-step.active .sim-icon { background: var(--primary); }
			.sim-label { font-size: 12px; font-weight: 600; color: var(--text-muted); }
			.sim-step.active .sim-label { color: var(--text-color); }
			.sim-link { display: block; font-size: 11px; margin-top: 4px; color: var(--primary); text-decoration: none; }
			.sim-link:hover { text-decoration: underline; }
		</style>

		<div class="sim-dashboard">
			<div class="sim-workflow">
				<div class="sim-step ${quotation_name ? 'active' : ''}">
					<div class="sim-icon">${quotation_name ? '✓' : '1'}</div>
					<div class="sim-label">Quotation</div>
					${quotation_name ? `<a href="#" onclick="frappe.set_route('quotation-manager', '${quotation_name}')" class="sim-link">${quotation_name}</a>` : '<span style="font-size: 11px; color: var(--text-muted);">Not linked</span>'}
				</div>
				<div class="sim-step ${workflow_job_card.is_complete ? 'active' : ''}">
					<div class="sim-icon">${workflow_job_card.icon}</div>
					<div class="sim-label">Job Card</div>
					${workflow_job_card.link_html}
				</div>
				<div class="sim-step active">
					<div class="sim-icon">✓</div>
					<div class="sim-label">Sales Invoice</div>
					<a href="#" onclick="frappe.set_route('Form', 'Sales Invoice', '${doc.name}')" class="sim-link">${doc.name}</a>
				</div>
			</div>

			<div class="sim-card">
				<div class="sim-card-header" style="display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap;">Invoice Summary <span style="font-size:13px; font-weight:400; color:var(--text-muted);">Created ${frappe.datetime.str_to_user(doc.creation)}</span></div>
				<div class="sim-card-body">
					<div class="sim-info-grid">
						<div>
							<div class="sim-info-label">Customer</div>
							<div class="sim-info-val">${doc.customer || '—'}</div>
						</div>
						<div>
							<div class="sim-info-label">Grand Total</div>
							<div class="sim-info-val">${format_currency(get_sales_invoice_display_total(doc), doc.currency || 'KES')}</div>
						</div>
						<div>
							<div class="sim-info-label">Tax Total</div>
							<div class="sim-info-val">${format_currency(get_sales_invoice_display_tax_total(doc), doc.currency || 'KES')}</div>
						</div>
						<div>
							<div class="sim-info-label">Amount Paid</div>
							<div class="sim-info-val">${format_currency(get_sales_invoice_display_paid_amount(doc, source_job_card), doc.currency || 'KES')}</div>
						</div>
						<div>
							<div class="sim-info-label">Outstanding</div>
							<div class="sim-info-val">${format_currency(get_sales_invoice_outstanding_for_ui(doc, source_job_card), doc.currency || 'KES')}</div>
						</div>
						<div>
							<div class="sim-info-label">Method of Payment</div>
							<div class="sim-info-val">${frappe.utils.escape_html(get_sales_invoice_payment_method_display(source_job_card))}</div>
						</div>
						<div>
							<div class="sim-info-label">Invoice Status</div>
							<div class="sim-info-val">${doc.status || 'Draft'}</div>
						</div>
						<div>
							<div class="sim-info-label">Quotation Source</div>
							<div class="sim-info-val">${quotation_name || '—'}</div>
						</div>
					</div>
				</div>
			</div>

			<div class="sim-card">
				<div class="sim-card-header">Invoice Items</div>
				<div class="sim-card-body" style="padding-bottom: 0;">
					${glass_html}
					${aluminium_html}
					${fittings_html}
					${ceiling_html}
					${other_html}
					${(!glass_html && !aluminium_html && !fittings_html && !ceiling_html && !other_html) ? '<p style="text-align:center;color:var(--text-muted);padding:20px;">No items in this invoice.</p>' : ''}
				</div>
				<div class="sim-total-breakdown">
					<div class="sim-subtotal-row">
						<span>Subtotal</span>
						<span>${format_currency(get_sales_invoice_display_total(doc) - get_sales_invoice_display_tax_total(doc), doc.currency || 'KES')}</span>
					</div>
					<div class="sim-subtotal-row">
						<span>VAT (16%)</span>
						<span>${format_currency(get_sales_invoice_display_tax_total(doc), doc.currency || 'KES')}</span>
					</div>
					<div class="sim-total-row">
						<span style="font-size: 16px; font-weight: 600;">Grand Total</span>
						<span class="sim-total-val">${format_currency(get_sales_invoice_display_total(doc), doc.currency || 'KES')}</span>
					</div>
				</div>
			</div>

			<div class="sim-card">
				<div class="sim-card-header">Actions</div>
				<div class="sim-card-body sim-actions">
					${get_sales_invoice_action_buttons(doc, quotation_name)}
				</div>
			</div>
		</div>
		`;

		$(page.body).html(html);
		bind_sales_invoice_action_events(page, doc);
	} catch (err) {
		$(page.body).html(`
			<div class="msg-box" style="padding: 40px; text-align: center; color: var(--text-muted);">
				<h3>Error Loading Sales Invoice</h3>
				<p>${err.message || 'Could not find the specified Sales Invoice.'}</p>
				<button class="btn btn-default" onclick="window.history.back()">Go Back</button>
			</div>
		`);
	}
}

function get_sales_invoice_action_buttons(doc, quotation_name) {
	let buttons = `
		<button class="btn btn-default" id="btn-download-invoice">
			<i class="fa fa-download" style="margin-right:6px;"></i>Download PDF
		</button>
	`;

	if (quotation_name) {
		buttons += `
			<button class="btn btn-default" id="btn-open-quotation" data-name="${quotation_name}">
				<i class="fa fa-file-text-o" style="margin-right:6px;"></i>Open Quotation
			</button>
		`;
	}

	if (doc.docstatus === 0) {
		buttons += `
			<button class="btn btn-primary" id="btn-submit-invoice">
				<i class="fa fa-check" style="margin-right:6px;"></i>Submit Invoice
			</button>
		`;
	} else if (doc.docstatus === 1) {
		const paid_amount = get_sales_invoice_paid_amount(doc);
		const outstanding = flt(doc.outstanding_amount || 0);
		const is_job_card_invoice = !!doc.custom_source_job_card;

		// Credit Note / Return button hidden by user request
		/*
		if (!doc.is_return) {
			buttons += `
				<button class="btn btn-default" id="btn-credit-note">
					<i class="fa fa-reply" style="margin-right:6px;"></i>Credit Note / Return
				</button>
			`;
		}
		*/

		if (frappe.user.has_role('System Manager') && !doc.is_return && !doc.amended_from) {
			buttons += `
				<button class="btn btn-default" id="btn-edit-invoice-items">
					<i class="fa fa-pencil" style="margin-right:6px;"></i>Edit Items
				</button>
			`;
		}

		if (is_job_card_invoice || paid_amount <= 0) {
			// Job-card invoices (incl. fully-paid POS-settled ones) can be cancelled —
			// cancel_sales_invoice reverses the GL and the job-card payment impact.
			buttons += `
				<button class="btn btn-danger" id="btn-cancel-invoice" style="margin-left: auto;">
					<i class="fa fa-ban" style="margin-right:6px;"></i>Cancel Invoice
				</button>
			`;
		} else if (outstanding > 0) {
			buttons += `
				<button class="btn btn-danger" id="btn-cancel-blocked" title="Cancel linked payments before cancelling this invoice." style="margin-left: auto;">
					<i class="fa fa-ban" style="margin-right:6px;"></i>Cancel Invoice
				</button>
			`;
		}
	} else if (doc.docstatus === 2) {
		buttons += `
			<button class="btn btn-primary" id="btn-amend-invoice">
				<i class="fa fa-pencil-square-o" style="margin-right:6px;"></i>Amend Invoice
			</button>
		`;
	}

	return buttons;
}

function bind_sales_invoice_action_events(page, doc) {
	const $body = $(page.body);

	$body.find('#btn-download-invoice').on('click', () => {
		download_sales_invoice_pdf(doc.name);
	});

	$body.find('#btn-open-quotation').on('click', function() {
		let name = $(this).data('name');
		if (name) {
			frappe.set_route('quotation-manager', name);
		}
	});

	$body.find('#btn-submit-invoice').on('click', () => {
		frappe.confirm('Submit this Sales Invoice? It will remain non-stock and become financially active.', () => {
			frappe.call({
				method: 'crystal_alluminium_works.api.submit_sales_invoice',
				args: { name: doc.name },
				freeze: true,
				freeze_message: 'Submitting invoice...',
				callback: function(r) {
					if (!r.exc) {
						frappe.show_alert({ message: `Sales Invoice ${r.message} submitted`, indicator: 'green' });
						render_sales_invoice_dashboard(page, doc.name);
					}
				},
			});
		});
	});

	$body.find('#btn-cancel-invoice').on('click', () => {
		frappe.confirm('Cancel this Sales Invoice? This will reverse the accounting impact.', () => {
			frappe.call({
				method: 'crystal_alluminium_works.api.cancel_sales_invoice',
				args: { name: doc.name },
				freeze: true,
				freeze_message: 'Cancelling invoice...',
				callback: function(r) {
					if (!r.exc) {
						frappe.show_alert({ message: `Sales Invoice ${r.message} cancelled`, indicator: 'green' });
						render_sales_invoice_dashboard(page, doc.name);
					}
				},
			});
		});
	});

	$body.find('#btn-cancel-blocked').on('click', () => {
		frappe.msgprint({
			title: __('Cannot Cancel Invoice Yet'),
			indicator: 'orange',
			message: __('Cancel linked payments before cancelling this invoice.'),
		});
	});

	// ── Credit Note / Sales Return (monetary corrections) [Disabled] ──
	/*
	$body.find('#btn-credit-note').on('click', () => {
		frappe.confirm(
			'Create a Credit Note / Sales Return against this invoice?<br><br>Use this to correct <b>rates</b> (keep quantities) or to reverse <b>returned goods</b>. Adjust the return, then submit it.',
			() => {
				frappe.call({
					method: 'erpnext.accounts.doctype.sales_invoice.sales_invoice.make_sales_return',
					args: { source_name: doc.name },
					freeze: true,
					freeze_message: 'Creating credit note...',
					callback: function(r) {
						if (r.exc || !r.message) return;
						const ret = r.message;
						frappe.model.sync(ret);
						frappe.set_route('Form', 'Sales Invoice', ret.name);
					},
				});
			}
		);
	});
	*/

	// ── Edit Items on a submitted invoice (total locked, stock auto-adjusted) ──
	$body.find('#btn-edit-invoice-items').on('click', () => {
		frappe.call({
			method: 'crystal_alluminium_works.api.get_invoice_edit_eligibility',
			args: { name: doc.name },
			freeze: true,
			callback: function(r) {
				if (r.exc) return;
				const elig = r.message || {};
				if (!elig.can_edit) {
					frappe.msgprint({
						title: 'Cannot Edit Invoice',
						indicator: 'red',
						message: '<ul><li>' + (elig.reasons || ['Not eligible.']).join('</li><li>') + '</li></ul>',
					});
					return;
				}
				open_edit_invoice_items_dialog(page, doc);
			},
		});
	});

	// ── Amend Invoice (administrative fields only) ──
	$body.find('#btn-amend-invoice').on('click', () => {
		frappe.call({
			method: 'crystal_alluminium_works.api.get_invoice_amendment_eligibility',
			args: { name: doc.name },
			freeze: true,
			callback: function(r) {
				if (r.exc) return;
				const elig = r.message || {};
				if (!elig.can_amend) {
					frappe.msgprint({
						title: 'Cannot Amend Invoice',
						indicator: 'red',
						message: '<ul><li>' + (elig.reasons || ['Not eligible.']).join('</li><li>') + '</li></ul>',
					});
					return;
				}
				frappe.call({
					method: 'crystal_alluminium_works.api.amend_sales_invoice',
					args: { name: doc.name },
					freeze: true,
					freeze_message: 'Creating amendment...',
					callback: async function(a) {
						if (a.exc || !a.message) return;
						const draft = await frappe.db.get_doc('Sales Invoice', a.message);
						open_amend_invoice_dialog(page, draft);
					},
				});
			},
		});
	});
}

function open_amend_invoice_dialog(page, draft) {
	const d = new frappe.ui.Dialog({
		title: `Amend Invoice — ${draft.name}`,
		fields: [
			{ fieldtype: 'HTML', options: '<p style="color:var(--text-muted);font-size:12px;">Only administrative fields can change. For money, quantity or tax corrections use a Credit Note / Return.</p>' },
			{ fieldtype: 'Section Break' },
			{ label: 'Posting Date', fieldname: 'posting_date', fieldtype: 'Date', default: draft.posting_date },
			{ fieldtype: 'Column Break' },
			{ label: 'Due Date', fieldname: 'due_date', fieldtype: 'Date', default: draft.due_date },
			{ fieldtype: 'Section Break' },
			{ label: 'Customer PO / Reference', fieldname: 'po_no', fieldtype: 'Data', default: draft.po_no },
			{ label: 'Remarks', fieldname: 'remarks', fieldtype: 'Small Text', default: draft.remarks },
			{ label: 'Terms', fieldname: 'terms', fieldtype: 'Text Editor', default: draft.terms },
		],
		primary_action_label: 'Save & Submit',
		primary_action: function(values) {
			frappe.call({
				method: 'crystal_alluminium_works.api.update_and_submit_amended_invoice',
				args: {
					name: draft.name,
					posting_date: values.posting_date,
					due_date: values.due_date,
					po_no: values.po_no,
					remarks: values.remarks,
					terms: values.terms,
				},
				freeze: true,
				freeze_message: 'Submitting amended invoice...',
				callback: function(r) {
					if (r.exc) return;
					d.hide();
					frappe.show_alert({ message: `Amended invoice ${r.message} submitted`, indicator: 'green' });
					render_sales_invoice_dashboard(page, r.message);
				},
			});
		},
	});
	d.show();
	d.$wrapper.find('.modal-body').css({
		height: 'min(560px, calc(100vh - 180px))',
		overflowY: 'auto',
	});
}

function open_edit_invoice_items_dialog(page, doc) {
	const esc = frappe.utils.escape_html;
	const manual_rows = (doc.items || []).filter(it => !it.custom_auto_generated);
	const original_total = manual_rows.reduce((s, it) => s + flt(it.amount), 0);
	const currency = doc.currency || 'KES';

	// Working copy of the editable rows. Qty edits scale the row's driving
	// quantity fields proportionally, mirroring the server's partial scaling.
	// Pristine row built straight from the invoice item — also used by the per-row "Clear"
	// button to discard any edits and restore the original values.
	function make_row(it) {
		return {
			row_name: it.name,
			item_code: it.item_code,
			item_name: it.item_name || it.item_code,
			category: it.custom_product_category || '',
			orig_qty: flt(it.qty),
			qty: flt(it.qty),
			rate: flt(it.rate),
			orig: it,
		};
	}

	const rows = manual_rows.map(make_row);

	// Amount shown per row: a freshly-added builder item carries builder_amount (the net
	// composite the pricing engine will produce, incl. its glass/ceiling service rows), which
	// qty×rate cannot represent for glass/ceiling. Once the user edits qty/rate inline we drop
	// the override and fall back to qty×rate so their rebalancing stays truthful.
	function row_amount(r) {
		return (r.builder_amount != null) ? flt(r.builder_amount) : flt(r.qty) * flt(r.rate);
	}

	const ALUMINIUM_LABEL_TO_PL = {
		'Normal Price': 'Retail', 'Mill Finished Price': 'Wholesale', 'Special Price': 'Special',
		'Retail': 'Retail', 'Wholesale': 'Wholesale', 'Special': 'Special',
	};

	const BUILDER_CATEGORIES = ['Aluminium', 'Glass', 'Fittings', 'Ceiling', 'Rubber', 'Silicone'];

	// Mirror of api.create_quotation_from_builder: turn a CAWItemBuilder item into an invoice
	// row + the custom fields the server's edit re-prices from (INVOICE_EDIT_ITEM_FIELDS).
	function builder_item_to_row(item) {
		const category = item.category;
		let backend_pl;
		if (category === 'Ceiling') backend_pl = item.ceiling_mode === 'bundle' ? 'Wholesale' : 'Retail';
		else if (category === 'Aluminium') backend_pl = ALUMINIUM_LABEL_TO_PL[item.price_list] || 'Retail';
		else backend_pl = item.price_list || 'Retail';

		let qty = flt(item.qty || 1);
		let rate = flt(item.rate || 0) / 1.16;
		const customs = { custom_price_list: backend_pl, custom_product_category: category };

		if (category === 'Glass') {
			const sale_mode = item.sale_mode || 'Resized';
			const pws = cint(item.polish_width_sides || 0);
			const phs = cint(item.polish_height_sides || 0);
			const sandblast = item.sandblast_type || '';
			Object.assign(customs, {
				custom_glass_sale_mode: sale_mode,
				custom_width_mm: item.width_mm || 0,
				custom_height_mm: item.height_mm || 0,
				custom_base_width_ft: item.base_width_ft || 0,
				custom_base_height_ft: item.base_height_ft || 0,
				custom_width_ft: item.width_ft || 0,
				custom_height_ft: item.height_ft || 0,
				custom_width_allowance: item.width_allowance || 0,
				custom_height_allowance: item.height_allowance || 0,
				custom_area_sqft: sale_mode === 'Sheet' ? 0 : (item.area_sqft || 0),
				custom_perimeter_rft: item.perimeter_rft || 0,
				custom_polishing: (item.polishing || pws > 0 || phs > 0) ? 1 : 0,
				custom_polish_width_sides: pws,
				custom_polish_height_sides: phs,
				custom_polish_type: item.polish_type || '4-6',
				custom_holes: cint(item.holes || 0),
				custom_hole_type: item.hole_type || '5mm',
				custom_notches: cint(item.notches || 0),
				custom_notch_type: item.notch_type || 'Standard',
				custom_sandblast_type: sandblast === 'None' ? '' : sandblast,
				custom_numbering: item.numbering || '',
				custom_sheet_size: sale_mode === 'Sheet' ? (item.sheet_size || '') : '',
				custom_sheet_sft: sale_mode === 'Sheet' ? flt(item.sheet_sft || 0) : 0,
				custom_sheet_pcs: sale_mode === 'Sheet' ? flt(item.pcs || 0) : 0,
			});
		} else if (category === 'Aluminium') {
			customs.custom_aluminium_metres = qty;
			customs.custom_aluminium_color = item.aluminium_color || null;
		} else if (category === 'Ceiling') {
			if (item.ceiling_mode === 'bundle') {
				const sqm = flt(item.quantity || item.square_metres || 100);
				qty = 1;
				rate = sqm * flt(item.rate || 0);
				customs.custom_ceiling_sq_m = sqm;
			} else {
				customs.custom_ceiling_sq_m = 0;
			}
		}

		return {
			row_name: null,
			item_code: item.item_code,
			item_name: item.item_name || item.item_code,
			category: category,
			orig_qty: 0,
			qty: qty,
			rate: rate,
			orig: {},
			customs: customs,
			builder_amount: flt(item.amount || 0),
			builder_item: item,
		};
	}

	const ALUMINIUM_PL_TO_LABEL = {
		'Retail': 'Normal Price', 'Wholesale': 'Mill Finished Price', 'Special': 'Special Price',
	};

	// Reverse of builder_item_to_row: reconstruct a CAWItemBuilder item from a table row so the
	// builder modal can reopen pre-filled. Session-added rows keep their exact builder_item;
	// pre-existing invoice rows are rebuilt from their stored custom fields (r.orig).
	function row_to_builder_item(r) {
		if (r.builder_item) return r.builder_item;
		const o = r.orig || {};
		const category = r.category;
		const item = {
			id: 'caw-edit-' + (r.row_name || Math.random().toString(36).slice(2, 8)),
			category: category,
			item_code: r.item_code,
			item_name: r.item_name || r.item_code,
			description: o.description || '',
			qty: flt(r.qty) || 1,
			rate: flt(r.rate) * 1.16, // invoice stores net; the modal shows/uses gross
			amount: 0,
			dimension_uom: 'mm', // width/height are stored in mm
			price_list: o.custom_price_list || 'Retail',
		};

		if (category === 'Glass') {
			const sale_mode = o.custom_glass_sale_mode || 'Resized';
			Object.assign(item, {
				sale_mode: sale_mode,
				glass_mode: sale_mode === 'Sheet' ? 'Sheet' : 'Cut Size',
				glass_type: '', glass_type_filter: '',
				width_mm: flt(o.custom_width_mm), height_mm: flt(o.custom_height_mm),
				base_width_ft: flt(o.custom_base_width_ft), base_height_ft: flt(o.custom_base_height_ft),
				width_ft: flt(o.custom_width_ft), height_ft: flt(o.custom_height_ft),
				width_allowance: flt(o.custom_width_allowance), height_allowance: flt(o.custom_height_allowance),
				area_sqft: flt(o.custom_area_sqft), perimeter_rft: flt(o.custom_perimeter_rft),
				polishing: cint(o.custom_polishing), polish_width_sides: cint(o.custom_polish_width_sides),
				polish_height_sides: cint(o.custom_polish_height_sides), polish_type: o.custom_polish_type || '4-6',
				holes: cint(o.custom_holes), hole_type: o.custom_hole_type || '5mm',
				notches: cint(o.custom_notches), notch_type: o.custom_notch_type || 'Standard',
				sandblast_type: o.custom_sandblast_type || 'None', numbering: o.custom_numbering || '',
				sheet_size: o.custom_sheet_size || '', sheet_sft: flt(o.custom_sheet_sft), pcs: flt(o.custom_sheet_pcs),
			});
			if (sale_mode === 'Sheet') item.price_list = 'Wholesale';
		} else if (category === 'Aluminium') {
			item.price_list = ALUMINIUM_PL_TO_LABEL[o.custom_price_list] || 'Normal Price';
			item.aluminium_color = o.custom_aluminium_color || '';
			item.metres = 1;
		} else if (category === 'Ceiling') {
			const sqm = flt(o.custom_ceiling_sq_m);
			item.ceiling_mode = sqm > 0 ? 'bundle' : 'single';
			item.quantity = sqm || 0;
			item.square_metres = sqm || 0;
		}
		return item;
	}

	const d = new frappe.ui.Dialog({
		title: `Edit Items — ${doc.name}`,
		size: 'extra-large',
		fields: [{ fieldtype: 'HTML', fieldname: 'items_html' }],
		primary_action_label: 'Save Changes',
		primary_action: function() {
			const payload = rows.map(r => {
				const row = { row_name: r.row_name, item_code: r.item_code, qty: r.qty, rate: r.rate };
				if (r.customs) {
					// Added or edited via the builder — carry item identity + all the category
					// fields the server re-prices glass/ceiling from. Works for both new rows
					// (row_name null) and edited existing rows (row_name preserved).
					row.item_name = r.item_name;
					row.custom_product_category = r.category;
					Object.assign(row, r.customs);
				} else if (!r.row_name) {
					row.item_name = r.item_name;
					row.custom_product_category = r.category;
				} else if (r.orig_qty > 0 && Math.abs(r.qty - r.orig_qty) > 0.0001) {
					const ratio = r.qty / r.orig_qty;
					['custom_aluminium_metres', 'custom_ceiling_sq_m', 'custom_sheet_pcs'].forEach(f => {
						if (flt(r.orig[f])) row[f] = flt(r.orig[f]) * ratio;
					});
				}
				return row;
			});
			frappe.confirm(
				'Save these item changes? The grand total stays locked and stock will be auto-adjusted where possible.',
				() => {
					frappe.call({
						method: 'crystal_alluminium_works.api.edit_submitted_invoice_items',
						args: { name: doc.name, items: JSON.stringify(payload) },
						freeze: true,
						freeze_message: 'Saving invoice edits...',
						callback: function(r) {
							if (r.exc) return;
							d.hide();
							const res = r.message || {};
							if ((res.warnings || []).length) {
								frappe.msgprint({
									title: 'Saved with Warnings',
									indicator: 'orange',
									message: '<ul><li>' + res.warnings.join('</li><li>') + '</li></ul>',
								});
							}
							frappe.show_alert({ message: `Invoice ${doc.name} updated`, indicator: 'green' });
							render_sales_invoice_dashboard(page, doc.name);
						},
					});
				}
			);
		},
	});

	const $wrap = d.get_field('items_html').$wrapper;

	function render_table() {
		let body_html = rows.map((r, idx) => `
			<tr data-idx="${idx}">
				<td style="padding:6px 8px;">
					<div style="font-weight:600;">${esc(r.item_code)}</div>
					<div style="font-size:11px; color:var(--text-muted);">${esc(r.item_name)}${r.row_name ? '' : ' <span style="color:var(--orange-500);">(new)</span>'}</div>
				</td>
				<td style="padding:6px 8px;">${esc(r.category || '—')}</td>
				<td style="padding:6px 8px;"><input type="number" step="any" min="0" class="form-control ei-qty" value="${r.qty}" style="width:90px;"></td>
				<td style="padding:6px 8px;"><input type="number" step="any" min="0" class="form-control ei-rate" value="${r.rate}" style="width:110px;"></td>
				<td style="padding:6px 8px; text-align:right;" class="ei-amount">${format_currency(row_amount(r), currency)}</td>
				<td style="padding:6px 8px; white-space:nowrap;">
					${BUILDER_CATEGORIES.includes(r.category) ? '<button class="btn btn-xs btn-default ei-edit" title="Edit item" style="margin-right:4px;"><i class="fa fa-pencil"></i></button>' : ''}
					${r.row_name ? '<button class="btn btn-xs btn-default ei-clear" title="Clear changes (restore original)" style="margin-right:4px;"><i class="fa fa-undo"></i></button>' : ''}
					<button class="btn btn-xs btn-danger ei-remove" title="Remove row"><i class="fa fa-trash"></i></button>
				</td>
			</tr>
		`).join('');

		$wrap.html(`
			<div style="font-size:12px; color:var(--text-muted); margin-bottom:10px;">
				The grand total is <b>locked</b> — rebalance quantities and rates so the total stays within <b>±2</b> of the original.
				Stock for aluminium, fittings, ceiling and plain glass is auto-adjusted.
				Laminated / JC-resized glass stock must be corrected via the Job Card's JC Operations.
				Service rows (polishing, holes, etc.) are regenerated automatically on save.
			</div>
			<div style="overflow-x:auto;">
				<table class="table table-bordered" style="margin-bottom:8px;">
					<thead><tr>
						<th>Item</th><th>Category</th><th>Qty</th><th>Rate</th>
						<th style="text-align:right;">Amount</th><th></th>
					</tr></thead>
					<tbody>${body_html}</tbody>
				</table>
			</div>
			<div style="display:flex; align-items:center; gap:8px;">
				<select class="form-control" id="ei-add-category" style="width:auto; min-width:150px;">
					${['Aluminium', 'Glass', 'Fittings', 'Ceiling', 'Rubber', 'Silicone'].map(c => `<option value="${c}">${c}</option>`).join('')}
				</select>
				<select class="form-control" id="ei-add-glass-type" style="width:auto; min-width:150px; display:none;">
					${['Ordinary', 'Laminated', 'Ready Laminated', 'Toughened'].map(t => `<option value="${t}">${t}</option>`).join('')}
				</select>
				<button class="btn btn-sm btn-default" id="ei-add-row"><i class="fa fa-plus" style="margin-right:4px;"></i>Add Item</button>
			</div>
			<div id="ei-totals" style="margin-top:12px; padding:10px 12px; border-radius:6px; background:var(--bg-light-gray, var(--fg-hover-color)); display:flex; gap:24px; flex-wrap:wrap; font-size:13px;"></div>
		`);

		$wrap.find('.ei-qty, .ei-rate').on('input', function() {
			const idx = parseInt($(this).closest('tr').data('idx'), 10);
			const row = rows[idx];
			if ($(this).hasClass('ei-qty')) row.qty = flt($(this).val());
			else row.rate = flt($(this).val());
			// Manual qty/rate edit takes over from the builder's composite preview.
			row.builder_amount = null;
			$(this).closest('tr').find('.ei-amount').text(format_currency(row_amount(row), currency));
			update_totals();
		});

		$wrap.find('.ei-edit').on('click', function() {
			const idx = parseInt($(this).closest('tr').data('idx'), 10);
			const r = rows[idx];
			if (!window.CAWItemBuilder) {
				frappe.msgprint('Item builder is still loading — please try again in a moment.');
				return;
			}
			window.CAWItemBuilder.open({
				category: r.category,
				item: row_to_builder_item(r),
				onSave: function(item) {
					const mapped = builder_item_to_row(item);
					// Preserve this row's identity (row_name/orig) so the server updates it in
					// place; only refresh item, pricing and the category fields.
					rows[idx] = Object.assign({}, r, {
						item_code: mapped.item_code, item_name: mapped.item_name, category: mapped.category,
						qty: mapped.qty, rate: mapped.rate, customs: mapped.customs,
						builder_amount: mapped.builder_amount, builder_item: item,
					});
					render_table();
				},
			});
		});

		$wrap.find('.ei-clear').on('click', function() {
			const idx = parseInt($(this).closest('tr').data('idx'), 10);
			// Restore the row to its original invoice values, discarding any qty/rate or
			// builder edits (customs, builder_item, builder_amount all drop away).
			rows[idx] = make_row(rows[idx].orig);
			render_table();
		});

		$wrap.find('.ei-remove').on('click', function() {
			const idx = parseInt($(this).closest('tr').data('idx'), 10);
			rows.splice(idx, 1);
			render_table();
		});

		// Glass sub-category picker only applies to Glass.
		$wrap.find('#ei-add-category').on('change', function() {
			$wrap.find('#ei-add-glass-type').toggle($(this).val() === 'Glass');
		}).trigger('change');

		$wrap.find('#ei-add-row').on('click', function() {
			const category = $wrap.find('#ei-add-category').val();
			if (!window.CAWItemBuilder) {
				frappe.msgprint('Item builder is still loading — please try again in a moment.');
				return;
			}
			window.CAWItemBuilder.open({
				category: category,
				glass_type: category === 'Glass' ? $wrap.find('#ei-add-glass-type').val() : null,
				onSave: function(item) {
					rows.push(builder_item_to_row(item));
					render_table();
				},
			});
		});

		update_totals();
	}

	function update_totals() {
		const new_total = rows.reduce((s, r) => s + row_amount(r), 0);
		const diff = new_total - original_total;
		const balanced = Math.abs(diff) <= 2;
		$wrap.find('#ei-totals').html(`
			<div>Original items total: <b>${format_currency(original_total, currency)}</b></div>
			<div>New items total: <b>${format_currency(new_total, currency)}</b></div>
			<div style="color:${balanced ? 'var(--green-600, green)' : 'var(--red-500, red)'};">
				Difference: <b>${format_currency(diff, currency)}</b> ${balanced ? '✓' : '— must stay within ±2'}
			</div>
		`);
		d.get_primary_btn().prop('disabled', !balanced || !rows.length);
	}

	render_table();
	d.show();
	d.$wrapper.find('.modal-body').css({
		height: 'min(640px, calc(100vh - 160px))',
		overflowY: 'auto',
	});
}
