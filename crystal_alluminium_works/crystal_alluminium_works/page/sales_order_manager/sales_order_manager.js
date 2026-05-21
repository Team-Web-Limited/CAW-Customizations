frappe.pages['sales-order-manager'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Sales Order Manager',
		single_column: true
	});

	page.set_secondary_action('Back', function() {
		window.history.back();
	});

	wrapper.page = page;
};

function get_sales_order_item_uom_label(item) {
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

function get_sales_order_item_uom_qty(item) {
	if (item.custom_product_category === 'Aluminium') {
		return flt(item.custom_aluminium_metres || 0);
	}

	if (item.custom_product_category === 'Ceiling') {
		return flt(item.custom_ceiling_sq_m || 0);
	}

	if (item.custom_product_category === 'Glass') {
		if (item.custom_glass_sale_mode === 'Full Sheet') {
			return flt(item.qty || 0);
		}

		return flt(item.custom_area_sqft || 0) * flt(item.qty || 0);
	}

	return flt(item.qty || 0);
}

function get_sales_order_breakdown_label(label, parent_item) {
	let display = (label || '').trim().replace(/^Glass\s+/i, '');

	if (/sandblasting/i.test(display) && !/\(/.test(display) && parent_item.custom_sandblast_type) {
		display = `${display} (${parent_item.custom_sandblast_type})`;
	}

	return display || (label || '');
}

function get_sales_order_breakdown_uom(label, parent_item) {
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

function download_manager_pdf(doctype, docname, print_format) {
	const print_url = frappe.urllib.get_full_url(
		`/api/method/frappe.utils.print_format.download_pdf?doctype=${encodeURIComponent(doctype)}&name=${encodeURIComponent(docname)}&format=${encodeURIComponent(print_format)}&no_letterhead=1`
	);

	window.open(print_url, '_blank');
}

frappe.pages['sales-order-manager'].on_page_show = function(wrapper) {
	let page = wrapper.page || (wrapper.control ? wrapper.control.page : null);
	
	if (!page) {
		page = $(wrapper).data('page');
	}

	let route = frappe.get_route();
	let so_name = route[1] || (frappe.get_route_options() ? frappe.get_route_options().sales_order : null);

	if (!so_name) {
		$(wrapper).find('.layout-main-section').html(`
			<div class="msg-box" style="padding: 40px; text-align: center; color: var(--text-muted);">
				<div style="font-size: 48px; margin-bottom: 20px;">📦</div>
				<h3>No Sales Order Selected</h3>
				<p>Please select a Sales Order from the list.</p>
				<div style="margin-top: 20px;">
					<button class="btn btn-primary" onclick="frappe.set_route('List', 'Sales Order')">View All Sales Orders</button>
				</div>
			</div>
		`);
		return;
	}

	render_so_dashboard(page, so_name, wrapper);
};

function render_so_dashboard(page, so_name, wrapper) {
	let $body = page ? $(page.body) : $(wrapper).find('.layout-main-section');
	$body.html('<div style="padding: 40px; text-align: center;"><span class="spinner"></span> Loading Sales Order...</div>');

	frappe.db.get_doc('Sales Order', so_name).then(async doc => {
		if (page) page.set_title(`Sales Order: ${doc.name}`);
		
		let state_color = {
			'Draft': 'orange',
			'To Deliver and Bill': 'blue',
			'To Bill': 'blue',
			'Completed': 'green',
			'Cancelled': 'darkgrey'
		}[doc.status] || 'grey';

		// Fetch linked Quotation
		let quotation_name = null;
		if (doc.items && doc.items.length > 0 && doc.items[0].prevdoc_doctype === 'Quotation') {
			quotation_name = doc.items[0].prevdoc_docname;
		}

		// Fetch linked Sales Invoices
		let sales_invoices = await frappe.db.get_list('Sales Invoice', {
			filters: { 'items.sales_order': doc.name },
			fields: ['name', 'status', 'docstatus', 'creation'],
			order_by: 'creation desc'
		});

		// One invoice can be returned multiple times when several SO items link to it.
		sales_invoices = sales_invoices.filter((invoice, index, invoices) =>
			index === invoices.findIndex(row => row.name === invoice.name)
		);

		let html = `
		<style>
			.qm-dashboard { max-width: 900px; margin: 0 auto; padding: 20px; font-family: var(--font-stack); }
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
					${quotation_name ? `<a href="#" onclick="frappe.set_route('quotation-manager', '${quotation_name}')" class="qm-workflow-link">${quotation_name}</a>` : '<span style="font-size: 11px; color: var(--text-muted);">None</span>'}
				</div>
				<div class="qm-workflow-step active">
					<div class="qm-workflow-icon">✓</div>
					<div class="qm-workflow-label">Sales Order</div>
					<a href="#" onclick="frappe.set_route('Form', 'Sales Order', '${doc.name}')" class="qm-workflow-link">${doc.name}</a>
				</div>
				<div class="qm-workflow-step">
					<div class="qm-workflow-icon">3</div>
					<div class="qm-workflow-label">Delivery</div>
					<span style="font-size: 11px; color: var(--text-muted);">(Deferred)</span>
				</div>
				<div class="qm-workflow-step ${sales_invoices.length > 0 ? 'active' : ''}">
					<div class="qm-workflow-icon">${sales_invoices.length > 0 ? '✓' : '4'}</div>
					<div class="qm-workflow-label">Invoice</div>
					${sales_invoices.map(si => `<a href="#" onclick="frappe.set_route('sales-invoice-manager', '${si.name}')" class="qm-workflow-link">${si.name}</a>`).join('')}
					${sales_invoices.length === 0 ? '<span style="font-size: 11px; color: var(--text-muted);">Pending</span>' : ''}
				</div>
			</div>

			<div class="qm-header">
				<div>
					<h2>${doc.customer_name || doc.party_name || doc.customer}</h2>
					<div style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">Created: ${frappe.datetime.global_date_format(doc.creation)}</div>
				</div>
				<div style="text-align: right;">
					<div style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px;">Transaction Date: <strong style="color: var(--text-color);">${frappe.datetime.global_date_format(doc.transaction_date)}</strong></div>
					<span class="qm-badge ${state_color}">${doc.status}</span>
				</div>
			</div>

			<div class="qm-card">
				<div class="qm-card-header">Order Items</div>
				<table class="qm-table">
					<thead>
						<tr>
							<th>Item</th>
							<th style="text-align:center;">Quantity</th>
							<th style="text-align:center;">UOM Qty</th>
							<th style="text-align:center;">UOM</th>
							<th style="text-align:right;">Rate</th>
							<th style="text-align:right;">Amount</th>
						</tr>
					</thead>
					<tbody>
						${(function() {
							// Group items like in Quotation
							let parents = {};
							let orphans = [];
							
							doc.items.forEach(i => {
								if (!i.custom_auto_generated) {
									parents[i.idx] = Object.assign({}, i, { children: [], display_amount: i.amount });
								}
							});
							
							doc.items.forEach(i => {
								if (i.custom_auto_generated) {
									let p = parents[i.custom_parent_row_idx];
									if (p) {
										p.children.push(i);
										p.display_amount += i.amount;
									} else {
										orphans.push(i);
									}
								}
							});
							
							let rows_html = '';
							
							Object.values(parents).forEach(p => {
								let has_children = p.children.length > 0;
								
								rows_html += `
									<tr ${has_children ? 'class="qm-parent-row" style="cursor:pointer;" onclick="$(this).next(\'.qm-child-rows\').toggle(); $(this).find(\'.qm-toggle-icon\').toggleClass(\'rotated\');"' : ''}>
										<td>
											<div style="font-weight:500; display:flex; align-items:center;">
												${has_children ? '<span class="qm-toggle-icon" style="margin-right:8px; transition:transform 0.2s;">▶</span>' : ''}
												${p.item_code}
											</div>
										</td>
										<td style="text-align:center;">${p.qty}</td>
										<td style="text-align:center;">${get_sales_order_item_uom_qty(p)}</td>
										<td style="text-align:center;">${get_sales_order_item_uom_label(p) || '-'}</td>
										<td style="text-align:right;">${format_currency(p.rate, doc.currency)}</td>
										<td style="text-align:right;font-weight:500;">${format_currency(p.display_amount, doc.currency)}</td>
									</tr>
								`;
								
								if (has_children) {
									rows_html += `
										<tr class="qm-child-rows" style="display:none; background:#f9fafb;">
											<td colspan="6" style="padding:0;">
												<table style="width:100%; border-collapse:collapse; font-size:0.9em; background:transparent;">
													<tbody>
														<tr>
															<td style="padding:8px 16px; padding-left:40px; color:var(--text-muted);">Base Material</td>
															<td style="padding:8px 16px; text-align:center; width:14%; color:var(--text-muted);">${p.qty}</td>
															<td style="padding:8px 16px; text-align:center; width:14%; color:var(--text-muted);">${get_sales_order_item_uom_qty(p)}</td>
															<td style="padding:8px 16px; text-align:center; width:14%; color:var(--text-muted);">${get_sales_order_item_uom_label(p) || '-'}</td>
															<td style="padding:8px 16px; text-align:right; width:14%; color:var(--text-muted);">${format_currency(p.rate, doc.currency)}</td>
															<td style="padding:8px 16px; text-align:right; width:14%; color:var(--text-muted);">${format_currency(p.amount, doc.currency)}</td>
														</tr>
														${p.children.map(c => `
															<tr>
																<td style="padding:8px 16px; padding-left:40px; color:var(--text-muted); border-top:1px solid var(--border-color);">
																	↳ ${get_sales_order_breakdown_label(c.item_name || c.item_code, p)}
																</td>
																<td style="padding:8px 16px; text-align:center; width:14%; color:var(--text-muted); border-top:1px solid var(--border-color);"></td>
																<td style="padding:8px 16px; text-align:center; width:14%; color:var(--text-muted); border-top:1px solid var(--border-color);">${flt(c.qty || 0)}</td>
																<td style="padding:8px 16px; text-align:center; width:14%; color:var(--text-muted); border-top:1px solid var(--border-color);">${get_sales_order_breakdown_uom(c.item_name || c.item_code, p) || '-'}</td>
																<td style="padding:8px 16px; text-align:right; width:14%; color:var(--text-muted); border-top:1px solid var(--border-color);">${format_currency(c.rate, doc.currency)}</td>
																<td style="padding:8px 16px; text-align:right; width:14%; color:var(--text-muted); border-top:1px solid var(--border-color);">${format_currency(c.amount, doc.currency)}</td>
															</tr>
														`).join('')}
													</tbody>
												</table>
											</td>
										</tr>
									`;
								}
							});
							
							orphans.forEach(o => {
								rows_html += `
									<tr>
										<td>
											<div style="font-weight:500;">${o.item_code}</div>
											<span style="font-size:11px;color:var(--text-muted);">Auto-generated service (Orphan)</span>
										</td>
										<td style="text-align:center;"></td>
										<td style="text-align:center;">${flt(o.qty || 0)}</td>
										<td style="text-align:center;">${get_sales_order_breakdown_uom(o.item_name || o.item_code, o) || o.uom || '-'}</td>
										<td style="text-align:right;">${format_currency(o.rate, doc.currency)}</td>
										<td style="text-align:right;font-weight:500;">${format_currency(o.amount, doc.currency)}</td>
									</tr>
								`;
							});
							
							return rows_html;
						})()}
					</tbody>
				</table>
				<div class="qm-total-row">
					<span style="font-size: 16px; font-weight: 600;">Grand Total</span>
					<span class="qm-total-val">${format_currency(doc.grand_total, doc.currency)}</span>
				</div>
			</div>

			<div class="qm-card">
				<div class="qm-card-header">Actions</div>
				<div class="qm-card-body qm-actions">
					${get_action_buttons(doc, sales_invoices)}
				</div>
			</div>
		</div>
		`;

		$(page.body).html(html);
		bind_action_events(page, doc, sales_invoices);
	}).catch(err => {
		$(page.body).html(`
			<div class="msg-box" style="padding: 40px; text-align: center; color: var(--text-muted);">
				<h3>Error Loading Sales Order</h3>
				<p>${err.message || 'Could not find the specified Sales Order.'}</p>
				<button class="btn btn-default" onclick="window.history.back()">Go Back</button>
			</div>
		`);
	});
}

function get_action_buttons(doc, sales_invoices) {
	let buttons = '';

	if (doc.docstatus === 0) { // Fallback for legacy drafts
		buttons += `
			<button class="btn btn-primary" id="btn-submit-so">
				<i class="fa fa-check" style="margin-right:6px;"></i>Submit Order
			</button>
		`;
	} else if (doc.docstatus === 1) { // Submitted
		if (sales_invoices.length === 0) {
			buttons += `
				<button class="btn btn-primary" id="btn-create-invoice">
					<i class="fa fa-file-text" style="margin-right:6px;"></i>Create Sales Invoice
				</button>
			`;
		} else {
			buttons += `<p style="color:var(--text-muted); width:100%;">✅ Sales Invoice already created.</p>`;
		}
		buttons += `
			<button class="btn btn-default" id="btn-print">
				<i class="fa fa-download" style="margin-right:6px;"></i>${sales_invoices.length > 0 ? 'Download Invoice' : 'Download Sales Order'}
			</button>
		`;
	}

	return buttons || '<span style="color:var(--text-muted);">No actions available.</span>';
}

function bind_action_events(page, doc, sales_invoices) {
	const $body = $(page.body);

	$body.find('#btn-submit-so').on('click', () => {
		frappe.confirm('Are you sure you want to submit this Sales Order? It will be locked from further edits.', () => {
			frappe.call({
				method: 'frappe.client.submit',
				args: { doc: doc },
				freeze: true,
				freeze_message: 'Submitting...',
				callback: function(r) {
					if (!r.exc) {
						frappe.show_alert({message: 'Sales Order Confirmed', indicator: 'green'});
						render_so_dashboard(page, doc.name); // Refresh
					}
				}
			});
		});
	});

	$body.find('#btn-create-invoice').on('click', () => {
		frappe.confirm('Create a Sales Invoice for this Sales Order and download the invoice PDF?', () => {
			frappe.call({
				method: 'crystal_alluminium_works.api.make_sales_invoice_from_sales_order',
				args: { source_name: doc.name },
				freeze: true,
				freeze_message: 'Creating Sales Invoice...',
				callback: function(r) {
					if (!r.exc && r.message) {
						const invoice_name = r.message;

						frappe.show_alert({message: `Sales Invoice ${invoice_name} created`, indicator: 'green'});
						frappe.set_route('sales-invoice-manager', invoice_name);
					}
				}
			});
		});
	});

	$body.find('#btn-print').on('click', () => {
		const latest_invoice = sales_invoices && sales_invoices.length > 0 ? sales_invoices[0] : null;
		if (latest_invoice) {
			download_manager_pdf('Sales Invoice', latest_invoice.name, 'Crystal Sales Invoice');
		} else {
			download_manager_pdf('Sales Order', doc.name, 'Crystal Sales Order');
		}
	});
}
