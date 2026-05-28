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
};

const SALES_INVOICE_VAT_RATE = 0.16;

function get_sales_invoice_item_uom_label(item) {
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

function get_sales_invoice_item_uom_qty(item) {
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
	let rate_per_m = item.custom_aluminium_metres ? (item.rate / item.custom_aluminium_metres) : item.rate;
	return `
		<tr>
			<td style="text-align:center;">${index + 1}</td>
			<td style="font-weight:500;">${frappe.utils.escape_html(item.item_name || item.item_code || '')}</td>
			<td style="text-align:center;">${item.custom_aluminium_color ? frappe.utils.escape_html(item.custom_aluminium_color) : '-'}</td>
			<td style="white-space:pre-wrap;">${item.description ? frappe.utils.escape_html(item.description) : '-'}</td>
			<td style="text-align:center;">${item.qty || '-'}</td>
			<td style="text-align:center;">${format_sales_invoice_review_number(item.custom_aluminium_metres || 0)}</td>
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
	let cat_color = {'Ceiling':'#2ecc71','Fittings':'#e67e22','Rubber':'#8e44ad','Silicone':'#16a085'}[category] || '#7f8c8d';
	let price_list = doc ? doc.selling_price_list : 'Retail';
	let rate = item.rate;
	if (category === 'Ceiling' && item.custom_ceiling_sq_m) {
		rate = item.rate / item.custom_ceiling_sq_m;
	}
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

function get_sales_invoice_display_paid_amount(doc) {
	if (doc.docstatus !== 1) {
		return 0;
	}

	return get_sales_invoice_paid_amount(doc);
}

function get_sales_invoice_outstanding_for_ui(doc) {
	if (doc.docstatus !== 1) {
		return get_sales_invoice_display_total(doc);
	}

	if (sales_invoice_is_unpaid_state(doc)) {
		return get_sales_invoice_display_total(doc);
	}

	return get_sales_invoice_display_outstanding(doc);
}

function render_sales_invoice_tax_summary(doc) {
	let taxes = doc.taxes || [];

	if (!taxes.length) {
		return `
			<div style="padding: 8px 0; color: var(--text-muted); font-size: 14px;">
				No tax rows were added to this invoice.
			</div>
		`;
	}

	return `
		<div class="sim-table-wrap">
			<table class="sim-table" style="min-width:760px;">
				<thead>
					<tr>
						<th>Tax / Charge</th>
						<th style="text-align:center;">Type</th>
						<th style="text-align:center;">Rate</th>
						<th style="text-align:right;">Tax Amount</th>
						<th style="text-align:right;">Running Total</th>
					</tr>
				</thead>
				<tbody>
					${taxes.map(tax => `
						<tr>
							<td>
								<div style="font-weight:500;">${frappe.utils.escape_html(tax.account_head || tax.description || 'Tax')}</div>
								${tax.description ? `<div style="font-size:12px; color:var(--text-muted);">${frappe.utils.escape_html(tax.description)}</div>` : ''}
							</td>
							<td style="text-align:center;">${frappe.utils.escape_html(tax.charge_type || '-')}</td>
							<td style="text-align:center;">${flt(tax.rate || 0)}%</td>
							<td style="text-align:right;">${format_currency(tax.tax_amount || 0, doc.currency || 'KES')}</td>
							<td style="text-align:right; font-weight:600;">${format_currency(tax.total || 0, doc.currency || 'KES')}</td>
						</tr>
					`).join('')}
				</tbody>
			</table>
		</div>
	`;
}

function render_sales_invoice_payment_controls(doc, mode_of_payments, default_payment_mode) {
	let outstanding = get_sales_invoice_outstanding_for_ui(doc);
	let default_mode = default_payment_mode || (mode_of_payments.length ? mode_of_payments[0].mode_of_payment : '');

	if (default_payment_mode && !mode_of_payments.find(m => m.mode_of_payment === default_payment_mode)) {
		default_mode = mode_of_payments.length ? mode_of_payments[0].mode_of_payment : '';
	}

	if (doc.docstatus !== 1) {
		return `<p style="color:var(--text-muted); margin:0;">Submit the invoice first before recording payment.</p>`;
	}

	if (doc.status === 'Cancelled') {
		return `<p style="color:var(--text-muted); margin:0;">Cancelled invoices cannot accept payments.</p>`;
	}

	if (outstanding <= 0) {
		return `<p style="color:var(--text-muted); margin:0;">This invoice is already fully paid.</p>`;
	}

	if (!mode_of_payments.length) {
		return `<p style="color:#e67e22; margin:0;">No Mode of Payment accounts are configured for ${doc.company}. Add one before recording payment.</p>`;
	}

	return `
		<div class="sim-payment-panel">
			<div class="sim-payment-grid">
				<div>
					<label class="form-label">Amount Received</label>
					<input type="number" min="0.01" step="0.01" max="${outstanding}" class="form-control sim-amount-received" value="${outstanding}">
					<div style="margin-top:6px; font-size:12px; color:var(--text-muted);">
						Outstanding: ${format_currency(outstanding, doc.currency || 'KES')}
					</div>
				</div>
				<div>
					<label class="form-label">Mode of Payment</label>
					<select class="form-control sim-mode-of-payment">
						${mode_of_payments.map(row => `
							<option value="${frappe.utils.escape_html(row.mode_of_payment)}" ${row.mode_of_payment === default_mode ? 'selected' : ''}>
								${frappe.utils.escape_html(row.mode_of_payment)}${row.type ? ` (${frappe.utils.escape_html(row.type)})` : ''}
							</option>
						`).join('')}
					</select>
				</div>
				<div>
					<label class="form-label">Posting Date</label>
					<input type="date" class="form-control sim-payment-date" value="${frappe.datetime.str_to_user(frappe.datetime.get_today()) ? frappe.datetime.get_today() : ''}">
				</div>
			</div>
			<div class="sim-payment-action">
				<button class="btn btn-primary sim-record-payment">
					<i class="fa fa-money" style="margin-right:6px;"></i>Record
				</button>
			</div>
		</div>
	`;
}

frappe.pages['sales-invoice-manager'].on_page_show = function(wrapper) {
	let page = wrapper.page || (wrapper.control ? wrapper.control.page : null);

	if (!page) {
		page = $(wrapper).data('page');
	}

	let route = frappe.get_route();
	let route_options = typeof frappe.get_route_options === 'function'
		? frappe.get_route_options()
		: (frappe.route_options || {});
	let invoice_name = route[1] || route_options.sales_invoice || null;
	let default_payment_mode = route[2] || route_options.payment_mode || null;

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
		const mode_of_payment_response = await frappe.call({
			method: 'crystal_alluminium_works.api.get_company_mode_of_payments',
			args: { company: doc.company },
		});
		const mode_of_payments = mode_of_payment_response.message || [];
		if (page) {
			page.set_title(`Sales Invoice: ${doc.name}`);
		}

		const sales_orders = [...new Set((doc.items || []).map(row => row.sales_order).filter(Boolean))];
		const quotation_name = doc.custom_source_quotation || null;
		const status_color = get_manager_status_color(doc.status);
		const manual_items = (doc.items || []).filter(item => !item.custom_auto_generated);
		const glass_items = manual_items.filter(i => i.custom_product_category === 'Glass');
		const aluminium_items = manual_items.filter(i => i.custom_product_category === 'Aluminium');
		const fittings_items = manual_items.filter(i => i.custom_product_category === 'Fittings');
		const other_items = manual_items.filter(i =>
			!['Glass', 'Aluminium', 'Fittings'].includes(i.custom_product_category)
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
									<th style="text-align:center;white-space:nowrap;">Metres</th>
									<th style="text-align:center;white-space:nowrap;">Price List</th>
									<th style="text-align:right;white-space:nowrap;">Rate/m</th>
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
			.sim-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding: 20px; background: var(--card-bg); border-radius: 8px; box-shadow: var(--shadow-sm); gap: 16px; flex-wrap: wrap; }
			.sim-header h2 { margin: 0; font-size: 20px; }
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
			.sim-payment-panel { display: flex; align-items: flex-end; gap: 12px; }
			.sim-payment-grid { flex: 1; display: grid; grid-template-columns: minmax(180px, 260px) minmax(180px, 260px) minmax(150px, 180px); gap: 16px; align-items: flex-start; }
			.sim-payment-action { flex: 0 0 auto; display: flex; align-items: flex-end; padding-bottom: 20px; }
			.sim-record-payment { width: auto; min-width: 108px; height: 32px; padding: 6px 14px; white-space: nowrap; }
			@media (max-width: 900px) {
				.sim-payment-panel { flex-direction: column; align-items: stretch; }
				.sim-payment-grid { grid-template-columns: 1fr; }
				.sim-payment-action { padding-bottom: 0; }
				.sim-record-payment { width: 100%; }
			}
			.sim-table-wrap { overflow-x: auto; }
			.sim-review-table { min-width: 1180px; }
			.sim-table { width: 100%; border-collapse: collapse; }
			.sim-table th { background: var(--control-bg); padding: 12px 16px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-align: left; border-bottom: 1px solid var(--border-color); }
			.sim-table td { padding: 12px 16px; border-bottom: 1px solid var(--border-color); font-size: 14px; }
			.sim-table tr:last-child td { border-bottom: none; }
			.sim-total-row { display: flex; justify-content: space-between; padding: 16px 20px; background: var(--control-bg); border-top: 1px solid var(--border-color); }
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
				<div class="sim-step ${sales_orders.length ? 'active' : ''}">
					<div class="sim-icon">${sales_orders.length ? '✓' : '2'}</div>
					<div class="sim-label">Sales Order</div>
					${sales_orders.length ? sales_orders.map(name => `<a href="#" onclick="frappe.set_route('sales-order-manager', '${name}')" class="sim-link">${name}</a>`).join('') : '<span style="font-size: 11px; color: var(--text-muted);">Direct invoice</span>'}
				</div>
				<div class="sim-step active">
					<div class="sim-icon">✓</div>
					<div class="sim-label">Sales Invoice</div>
					<a href="#" onclick="frappe.set_route('Form', 'Sales Invoice', '${doc.name}')" class="sim-link">${doc.name}</a>
				</div>
			</div>

			<div class="sim-header">
				<div>
					<h2>${doc.customer_name || doc.customer}</h2>
					<div style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">Created ${frappe.datetime.prettyDate(doc.creation)}</div>
				</div>
				<div style="text-align: right;">
					<div style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px;">Posting Date: <strong style="color: var(--text-color);">${doc.posting_date ? frappe.datetime.global_date_format(doc.posting_date) : '—'}</strong></div>
					<span class="sim-badge ${status_color}">${doc.status || 'Draft'}</span>
				</div>
			</div>

			<div class="sim-card">
				<div class="sim-card-header">Invoice Summary</div>
				<div class="sim-card-body">
					<div class="sim-info-grid">
						<div>
							<div class="sim-info-label">Customer</div>
							<div class="sim-info-val">${doc.customer || '—'}</div>
						</div>
						<div>
							<div class="sim-info-label">Due Date</div>
							<div class="sim-info-val">${doc.due_date ? frappe.datetime.global_date_format(doc.due_date) : '—'}</div>
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
							<div class="sim-info-val">${format_currency(get_sales_invoice_display_paid_amount(doc), doc.currency || 'KES')}</div>
						</div>
						<div>
							<div class="sim-info-label">Outstanding</div>
							<div class="sim-info-val">${format_currency(get_sales_invoice_outstanding_for_ui(doc), doc.currency || 'KES')}</div>
						</div>
						<div>
							<div class="sim-info-label">Update Stock</div>
							<div class="sim-info-val">Disabled</div>
						</div>
						<div>
							<div class="sim-info-label">Quotation Source</div>
							<div class="sim-info-val">${quotation_name || '—'}</div>
						</div>
					</div>
				</div>
			</div>

			<div class="sim-card">
				<div class="sim-card-header">Tax Summary</div>
				<div class="sim-card-body">
					${render_sales_invoice_tax_summary(doc)}
				</div>
			</div>

			<div class="sim-card">
				<div class="sim-card-header">Payments</div>
				<div class="sim-card-body">
					<div class="sim-info-grid" style="margin-bottom:18px;">
						<div>
							<div class="sim-info-label">Amount Paid So Far</div>
							<div class="sim-info-val">${format_currency(get_sales_invoice_display_paid_amount(doc), doc.currency || 'KES')}</div>
						</div>
						<div>
							<div class="sim-info-label">Outstanding Balance</div>
							<div class="sim-info-val">${format_currency(get_sales_invoice_outstanding_for_ui(doc), doc.currency || 'KES')}</div>
						</div>
						<div>
							<div class="sim-info-label">Invoice Status</div>
							<div class="sim-info-val">${doc.status || 'Draft'}</div>
						</div>
					</div>
					${render_sales_invoice_payment_controls(doc, mode_of_payments, default_payment_mode)}
				</div>
			</div>

			<div class="sim-card">
				<div class="sim-card-header">Invoice Items</div>
				<div class="sim-card-body" style="padding-bottom: 0;">
					${glass_html}
					${aluminium_html}
					${fittings_html}
					${other_html}
					${(!glass_html && !aluminium_html && !fittings_html && !other_html) ? '<p style="text-align:center;color:var(--text-muted);padding:20px;">No items in this invoice.</p>' : ''}
				</div>
				<div class="sim-total-row">
					<span style="font-size: 16px; font-weight: 600;">Grand Total</span>
					<span class="sim-total-val">${format_currency(get_sales_invoice_display_total(doc), doc.currency || 'KES')}</span>
				</div>
			</div>

			<div class="sim-card">
				<div class="sim-card-header">Actions</div>
				<div class="sim-card-body sim-actions">
					${get_sales_invoice_action_buttons(doc, sales_orders, quotation_name)}
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

function get_sales_invoice_action_buttons(doc, sales_orders, quotation_name) {
	let buttons = `
		<button class="btn btn-default" id="btn-open-form">
			<i class="fa fa-external-link" style="margin-right:6px;"></i>Open Form
		</button>
		<button class="btn btn-default" id="btn-download-invoice">
			<i class="fa fa-download" style="margin-right:6px;"></i>Download PDF
		</button>
	`;

	if (sales_orders.length) {
		buttons += `
			<button class="btn btn-default" id="btn-open-sales-order" data-name="${sales_orders[0]}">
				<i class="fa fa-shopping-cart" style="margin-right:6px;"></i>Open Sales Order
			</button>
		`;
	}

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

		if (paid_amount <= 0) {
			buttons += `
				<button class="btn btn-danger" id="btn-cancel-invoice">
					<i class="fa fa-ban" style="margin-right:6px;"></i>Cancel Invoice
				</button>
			`;
		} else if (outstanding > 0) {
			buttons += `
				<button class="btn btn-danger" id="btn-cancel-blocked" title="Cancel linked payments before cancelling this invoice.">
					<i class="fa fa-ban" style="margin-right:6px;"></i>Cancel Invoice
				</button>
			`;
		}
	}

	return buttons;
}

function bind_sales_invoice_action_events(page, doc) {
	const $body = $(page.body);

	$body.find('#btn-open-form').on('click', () => {
		frappe.set_route('Form', 'Sales Invoice', doc.name);
	});

	$body.find('#btn-download-invoice').on('click', () => {
		download_sales_invoice_pdf(doc.name);
	});

	$body.find('#btn-open-sales-order').on('click', function() {
		let name = $(this).data('name');
		if (name) {
			frappe.set_route('sales-order-manager', name);
		}
	});

	$body.find('#btn-open-quotation').on('click', function() {
		let name = $(this).data('name');
		if (name) {
			frappe.set_route('quotation-manager', name);
		}
	});

	$body.find('.sim-record-payment').on('click', () => {
		let amount = flt($body.find('.sim-amount-received').val() || 0);
		let mode_of_payment = $body.find('.sim-mode-of-payment').val();
		let posting_date = $body.find('.sim-payment-date').val();

		if (!amount || amount <= 0) {
			frappe.msgprint('Enter a valid Amount Received.');
			return;
		}

		if (!mode_of_payment) {
			frappe.msgprint('Select a Mode of Payment.');
			return;
		}

		frappe.confirm(
			`Create and submit a Payment Entry for ${format_currency(amount, doc.currency || 'KES')} against ${doc.name}?`,
			() => {
				frappe.call({
					method: 'crystal_alluminium_works.api.record_sales_invoice_payment',
					args: {
						invoice_name: doc.name,
						amount: amount,
						mode_of_payment: mode_of_payment,
						posting_date: posting_date,
						reference_date: posting_date,
					},
					freeze: true,
					freeze_message: 'Recording payment...',
					callback: function(r) {
						if (!r.exc && r.message) {
							frappe.show_alert({
								message: `Payment Entry ${r.message.payment_entry} created`,
								indicator: 'green',
							});
							render_sales_invoice_dashboard(page, doc.name);
						}
					},
				});
			}
		);
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
}

function get_manager_status_color(status) {
	return {
		'Draft': 'orange',
		'Submitted': 'blue',
		'Paid': 'green',
		'Partly Paid': 'blue',
		'Unpaid': 'orange',
		'Overdue': 'red',
		'Return': 'purple',
		'Credit Note Issued': 'purple',
		'Cancelled': 'grey',
	}[status] || 'grey';
}
