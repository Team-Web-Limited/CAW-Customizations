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
			items: [],
			step: 1
		};
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

function bind_events(page) {
	$(page.body).on('click', '.qb-step-indicator', function () {
		let step = parseInt($(this).data('step'));
		if (step) render_step(page, step);
	});

	$(page.body).on('click', '.qb-add-btn', function () {
		let category = $(this).data('category');
		let glassType = $(this).data('glass-type');
		if (!category) return;
		if (category === 'Glass') {
			let label = $(this).text().replace('+', '').trim();
			let d = new frappe.ui.Dialog({
				title: `Add ${label} Items`,
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
				primary_action: function (values) {
					d.hide();
					if (values.entry_method === 'Upload') {
						open_glass_import_dialog(page);
					} else {
						add_item_row(page, 'Glass', glassType);
					}
				}
			});
			d.show();
			return;
		}
		add_item_row(page, category);
	});

	$(page.body).on('click', '.qb-import-products-btn', function () {
		open_glass_import_dialog(page);
	});

	$(page.body).on('click', '.qb-nav-step', function () {
		let step = parseInt($(this).data('step'));
		if (step) render_step(page, step);
	});
}

function get_item_display_qty(item) {
	return item.qty;
}

function get_item_uom_label(item) {
	if (item.category === 'Glass' && item.sale_mode === 'Full Sheet') {
		return 'Nos';
	}

	if (item.uom) {
		return item.uom;
	}

	if (item.category === 'Aluminium') {
		return 'Meter';
	}

	if (item.category === 'Ceiling') {
		return 'Square Meter';
	}

	if (item.category === 'Glass') {
		return 'Square Foot';
	}

	return '';
}

function get_item_uom_qty(item) {
	if (item.category === 'Aluminium') {
		return flt(item.metres || 0);
	}

	if (item.category === 'Ceiling') {
		return flt(item.square_metres || 0);
	}

	if (item.category === 'Glass') {
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
		return qty * flt(item.metres || 0) * rate;
	}

	if (item.category === 'Ceiling') {
		return qty * flt(item.square_metres || 0) * rate;
	}

	if (item.category === 'Glass') {
		if (item.sale_mode === 'Full Sheet') {
			return qty * rate;
		}

		return qty * get_glass_area_sqft(item) * rate;
	}

	return qty * rate;
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
			<td style="text-align:center;">${index + 1}</td>
			<td style="text-align:center;">${format_review_number(item.width_mm || 0, 0)}</td>
			<td style="text-align:center;">${format_review_number(item.height_mm || 0, 0)}</td>
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
			<td style="white-space:pre-wrap;">${item.description ? frappe.utils.escape_html(item.description) : '-'}</td>
			<td style="text-align:center;">${item.qty || '-'}</td>
			<td style="text-align:center;">${format_review_number(item.metres || 0)}</td>
			<td style="text-align:center;">
				<span style="background:var(--subtle-fg);padding:2px 8px;border-radius:6px;font-size:12px;">${item.price_list || 'Retail'}</span>
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
				<span style="background:var(--subtle-fg);padding:2px 8px;border-radius:6px;font-size:12px;">${item.price_list || 'Retail'}</span>
			</td>
			<td style="text-align:right;">${format_currency(item.rate, 'KES')}</td>
			<td style="text-align:right;font-weight:600;">${format_currency(item.amount, 'KES')}</td>
		</tr>
	`;
}

function render_review_other_row(item, index) {
	return `
		<tr>
			<td style="text-align:center;">${index + 1}</td>
			<td style="font-weight:500;">${frappe.utils.escape_html(item.item_name || item.item_code || '')}</td>
			<td style="white-space:pre-wrap;">${item.description ? frappe.utils.escape_html(item.description) : '-'}</td>
			<td style="text-align:center;">${item.qty || '-'}</td>
			${item.category === 'Ceiling' ? `<td style="text-align:center;">${format_review_number(item.square_metres || 0)}</td>` : ''}
			<td style="text-align:center;">
				<span style="background:var(--subtle-fg);padding:2px 8px;border-radius:6px;font-size:12px;">${item.price_list || 'Retail'}</span>
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
	let subtotal = items.reduce((sum, item) => sum + (item.amount || 0), 0);
	let is_ceiling = category === 'Ceiling';

	return `
		<div style="margin-bottom:24px;">
			<h5 style="margin:0 0 10px 0;font-size:15px;font-weight:600;color:${meta.color};display:flex;align-items:center;gap:8px;">
				<span style="background:${meta.color}20;padding:3px 10px;border-radius:10px;font-size:12px;">${meta.icon}</span> ${meta.label}
				<span style="margin-left:auto;font-size:13px;color:var(--text-muted);font-weight:500;">Subtotal: ${format_currency(subtotal, 'KES')}</span>
			</h5>
			<div class="table-responsive">
				<table class="table table-bordered" style="background:var(--card-bg); margin-bottom:0;">
					<thead style="background:var(--control-bg);">
						<tr>
							<th style="text-align:center;white-space:nowrap;">No</th>
							<th style="white-space:nowrap;">Item</th>
							<th style="white-space:nowrap;">Description</th>
							<th style="text-align:center;white-space:nowrap;">Qty</th>
							${is_ceiling ? '<th style="text-align:center;white-space:nowrap;">Square Metres</th>' : ''}
							<th style="text-align:center;white-space:nowrap;">Price List</th>
							<th style="text-align:right;white-space:nowrap;">${is_ceiling ? 'Rate / Sq M' : 'Rate'}</th>
							<th style="text-align:right;white-space:nowrap;">Amount</th>
						</tr>
					</thead>
					<tbody>
						${items.map((item, index) => render_review_other_row(item, index)).join('')}
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

	// Toggle primary action visibility
	page.clear_primary_action();
	if (step === 3) {
		render_review_step(page);
	}
}

function render_review_step(page) {
	let $summary = $(page.body).find('.qb-review-summary');
	$summary.empty();

	let grand = window.qb_state.items.reduce((s, i) => s + (i.amount || 0), 0);

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

	let glass_total = glass_items.reduce((s, i) => s + (i.amount || 0), 0);
	let aluminium_total = aluminium_items.reduce((s, i) => s + (i.amount || 0), 0);
	let fittings_total = fittings_items.reduce((s, i) => s + (i.amount || 0), 0);

	// ── Glass Section ──
	let glass_html = '';
	if (glass_items.length) {
		glass_html = `
			<div style="margin-bottom:24px;">
				<h5 style="margin:0 0 10px 0;font-size:15px;font-weight:600;color:#3498db;display:flex;align-items:center;gap:8px;">
					<span style="background:#3498db20;padding:3px 10px;border-radius:10px;font-size:12px;">🔷</span> Glass Items
					<span style="margin-left:auto;font-size:13px;color:var(--text-muted);font-weight:500;">Subtotal: ${format_currency(glass_total, 'KES')}</span>
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
					<span style="margin-left:auto;font-size:13px;color:var(--text-muted);font-weight:500;">Subtotal: ${format_currency(aluminium_total, 'KES')}</span>
				</h5>
				<div class="table-responsive">
					<table class="table table-bordered" style="background:var(--card-bg); margin-bottom:0;">
						<thead style="background:var(--control-bg);">
							<tr>
								<th style="text-align:center;white-space:nowrap;">No</th>
								<th style="white-space:nowrap;">Item</th>
								<th style="white-space:nowrap;">Description</th>
								<th style="text-align:center;white-space:nowrap;">Qty</th>
								<th style="text-align:center;white-space:nowrap;">Metres</th>
								<th style="text-align:center;white-space:nowrap;">Price List</th>
								<th style="text-align:right;white-space:nowrap;">Rate/m</th>
								<th style="text-align:right;white-space:nowrap;">Amount</th>
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
					<span style="margin-left:auto;font-size:13px;color:var(--text-muted);font-weight:500;">Subtotal: ${format_currency(fittings_total, 'KES')}</span>
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
								<th style="text-align:right;white-space:nowrap;">Rate</th>
								<th style="text-align:right;white-space:nowrap;">Amount</th>
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

	let html = `
		<div style="background:var(--control-bg); padding:16px; border-radius:8px; border:1px solid var(--border-color);">
			<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
				<h4 style="margin:0;font-size:16px;">
					<span style="color:var(--text-muted);">Customer:</span> 
					${window.qb_state.customer || '<em style="color:var(--text-muted);">Not Selected</em>'}
				</h4>
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

			<div style="background:var(--card-bg); border:1px solid var(--border-color); border-radius:6px; padding:14px 20px; display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
				<span style="font-size:15px;font-weight:600;">Grand Total</span>
				<span style="font-size:18px;font-weight:700;color:var(--primary);">${format_currency(grand, 'KES')}</span>
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
	let $container = $(page.body).find('.qb-customer-field');
	$container.empty();

	let customer_field = frappe.ui.form.make_control({
		df: {
			fieldtype: 'Link',
			options: 'Customer',
			label: 'Select Customer',
			fieldname: 'customer',
			reqd: 1,
			placeholder: 'Type to search for a customer...'
		},
		parent: $container,
		render_input: true
	});
	customer_field.$input.css({ 'font-size': '15px', 'padding': '10px' });

	// Restore previously selected customer
	if (window.qb_state.customer) {
		customer_field.set_value(window.qb_state.customer);
	}

	$(page.body).find('.qb-next-1').off('click').on('click', function () {
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
function add_item_row(page, category, glass_type = 'Ordinary') {
	let id = frappe.utils.get_random(8);
	let item = {
		id: id,
		category: category,
		item_code: '',
		item_name: '',
		uom: '',
		description: '',
		price_list: 'Retail',
		qty: 1,
		metres: 1,
		square_metres: 1,
		rate: 0,
		amount: 0,
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
		holes: 0,
		notches: 0,
		numbering: '',
		sandblast_type: 'None',
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
				open_item_editor(page, item, true);
			}
		});
		return;
	}

	open_item_editor(page, item, true);
} // Added to close add_item_row

function open_glass_add_choice(page) {
	let d = new frappe.ui.Dialog({
		title: 'Add Glass Items',
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
		primary_action: function (values) {
			d.hide();
			if (values.entry_method === 'Upload') {
				open_glass_import_dialog(page);
			} else {
				add_item_row(page, 'Glass', d.custom_glass_type);
			}
		}
	});

	d.custom_glass_type = 'Ordinary'; // Default fallback
	d.show();
}

function open_specific_glass_add_choice(page, label, glass_type) {
	let d = new frappe.ui.Dialog({
		title: `Add ${label} Items`,
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
		primary_action: function (values) {
			d.hide();
			if (values.entry_method === 'Upload') {
				open_glass_import_dialog(page);
			} else {
				add_item_row(page, 'Glass', glass_type);
			}
		}
	});
	d.show();
}

function remove_item(page, id) {
	window.qb_state.items = window.qb_state.items.filter(i => i.id !== id);
	render_items_table(page);
}

function render_items_table(page) {
	let $tbody = $(page.body).find('.qb-items-body');
	$tbody.empty();

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
						<span style="background:var(--subtle-fg);padding:3px 10px;border-radius:6px;font-size:12px;">${item.price_list || 'Retail'}</span>
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
						['Item', 'item_name', 'not like', '%Hole%']
					];

					if (item.glass_type_filter) {
						f.push(['Item', 'custom_glass_type', '=', item.glass_type_filter]);
					}

					return { filters: f };
				}
				return { filters: filters };
			},
			default: item.item_code
		},
		{ fieldtype: 'Column Break' },
		{
			fieldtype: 'Select',
			options: 'Retail\nWholesale\nSpecial',
			fieldname: 'price_list',
			label: 'Selling Price',
			reqd: 1,
			default: item.price_list || 'Retail'
		},
		{ fieldtype: 'Section Break' },
		{
			fieldtype: (item.category === 'Aluminium' || is_ceiling || is_glass) ? 'Int' : 'Float',
			fieldname: 'qty',
			label: 'Quantity',
			default: item.qty || 1,
			reqd: 1
		},
		{ fieldtype: 'Column Break' },
		{
			fieldtype: 'Currency',
			fieldname: 'rate',
			label: item.category === 'Aluminium' ? 'Rate Per Metre' : (is_ceiling ? 'Rate Per Square Metre' : 'Rate'),
			default: item.rate || 0
		}
	];

	if (item.category === 'Aluminium') {
		fields.push(
			{ fieldtype: 'Float', fieldname: 'metres', label: 'Metres', default: item.metres || 1, reqd: 1 },
			{ fieldtype: 'Section Break', label: 'Item Details' },
			{ fieldtype: 'Small Text', fieldname: 'description', label: 'Description', default: item.description || '' }
		);
	}

	if (is_ceiling) {
		fields.push(
			{ fieldtype: 'Float', fieldname: 'square_metres', label: 'Square Metres', default: item.square_metres || 1, reqd: 1 }
		);
	}

	if (is_glass) {
		let baseWidthFt = get_glass_base_width_ft(item);
		let baseHeightFt = get_glass_base_height_ft(item);
		let adjustedWidthFt = get_glass_adjusted_width_ft(item);
		let adjustedHeightFt = get_glass_adjusted_height_ft(item);
		fields.push(
			{ fieldtype: 'Section Break', label: 'Glass Dimensions' },
			{ fieldtype: 'Float', fieldname: 'width_mm', label: 'Width (mm)', default: item.width_mm || 0 },
			{ fieldtype: 'Float', fieldname: 'height_mm', label: 'Height (mm)', default: item.height_mm || 0 },
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
			{ fieldtype: 'Section Break' },
			{ fieldtype: 'Int', fieldname: 'holes', label: 'Number of Holes', default: item.holes || 0 },
			{ fieldtype: 'Column Break' },
			{ fieldtype: 'Int', fieldname: 'notches', label: 'Number of Notches', default: item.notches || 0 },
			{ fieldtype: 'Section Break' },
			{ fieldtype: 'Data', fieldname: 'numbering', label: 'Numbering', default: item.numbering || '' },
				{ fieldtype: 'Select', fieldname: 'sandblast_type', label: 'Sandblast Type', options: 'None\nHalf\nFull', default: item.sandblast_type || 'None' },
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
			item.item_name = values.item_code;
			item.description = values.description || '';
			item.price_list = values.price_list || 'Retail';
			item.qty = values.qty || 1;
			item.metres = item.category === 'Aluminium' ? (values.metres || 1) : 0;
			item.square_metres = is_ceiling ? (values.square_metres || 1) : 0;
			item.rate = values.rate || 0;

			if (is_glass) {
				let polish_width_sides = cint(values.polish_width_sides || 0);
				let polish_height_sides = cint(values.polish_height_sides || 0);
				if (![0, 1, 2].includes(polish_width_sides) || ![0, 1, 2].includes(polish_height_sides)) {
					frappe.msgprint('Polish width side and polish height side can only be 0, 1, or 2.');
					return;
				}

				item.sale_mode = 'Resized';
				item.width_mm = values.width_mm || 0;
				item.height_mm = values.height_mm || 0;
				item.width_allowance = values.width_allowance || 0;
				item.height_allowance = values.height_allowance || 0;
				item.base_width_ft = values.base_width_ft || 0;
				item.base_height_ft = values.base_height_ft || 0;
				item.width_ft = values.width_ft || 0;
				item.height_ft = values.height_ft || 0;
				item.area_sqft = values.area_sqft || 0;
				item.polish_width_sides = polish_width_sides;
				item.polish_height_sides = polish_height_sides;
				item.polishing = polish_width_sides > 0 || polish_height_sides > 0 ? 1 : 0;
				item.perimeter_rft = get_glass_polishing_rft(item);
				item.holes = values.holes || 0;
				item.notches = values.notches || 0;
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
						sandblast_type: item.sandblast_type
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
						d.hide();
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

			d.hide();
			render_items_table(page);
		}
	});

	d.show();

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

	// Glass real-time calculation
	if (is_glass) {
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
			let w = d.get_value('width_mm') || 0;
			let h = d.get_value('height_mm') || 0;
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

	// Auto-fetch rate from Item Price when item_code or price_list changes
	let fetch_rate = function () {
		let ic = d.get_value('item_code');
		let pl = d.get_value('price_list');
		if (ic && pl) {
			frappe.db.get_value('Item', ic, 'stock_uom', function (uom_result) {
				item.uom = (uom_result && uom_result.stock_uom) || item.uom;
			});

			frappe.call({
				method: 'frappe.client.get_value',
				args: {
					doctype: 'Item Price',
					filters: { item_code: ic, price_list: pl, selling: 1 },
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

			// Fetch glass type if category is Glass
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
	};

	// Link fields do not always emit a plain "change" when picked from the suggestion list,
	// so listen to the selection event as well to populate Retail/Wholesale automatically.
	d.fields_dict.item_code.df.change = fetch_rate;
	d.fields_dict.price_list.df.change = fetch_rate;
	d.fields_dict.item_code.$input.on('change awesomplete-selectcomplete', fetch_rate);
	d.fields_dict.price_list.$input.on('change', fetch_rate);

	if (d.get_value('item_code') && d.get_value('price_list') && !d.get_value('rate')) {
		fetch_rate();
	}


}

function open_glass_import_dialog(page) {
	let d = new frappe.ui.Dialog({
		title: 'Import Builder Items from Excel',
		fields: [
			{
				fieldtype: 'HTML',
				fieldname: 'template_help',
				options: `
						<div style="margin-bottom:12px;color:var(--text-muted);">
							Expected columns: <b>numbering</b>, <b>width</b>, <b>height</b>, <b>w+</b>, <b>h+</b>, <b>pcs</b>, <b>holes</b>, <b>notches</b>, <b>sandblast</b>, <b>polish_width_side</b>, <b>polish_height_side</b>, <b>details</b>.
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
				['Item', 'item_name', 'not like', '%Hole%']
			]
		};
	};

	d.fields_dict.glass_type.df.change = function () {
		d.set_value('item_code', '');
	};

	d.$wrapper.on('click', '.qb-download-glass-template', function () {
		frappe.call({
			method: 'crystal_alluminium_works.api.download_glass_builder_template',
			callback: function (r) {
				if (r.message && r.message.file_url) {
					window.open(r.message.file_url, '_blank');
				}
			}
		});
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
		"Pcs",
		"Reference"
	];

	let data = [columns];

	state.items.forEach((i, idx) => {
		let isGlass = i.category === 'Glass';
		if (!isGlass) return;

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
			format_review_number(i.width_mm || 0, 0),
			format_review_number(i.height_mm || 0, 0),
			pieces,
			i.item_name || i.item_code || ''
		]);
	});

	frappe.call({
		method: 'crystal_alluminium_works.api.export_quotation_builder_items',
		args: {
			data: data
		},
		freeze: true,
		freeze_message: 'Generating Excel...',
		callback: function (r) {
			if (r.message && r.message.file_url) {
				window.open(r.message.file_url, '_blank');
			}
		}
	});
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

	let api_args = {
		customer: state.customer,
		items: JSON.stringify(state.items)
	};

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
							<th style="text-align:right;">Rate</th>
							<th style="text-align:right;">Amount</th>
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
	// Initialize step 1 controls
	setup_customer_step(page);

	// If state has pre-populated items (e.g. coming from "Edit in Builder"), render them
	if (window.qb_state && window.qb_state.items && window.qb_state.items.length > 0) {
		render_items_table(page);
	}

	// Update page title if editing an existing quotation
	if (window.qb_state && window.qb_state.editing_quotation) {
		page.set_title(`Editing: ${window.qb_state.editing_quotation}`);
	}

	// Restore previous step if revisiting
	if (window.qb_state && window.qb_state.step) {
		render_step(page, window.qb_state.step);
	}
};
