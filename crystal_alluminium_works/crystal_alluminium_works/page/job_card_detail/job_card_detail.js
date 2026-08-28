frappe.pages['job-card-detail'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Job Card',
		single_column: true
	});

	page.set_secondary_action('Back to Job Cards', function() {
		frappe.set_route('job-cards');
	});

	wrapper.page = page;
	load_ceiling_board_item_codes();
};

// Loaded from crystal_alluminium_works.api.get_ceiling_board_item_codes on page load —
// see CEILING_BOARD_ITEM_CODES in pricing_engine.py for the single source of truth.
// Seeded with the known codes as a fallback in case something renders before the fetch resolves.
let JC_CEILING_BOARD_ITEM_CODES = ['AMC', 'AGC'];

function load_ceiling_board_item_codes() {
	frappe.call({
		method: 'crystal_alluminium_works.api.get_ceiling_board_item_codes',
		callback: function (r) {
			JC_CEILING_BOARD_ITEM_CODES = r.message || JC_CEILING_BOARD_ITEM_CODES;
		}
	});
}

frappe.pages['job-card-detail'].on_page_show = function(wrapper) {
	let page = wrapper.page || (wrapper.control ? wrapper.control.page : null);
	let route = frappe.get_route();
	let route_options = typeof frappe.get_route_options === 'function'
		? frappe.get_route_options()
		: (frappe.route_options || {});
	let job_card_name = route[1] || route_options.job_card || null;

	if (!page) {
		page = $(wrapper).data('page');
	}

	if (!job_card_name) {
		render_job_card_detail_missing(page);
		return;
	}

	load_single_job_card_detail(page, job_card_name);
};

function load_single_job_card_detail(page, job_card_name) {
	let $body = $(page.body);
	page.set_title(`Job Card: ${job_card_name}`);
	$body.html('<div style="padding:40px;text-align:center;color:var(--text-muted);">Loading job card...</div>');

	frappe.call({
		method: 'crystal_alluminium_works.api.get_job_card_detail',
		args: { name: job_card_name },
		callback: function(r) {
			let message = r.message || {};
			if (!message.job_card) {
				render_job_card_detail_missing(page);
				return;
			}

			page.set_title(`Job Card: ${message.job_card.name}`);
			$body.html(render_single_job_card_detail(
				message.job_card,
				message.quotation,
				message.history || [],
				message.sales_invoices || [],
				{
					quotation_amendment_pending: !!message.quotation_amendment_pending,
					invoice_amendment_pending: !!message.invoice_amendment_pending
				},
				message.released_items || [],
				message.stock_deductions || []
			));
			bind_single_job_card_detail_events(
				page,
				$body,
				message.job_card,
				message.quotation,
				message.history || [],
				message.sales_invoices || [],
				message.released_items || [],
				message.stock_deductions || []
			);
		}
	});
}

function render_job_card_detail_missing(page) {
	$(page.body).html(`
		<div style="padding:40px;text-align:center;color:var(--text-muted);">
			<h3 style="margin:0 0 8px;">No Job Card Selected</h3>
			<p style="margin:0 0 18px;">Open a job card from the Job Cards list.</p>
			<button class="btn btn-primary" onclick="frappe.set_route('job-cards')">View Job Cards</button>
		</div>
	`);
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
	// Actual Mode of Payment names — the option IS the method, deposit derived from it.
	return normalize_job_card_payment_mode(payment_mode) === 'cash'
		? ['Cash', 'Paybill', 'Bank Transfer i.e RTGS, TT', 'PESALINK']
		: ['Cheque'];
}

function refresh_job_card_payment_options(dialog, selected_option) {
	let payment_mode = dialog.get_value('payment_mode');
	let options = get_job_card_payment_option_choices(payment_mode);
	let next_option = options.includes(selected_option) ? selected_option : options[0] || '';
	dialog.set_df_property('payment_option', 'options', options.join('\n'));
	dialog.set_value('payment_option', next_option);

	// The chosen payment_option is the Mode of Payment, so derive its deposit account.
	refresh_job_card_deposit_to_options(dialog);
}

function refresh_job_card_payment_capture_fields(dialog) {
	let has_new_payment = flt(dialog.get_value('payment_amount') || 0) > 0;

	// deposit_to is auto-derived (read-only) and only relevant when a deposit is captured.
	dialog.set_df_property('deposit_to', 'hidden', has_new_payment ? 0 : 1);

	// The visible Reference field is for bank transactions only (cheque/transfer number),
	// entered manually. M-Pesa/Paybill gets its own simulated transaction code generated
	// separately at save time (see generate_simulated_mpesa_reference) — the two are not
	// the same field and are not interchangeable.
	let mop_is_bank_type = (dialog._mode_of_payment_type || '').toLowerCase() === 'bank';
	let reference_visible = has_new_payment && mop_is_bank_type;
	dialog.set_df_property('reference', 'hidden', reference_visible ? 0 : 1);
	dialog.set_df_property('reference', 'reqd', reference_visible ? 1 : 0);
}

function generate_simulated_mpesa_reference() {
	// TODO: replace with the real M-Pesa transaction code once automated Paybill integration lands.
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	let code = '';
	for (let i = 0; i < 10; i++) {
		code += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return code;
}

async function refresh_job_card_deposit_to_options(dialog) {
	// The payment_option IS the Mode of Payment now.
	let payment_method = dialog.get_value('payment_option');

	if (!payment_method) {
		dialog._mode_of_payment_type = null;
		dialog._deposit_to_account_type = null;
		refresh_job_card_payment_capture_fields(dialog);
		return;
	}

	let response = await frappe.call({
		method: 'crystal_alluminium_works.api.get_mode_of_payment_account_info',
		args: { payment_method: payment_method }
	});
	let info = (response && response.message) || {};
	dialog._mode_of_payment_type = info.mode_of_payment_type || null;
	dialog._deposit_to_account_type = info.account_type || null;

	if (info.default_account) {
		await dialog.set_value('deposit_to', info.default_account);
	}

	refresh_job_card_payment_capture_fields(dialog);
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

function validate_job_card_payment_capture(dialog) {
	let has_new_payment = flt(dialog.get_value('payment_amount') || 0) > 0;

	if (!has_new_payment) {
		return true;
	}

	if (!dialog.get_value('payment_option')) {
		frappe.msgprint(__('Please select a Payment Method to record this payment.'));
		return false;
	}

	if (!dialog.get_value('deposit_to')) {
		frappe.msgprint(__('No deposit account is configured for the selected payment method. Please configure its Mode of Payment Account.'));
		return false;
	}

	let mop_is_bank_type = (dialog._mode_of_payment_type || '').toLowerCase() === 'bank';
	if (mop_is_bank_type && !(dialog.get_value('reference') || '').trim()) {
		frappe.msgprint(__('Please enter a Reference to record this payment.'));
		return false;
	}

	return true;
}

async function apply_job_card_customer_defaults(dialog) {
	let customer = dialog.get_value('customer');
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



function open_jc_operations_modal(page, job_card, quotation) {
	// First fetch the latest custom_sheet_consumption_json from the Job Card
	frappe.db.get_value('CAW Job Card', job_card.name, 'custom_sheet_consumption_json')
		.then(r => {
			let saved_data = {};
			try {
				if (r.message && r.message.custom_sheet_consumption_json) {
					saved_data = JSON.parse(r.message.custom_sheet_consumption_json);
				}
			} catch (e) {}
			
			// Get all Cut Size glass items OR Laminated glass items from quotation.items
			let items = ((quotation || {}).items || []).filter(item => 
				item.custom_product_category === 'Glass' && 
				(item.custom_glass_sale_mode === 'Resized' || item.custom_glass_type === 'Laminated')
			);
			
			if (items.length === 0) {
				frappe.msgprint('No Cut Size glass items found in this Job Card.');
				return;
			}

			let d = new frappe.ui.Dialog({
				title: 'JC Operations (Glass Sheet Consumption)',
				size: 'extra-large',
				fields: [
					{
						fieldname: 'html',
						fieldtype: 'HTML'
					}
				],
				primary_action_label: 'Save',
				primary_action: function() {
					let consumption = {};
					d.$wrapper.find('.jc-glass-item-row').each(function() {
						let row_name = $(this).attr('data-row-name');
						let item_sheets = [];
						$(this).find('.sheet-entry-row').each(function() {
							let item_consumed = $(this).find('.sheet-item-consumed-input').val();
							let size = $(this).find('.sheet-size-select').val();
							let pcs = flt($(this).find('.sheet-pcs-input').val());
							if (size && pcs > 0) {
								item_sheets.push({
									item_consumed: item_consumed,
									size: size,
									pcs: pcs
								});
							}
						});
						if (item_sheets.length > 0) {
							consumption[row_name] = item_sheets;
						}
					});
					d.get_primary_btn().prop('disabled', true);
					frappe.call({
						method: 'crystal_alluminium_works.api.save_jc_operations_consumption',
						args: {
							job_card_name: job_card.name,
							consumption_json: JSON.stringify(consumption)
						},
						callback: function(r) {
							d.hide();
							frappe.show_alert({message: 'Saved successfully', indicator: 'green'});
							load_single_job_card_detail(page, job_card.name);
						}
					});
				}
			});

			frappe.call({
				method: 'crystal_alluminium_works.api.get_glass_sheet_configs',
				callback: function(configs_r) {
					let configs = configs_r.message || [];
					
					frappe.call({
						method: 'crystal_alluminium_works.api.get_all_glass_items',
						callback: function(items_r) {
							let glass_items = items_r.message || [];

							let rows_html = items.map(item => {
								let existing_sheets = saved_data[item.name] || [];
								let show_placeholder = existing_sheets.length === 0;

								let sheets_html = existing_sheets.map(sheet => {
									let row_options = configs.map(c => `<option value="${c.size}" ${c.size === sheet.size ? 'selected' : ''}>${c.size}</option>`).join('');
									let current_item_consumed = sheet.item_consumed || item.item_code;
									
									return `
										<div class="sheet-entry-row" style="display: flex; gap: 8px; margin-bottom: 6px; align-items: center;">
											<input type="text" class="form-control input-sm sheet-item-consumed-input" list="all-glass-items" value="${jc_escape(current_item_consumed)}" style="min-width: 180px; display: inline-block;" placeholder="Item Consumed...">
											<select class="form-control input-sm sheet-size-select" style="min-width: 130px; display: inline-block;">
												<option value=""></option>
												${row_options}
											</select>
											<input type="number" class="form-control input-sm sheet-pcs-input" value="${sheet.pcs || ''}" min="1" step="1" style="text-align:right; width: 70px; display: inline-block;" placeholder="Pcs">
											<span class="sheet-balance-lbl text-info" style="font-size: 11px; font-weight: bold; min-width: 45px; text-align: center;">-</span>
											<button class="btn btn-default btn-xs add-sheet-btn" style="padding: 2px 6px;" title="Add Row"><i class="fa fa-plus text-primary"></i></button>
											<button class="btn btn-default btn-xs remove-sheet-btn" style="padding: 2px 6px;" title="Remove Row"><i class="fa fa-trash text-danger"></i></button>
										</div>
									`;
								}).join('');
								
								return `
									<tr class="jc-glass-item-row" data-row-name="${jc_escape(item.name)}">
										<td>${jc_escape(item.item_code)}</td>
										<td>${jc_escape(item.item_name)}</td>
										<td style="text-align:right;">${jc_number(item.custom_numbering, 0)}</td>
										<td style="text-align:right;">${jc_number(item.qty, 3)}</td>
										<td>${jc_escape(item.uom)}</td>
										<td class="sheets-container-cell">
											<div class="empty-sheets-placeholder" style="${show_placeholder ? '' : 'display: none;'} margin-bottom: 6px;">
												<span class="text-muted small">No sheets specified. </span>
												<button class="btn btn-default btn-xs add-sheet-btn" style="padding: 2px 6px;" title="Add Row"><i class="fa fa-plus text-primary"></i> Add Sheet</button>
											</div>
											<div class="sheets-list">
												${sheets_html}
											</div>
										</td>
									</tr>
								`;
							}).join('');

							let datalist_html = `
								<datalist id="all-glass-items">
									${glass_items.map(i => `<option value="${jc_escape(i.item_code)}">${jc_escape(i.item_name || i.item_code)}</option>`).join('')}
								</datalist>
							`;

							let html = `
								<table class="table table-bordered">
									<thead>
										<tr>
											<th>Item Code</th>
											<th>Item Name</th>
											<th style="text-align:right;">Pcs</th>
											<th style="text-align:right;">Qty</th>
											<th>UOM</th>
											<th>Sheets Consumed</th>
										</tr>
									</thead>
									<tbody>
										${rows_html}
									</tbody>
								</table>
								${datalist_html}
							`;
							
							d.fields_dict.html.$wrapper.html(html);

							// Bind event handlers inside the wrapper
							let check_save_button_visibility = function() {
								let has_sheets = false;
								let is_valid = true;
								
								d.$wrapper.find('.sheet-entry-row').each(function() {
									has_sheets = true;
									let item_consumed = $(this).find('.sheet-item-consumed-input').val();
									let size = $(this).find('.sheet-size-select').val();
									let pcs_val = $(this).find('.sheet-pcs-input').val();
									
									if (!item_consumed || !size || !pcs_val) {
										is_valid = false;
									} else {
										let pcs = parseFloat(pcs_val);
										if (isNaN(pcs) || pcs <= 0 || !Number.isInteger(pcs)) {
											is_valid = false;
										}
									}
								});
								
								// Also check if any jc-glass-item-row has 0 sheets.
								// If we want to force ALL glass items to be configured:
								let all_configured = true;
								d.$wrapper.find('.jc-glass-item-row').each(function() {
									if ($(this).find('.sheet-entry-row').length === 0) {
										all_configured = false;
									}
								});
								
								let $btn = d.get_primary_btn();
								if (has_sheets && is_valid && all_configured) {
									$btn.prop('disabled', false).attr('title', '');
									$btn.show();
								} else {
									let reason = !all_configured ? 'Add sheets for all glass items' : (!is_valid ? 'Ensure all rows have Item, Size, and valid whole Pcs > 0' : 'Please add sheets consumed');
									$btn.prop('disabled', true).attr('title', reason);
									$btn.show();
								}
							};

							d.$wrapper.on('click', '.add-sheet-btn', function() {
								let $cell = $(this).closest('.sheets-container-cell');
								let $list = $cell.find('.sheets-list');
								let row_options = configs.map(c => `<option value="${c.size}">${c.size}</option>`).join('');
								
								// Find parent row to get default item code
								let $row = $(this).closest('.jc-glass-item-row');
								let default_item = $row.find('td:first').text().trim();

								let new_row = `
									<div class="sheet-entry-row" style="display: flex; gap: 8px; margin-bottom: 6px; align-items: center;">
										<input type="text" class="form-control input-sm sheet-item-consumed-input" list="all-glass-items" value="${jc_escape(default_item)}" style="min-width: 180px; display: inline-block;" placeholder="Item Consumed...">
										<select class="form-control input-sm sheet-size-select" style="min-width: 130px; display: inline-block;">
											<option value=""></option>
											${row_options}
										</select>
										<input type="number" class="form-control input-sm sheet-pcs-input" value="" min="1" step="1" style="text-align:right; width: 70px; display: inline-block;" placeholder="Pcs">
										<span class="sheet-balance-lbl text-info" style="font-size: 11px; font-weight: bold; min-width: 45px; text-align: center;">-</span>
										<button class="btn btn-default btn-xs add-sheet-btn" style="padding: 2px 6px;" title="Add Row"><i class="fa fa-plus text-primary"></i></button>
										<button class="btn btn-default btn-xs remove-sheet-btn" style="padding: 2px 6px;" title="Remove Row"><i class="fa fa-trash text-danger"></i></button>
									</div>
								`;
								$list.append(new_row);
								$cell.find('.empty-sheets-placeholder').hide();
								check_save_button_visibility();
							});

							d.$wrapper.on('click', '.remove-sheet-btn', function() {
								let $cell = $(this).closest('.sheets-container-cell');
								$(this).closest('.sheet-entry-row').remove();
								
								let $list = $cell.find('.sheets-list');
								if ($list.children().length === 0) {
									$cell.find('.empty-sheets-placeholder').show();
								}
								check_save_button_visibility();
							});

							let update_sheet_row_balance = function($row) {
								let item_code = $row.find('.sheet-item-consumed-input').val();
								let size = $row.find('.sheet-size-select').val();
								let $lbl = $row.find('.sheet-balance-lbl');
								if (!item_code || !size) {
									$lbl.text('-');
									return;
								}
								frappe.call({
									method: 'crystal_alluminium_works.api.get_item_stock_balance',
									args: { item_code: item_code },
									callback: function(r) {
										let balances = r.message || [];
										let store_bal = balances.find(b => b.warehouse.includes('Stores')) || balances[0];
										if (store_bal && store_bal.sheet_bal && store_bal.sheet_bal[size] !== undefined) {
											$lbl.text(store_bal.sheet_bal[size] + 'pcs');
										} else {
											$lbl.text('0pcs');
										}
									}
								});
							};

							d.$wrapper.on('change awesomplete-selectcomplete input', '.sheet-item-consumed-input', function() {
								let $row = $(this).closest('.sheet-entry-row');
								update_sheet_row_balance($row);
								check_save_button_visibility();
							});
							d.$wrapper.on('change', '.sheet-size-select', function() {
								let $row = $(this).closest('.sheet-entry-row');
								update_sheet_row_balance($row);
								check_save_button_visibility();
							});
							d.$wrapper.on('input change', '.sheet-pcs-input', function() {
								let val = $(this).val();
								if (val) {
									let clean = val.replace(/[^0-9]/g, '');
									if (clean !== val) {
										$(this).val(clean);
									}
								}
								check_save_button_visibility();
							});

							d.show();
							check_save_button_visibility();

							// On initial show, trigger update for all rows
							setTimeout(function() {
								d.$wrapper.find('.sheet-entry-row').each(function() {
									update_sheet_row_balance($(this));
								});
							}, 200);
						}
					});
				}
			});
		});
}

async function open_edit_job_card_modal(page, job_card, quotation) {
	let quotation_customer = job_card.customer || job_card.customer_name || (quotation && (quotation.party_name || quotation.customer_name)) || '';
	let defaults = await get_job_card_customer_defaults(quotation_customer);
	let payment_limit = get_job_card_outstanding_balance(
		job_card,
		job_card.quotation_amount || (quotation && quotation.grand_total) || 0
	);

	if (payment_limit <= 0) {
		frappe.msgprint(__('This Job Card is fully settled and can no longer be edited.'));
		return;
	}

	var d;
	d = new frappe.ui.Dialog({
		title: 'Edit Job Card',
		fields: [
			{ fieldtype: 'Section Break', label: 'Customer Details' },
			{
				fieldtype: 'Select',
				fieldname: 'payment_mode',
				label: 'Payment Mode',
				options: 'Cash Customer\nInvoice Customer',
				default: job_card.payment_mode || get_job_card_payment_mode_label(defaults.payment_mode),
				reqd: 1,
				change: function() {
					refresh_job_card_payment_options(d);
				}
			},
			{
				fieldtype: 'Select',
				fieldname: 'payment_option',
				label: 'Payment Method',
				options: get_job_card_payment_option_choices(job_card.payment_mode || get_job_card_payment_mode_label(defaults.payment_mode)).join('\n'),
				default: job_card.payment_option || get_job_card_payment_option_choices(job_card.payment_mode || get_job_card_payment_mode_label(defaults.payment_mode))[0],
				reqd: 1,
				change: function() {
					refresh_job_card_deposit_to_options(d);
				}
			},
			{
				fieldtype: 'Link',
				fieldname: 'customer',
				label: 'Customer',
				options: 'Customer',
				default: job_card.customer || defaults.customer || quotation_customer,
				reqd: 1,
				change: function() {
					queue_job_card_customer_defaults(d);
				},
				get_query: function() {
					let current_payment_mode = d ? d.get_value('payment_mode') : (job_card.payment_mode || get_job_card_payment_mode_label(defaults.payment_mode));
					return {
						query: 'crystal_alluminium_works.api.search_builder_customers',
						filters: {
							payment_mode: normalize_job_card_payment_mode(current_payment_mode)
						}
					};
				}
			},
			{ fieldtype: 'Column Break' },
			{ fieldtype: 'Data', fieldname: 'customer_name', label: 'Customer Name', default: job_card.customer_name || defaults.customer_name || quotation_customer },
			{ fieldtype: 'Data', fieldname: 'customer_pin', label: 'Customer PIN', default: job_card.customer_pin || defaults.customer_pin || '' },
			{ fieldtype: 'Data', fieldname: 'phone_number', label: 'Phone Number', default: job_card.phone_number || defaults.phone_number || '' },
			{ fieldtype: 'Section Break', label: 'Payment' },
			{ fieldtype: 'Currency', fieldname: 'quotation_amount', label: 'Quotation Amount', read_only: 1, default: flt(job_card.quotation_amount || (quotation && quotation.grand_total) || 0) },
			{ fieldtype: 'Column Break' },
			{ fieldtype: 'Currency', fieldname: 'payment_amount', label: 'Payment Amount', default: payment_limit, reqd: 1 },
			{ fieldtype: 'Currency', fieldname: 'balance_amount', label: 'Balance', read_only: 1, default: payment_limit },
			{ fieldtype: 'Section Break', label: 'Record Payment' },
			{
				fieldtype: 'Link',
				fieldname: 'deposit_to',
				label: 'Deposit To',
				options: 'Account',
				read_only: 1,
				description: 'Auto-derived from the selected payment method.'
			},
			{ fieldtype: 'Column Break' },
			{ fieldtype: 'Data', fieldname: 'reference', label: 'Reference', hidden: 1 }
		],
		primary_action_label: 'Save',
		primary_action: function(values) {
			if (!validate_job_card_payment_amount(d)) {
				return;
			}

			if (!validate_job_card_payment_capture(d)) {
				return;
			}

			let new_payment_amount = flt(values.payment_amount || 0);

			frappe.call({
				method: 'crystal_alluminium_works.api.create_job_card_from_quotation',
				args: {
					quotation: job_card.quotation,
					customer: values.customer,
					customer_name: values.customer_name,
					payment_mode: normalize_job_card_payment_mode(values.payment_mode),
					payment_option: values.payment_option,
					customer_pin: values.customer_pin,
					phone_number: values.phone_number,
					quotation_amount: values.quotation_amount,
					payment_amount: new_payment_amount,
					balance_amount: values.balance_amount
				},
				freeze: true,
				freeze_message: 'Saving Job Card...',
				callback: function(r) {
					if (!r.message) {
						return;
					}

					let job_card_name = r.message;

					if (new_payment_amount > 0) {
						let is_phone_payment_method = (d._mode_of_payment_type || '').toLowerCase() === 'phone';
						let payment_reference = is_phone_payment_method
							? generate_simulated_mpesa_reference()
							: values.reference;

						frappe.call({
							method: 'crystal_alluminium_works.api.record_customer_payment',
							args: {
								customer: values.customer,
								job_card: job_card_name,
								amount: new_payment_amount,
								date: frappe.datetime.get_today(),
								payment_method: values.payment_option,
								deposit_to: values.deposit_to,
								reference: payment_reference
							},
							freeze: true,
							freeze_message: 'Recording Payment...',
							callback: function() {
								d.hide();
								frappe.show_alert({ message: `Job Card ${job_card_name} saved and payment recorded`, indicator: 'green' });
								load_single_job_card_detail(page, job_card_name);
							}
						});
						return;
					}

					d.hide();
					frappe.show_alert({ message: `Job Card ${job_card_name} saved`, indicator: 'green' });
					load_single_job_card_detail(page, job_card_name);
				}
			});
		}
	});

	d._payment_limit = payment_limit;
	d.show();
	refresh_job_card_payment_options(d, job_card.payment_option);
	if (job_card.customer || defaults.customer || quotation_customer) {
		await d.set_value('customer', job_card.customer || defaults.customer || quotation_customer);
	}
	update_job_card_balance(d);

	d.fields_dict.payment_amount.$input.on('input', function() {
		update_job_card_balance(d);
		refresh_job_card_payment_capture_fields(d);
	});

	d.fields_dict.payment_mode.$input.on('change', function() {
		// refresh_job_card_payment_options resets payment_option and re-derives deposit_to.
		refresh_job_card_payment_options(d);
		d.set_value('customer', '');
		d.set_value('customer_name', '');
		d.set_value('customer_pin', '');
		d.set_value('phone_number', '');
	});

	d.fields_dict.customer.$input.on('awesomplete-selectcomplete', function() {
		clearTimeout(d._job_card_customer_defaults_timer);
		d._job_card_customer_defaults_timer = setTimeout(function() {
			apply_job_card_customer_defaults(d);
		}, 500);
	});
}

// Refunds the full amount already paid on this Job Card, then immediately completes the
// cancellation — the only way to cancel a Job Card that has a recorded payment against it.
function open_job_card_refund_modal(page, job_card, refund_amount) {
	let d = new frappe.ui.Dialog({
		title: 'Refund & Cancel Job Card',
		fields: [
			{
				fieldtype: 'Currency',
				fieldname: 'amount',
				label: 'Refund Amount',
				default: refund_amount,
				read_only: 1
			},
			{ fieldtype: 'Column Break' },
			{
				fieldtype: 'Date',
				fieldname: 'date',
				label: 'Date',
				reqd: 1,
				default: frappe.datetime.get_today()
			},
			{ fieldtype: 'Section Break' },
			{
				fieldtype: 'Link',
				fieldname: 'payment_method',
				label: 'Payment Method',
				options: 'Mode of Payment',
				reqd: 1,
				onchange: function() {
					let payment_method = d.get_value('payment_method');
					if (!payment_method) {
						d._mode_of_payment_type = null;
						d.set_value('deposit_to', '');
						return;
					}
					frappe.call({
						method: 'crystal_alluminium_works.api.get_mode_of_payment_account_info',
						args: { payment_method: payment_method },
						callback: function(r) {
							let info = (r && r.message) || {};
							d._mode_of_payment_type = info.mode_of_payment_type || null;
							d.set_value('deposit_to', info.default_account || '');
							d.set_df_property('reference', 'reqd', (d._mode_of_payment_type || '').toLowerCase() === 'bank' ? 1 : 0);
						}
					});
				}
			},
			{ fieldtype: 'Column Break' },
			{
				fieldtype: 'Link',
				fieldname: 'deposit_to',
				label: 'Deposit To',
				options: 'Account',
				read_only: 1,
				description: 'Auto-derived from the selected payment method.'
			},
			{ fieldtype: 'Section Break' },
			{
				fieldtype: 'Data',
				fieldname: 'reference',
				label: 'Reference'
			}
		],
		primary_action_label: 'Refund & Cancel',
		primary_action: function(values) {
			frappe.call({
				method: 'crystal_alluminium_works.api.record_customer_payment',
				args: {
					customer: job_card.customer,
					payment_type: 'Refund',
					amount: refund_amount,
					date: values.date,
					payment_method: values.payment_method,
					deposit_to: values.deposit_to,
					reference: values.reference,
					allocations: JSON.stringify([{ job_card: job_card.name, amount: refund_amount }])
				},
				freeze: true,
				freeze_message: 'Recording Refund...',
				callback: function(r) {
					if (r.exc || !r.message) {
						return;
					}
					frappe.call({
						method: 'crystal_alluminium_works.api.cancel_job_card',
						args: { job_card_name: job_card.name },
						freeze: true,
						freeze_message: 'Cancelling Job Card...',
						callback: function(cancel_r) {
							if (!cancel_r.exc && cancel_r.message) {
								d.hide();
								frappe.show_alert({ message: 'Job Card Refunded and Cancelled', indicator: 'green' });
								load_single_job_card_detail(page, job_card.name);
							}
						}
					});
				}
			});
		}
	});

	d.show();
}

function can_create_invoice_from_job_card(job_card, quotation, history, sales_invoices) {
	let has_sales_invoice = !!((sales_invoices || []).length);
	let quotation_amount = flt(job_card.quotation_amount || (quotation && quotation.grand_total) || 0);
	let payment_amount = flt(job_card.payment_amount || 0);
	return !has_sales_invoice
		&& quotation_amount > 0
		&& Math.abs(payment_amount - quotation_amount) < 0.0001;
}

function can_create_partial_invoice_from_job_card(job_card, quotation) {
	// Both cash and invoice customers release and bill items the same way now: the
	// Job Card (not the invoice's payment state) is the single source of truth for
	// what's been paid, so there's no status/customer-type gate here beyond having
	// something left to release.
	return !!(quotation && quotation.has_releasable_items);
}

function is_full_partial_invoice_release(job_card, releases, $wrapper) {
	let has_remaining = false;
	let released_all_remaining = true;

	$wrapper.find('.jc-release-input').each(function() {
		let row_name = $(this).attr('data-row-name');
		let remaining = flt($(this).attr('data-remaining'));
		let released = flt(releases[row_name] || 0);
		if (remaining > 0.0001) {
			has_remaining = true;
			if (Math.abs(released - remaining) > 0.0001) {
				released_all_remaining = false;
				return false;
			}
		}
	});

	return has_remaining
		&& released_all_remaining
		&& flt(job_card.balance_amount || 0) > 0.0001;
}

function jc_escape(value) {
	return frappe.utils.escape_html(value === undefined || value === null ? '' : String(value));
}

function jc_short_uom(value) {
	let normalized = String(value || '').trim().toLowerCase();
	if (normalized === 'square foot') return 'sft';
	if (normalized === 'square meter') return 'sqm';
	if (['meter', 'metre', 'len'].includes(normalized)) return 'len';
	if (['running foot', 'rft'].includes(normalized)) return 'rft';
	if (normalized === 'nos') return 'nos';
	return value || '-';
}

function jc_number(value, precision) {
	return flt(value || 0, precision === undefined ? 2 : precision);
}

function get_job_card_print_table_context(quotation) {
	let items = quotation && quotation.items ? quotation.items : [];
	let parent_rows = items.filter(row => !row.custom_auto_generated);
	let has_color_rows = parent_rows.some(row => (row.custom_aluminium_color || '').trim());
	let has_glass_rows = parent_rows.some(row => (row.custom_product_category || '') === 'Glass');
	let non_ceiling_rows = parent_rows.filter(row => (row.custom_product_category || '') !== 'Ceiling');
	let ceiling_rows = parent_rows.filter(row => (row.custom_product_category || '') === 'Ceiling');
	let ceiling_board_item_codes = JC_CEILING_BOARD_ITEM_CODES;
	let ceiling_component_labels = ['Board', 'MainT', 'Sub Cross 4ft', 'Sub Cross 2ft', 'Wall angle'];
	let has_ceiling_bundle = ceiling_rows.some(row => flt(row.custom_ceiling_sq_m || 0) > 0);
	let ceiling_single_labels = [];

	ceiling_rows.forEach(row => {
		if (flt(row.custom_ceiling_sq_m || 0) > 0) return;
		let label = ceiling_board_item_codes.includes(row.item_code)
			? 'Board'
			: (row.item_name || row.item_code || '');
		if (label && !ceiling_single_labels.includes(label)) {
			ceiling_single_labels.push(label);
		}
	});

	return {
		items,
		non_ceiling_rows,
		ceiling_rows,
		has_color_rows,
		has_glass_rows,
		has_ceiling_bundle,
		ceiling_columns: has_ceiling_bundle ? ceiling_component_labels : ceiling_single_labels,
		ceiling_board_item_codes
	};
}

function get_job_card_child_rows(items, parent_idx) {
	return (items || []).filter(row => row.custom_auto_generated && row.custom_parent_row_idx === parent_idx);
}

function get_job_card_row_quantities(row) {
	let category = row.custom_product_category || '';
	let pieces = flt(row.qty || 0);
	let qty = flt(row.qty || 0);
	let uom = row.uom || '';

	if (category === 'Aluminium') {
		// Sold per whole piece; qty is the piece count. Falls back to the row's
		// own uom (old records may still say "Meter"/"len"; new ones say "Nos").
		qty = flt(row.qty || 0);
		uom = row.uom || 'Nos';
	} else if (category === 'Glass') {
		if (row.custom_glass_sale_mode === 'Full Sheet') {
			qty = flt(row.qty || 0);
			uom = 'Nos';
		} else if (row.custom_glass_sale_mode === 'Sheet') {
			pieces = flt(row.custom_sheet_pcs || 0);
			qty = flt(row.qty || 0);
			uom = row.uom || 'Square Foot';
		} else {
			qty = flt(row.custom_area_sqft || 0) * flt(row.qty || 0);
			uom = row.uom || 'Square Foot';
		}
	}

	return { pieces, qty, uom };
}

// Mirrors CEILING_COMPONENTS in pricing_engine.py so the modal's suggested pcs
// match what the server would derive from the same released sq m by default.
const CEILING_COMPONENTS = [
	{ item_code: 'Board', ratio: 0.36, mode: 'divide' },
	{ item_code: 'MainT', ratio: 0.25, mode: 'multiply' },
	{ item_code: 'Sub Cross 4ft', ratio: 1.33, mode: 'multiply' },
	{ item_code: 'Sub Cross 2ft', ratio: 1.33, mode: 'multiply' },
	{ item_code: 'Wall angle', ratio: 0.25, mode: 'multiply' }
];

function ceiling_component_default_pcs(release_sqm, component) {
	let qty = flt(release_sqm || 0);
	if (!qty || !component.ratio) return 0;
	let piece_qty = component.mode === 'divide' ? qty / component.ratio : qty * component.ratio;
	return Math.trunc(piece_qty);
}

// Quantity (in the row's native release unit) and its label, mirroring the server
// helper _get_partial_row_native_full so the modal and invoice agree on "remaining".
function get_partial_native_full(row) {
	let category = row.custom_product_category || '';
	if (category === 'Aluminium') return flt(row.qty || 0);
	if (category === 'Glass' && row.custom_glass_sale_mode === 'Sheet') return flt(row.custom_sheet_pcs || 0) || flt(row.qty || 0);
	if (category === 'Ceiling' && flt(row.custom_ceiling_sq_m || 0) > 0) return flt(row.custom_ceiling_sq_m || 0);
	return flt(row.qty || 0);
}

function get_partial_unit(row) {
	let category = row.custom_product_category || '';
	if (category === 'Ceiling' && flt(row.custom_ceiling_sq_m || 0) > 0) return 'sqm';
	return 'pcs';
}

function partial_line_amount(context, row) {
	let line_amount = flt(row.amount || 0);
	get_job_card_child_rows(context.items, row.idx).forEach(child => {
		line_amount += flt(child.amount || 0);
	});
	return line_amount;
}

function render_partial_release_cell(context, row) {
	let native_full = get_partial_native_full(row);
	let collected = flt(row.custom_collected_qty || 0);
	let remaining = flt(native_full - collected, 3);
	if (remaining < 0) remaining = 0;
	let line_amount = partial_line_amount(context, row);
	let disabled = remaining <= 0 ? 'disabled' : '';
    
	return `
		<td class="jc-preview-center">
			<input type="number" class="form-control input-xs jc-release-input"
				style="width:108px;display:inline-block;text-align:right;"
				min="0" max="${remaining}" step="any" value="${remaining}" ${disabled}
				data-row-name="${jc_escape(row.name || '')}"
				data-native-full="${native_full}"
				data-line-amount="${line_amount}"
				data-remaining="${remaining}">
			<div style="font-size:11px;color:var(--text-muted);">/ ${jc_number(remaining, 2)} ${jc_escape(get_partial_unit(row))}</div>
		</td>
	`;
}

// "Release" header with an inline Reset button that restores every release qty
// (and, for ceiling rows, every component pcs override) in this table back to
// its formula default — scoped to the clicked table via .closest('table').
function render_release_column_header() {
	return `
		<th class="jc-preview-center">
			Release
			<button type="button" class="btn btn-xs btn-default jc-reset-release-btn" style="margin-left:6px;padding:0 6px;">Reset</button>
		</th>
	`;
}

function render_job_card_partial_invoice_main_table(context) {
	if (!context.non_ceiling_rows.length) {
		return '';
	}

	let totals = { pcs: 0, qty: 0, holes: 0, notches: 0, amount: 0 };
	let rows = context.non_ceiling_rows.map(row => {
		let category = row.custom_product_category || '';
		let quantities = get_job_card_row_quantities(row);
		let child_rows = get_job_card_child_rows(context.items, row.idx);
		let line_amount = flt(row.amount || 0);
		let width_sides = cint(row.custom_polish_width_sides || 0);
		let height_sides = cint(row.custom_polish_height_sides || 0);

		child_rows.forEach(child => {
			line_amount += flt(child.amount || 0);
		});

		if (category === 'Glass' && !width_sides && !height_sides && cint(row.custom_polishing || 0)) {
			width_sides = 2;
			height_sides = 2;
		}

		let polish_sides = width_sides + height_sides;
		let display_width = category === 'Glass' ? (jc_number(row.custom_width_mm || 0, 0) || '-') : '-';
		let display_height = category === 'Glass' ? (jc_number(row.custom_height_mm || 0, 0) || '-') : '-';

		totals.pcs += flt(quantities.pieces || 0);
		totals.qty += flt(quantities.qty || 0);
		totals.holes += cint(row.custom_holes || 0);
		totals.notches += cint(row.custom_notches || 0);
		totals.amount += line_amount;

		return `
			<tr>
				<td class="jc-preview-strong">${jc_escape(row.item_code || '')}</td>
				<td>${jc_escape(row.item_name || row.item_code || '')}</td>
				${context.has_color_rows ? `<td class="jc-preview-center">${jc_escape(row.custom_aluminium_color || '-')}</td>` : ''}
				<td class="jc-preview-center">${jc_number(quantities.pieces, 2)}</td>
				<td class="jc-preview-center">${jc_number(quantities.qty, 3)}</td>
				<td class="jc-preview-center">${jc_escape(jc_short_uom(quantities.uom))}</td>
				<td class="jc-preview-center">${category === 'Glass' ? jc_escape(row.custom_numbering || '-') : '-'}</td>
				${context.has_glass_rows ? `
					<td class="jc-preview-center">${jc_escape(display_width)}</td>
					<td class="jc-preview-center">${jc_escape(display_height)}</td>
					<td class="jc-preview-center">${category === 'Glass' && polish_sides > 0 ? polish_sides : '-'}</td>
					<td class="jc-preview-center">${category === 'Glass' && cint(row.custom_holes || 0) > 0 ? cint(row.custom_holes || 0) : '-'}</td>
					<td class="jc-preview-center">${category === 'Glass' && cint(row.custom_notches || 0) > 0 ? cint(row.custom_notches || 0) : '-'}</td>
				` : ''}
				<td class="jc-preview-right jc-row-amount">${format_currency(line_amount)}</td>
				${render_partial_release_cell(context, row)}
			</tr>
		`;
	}).join('');

	return `
		<table class="jc-preview-table">
			<thead>
				<tr>
					<th>Code</th>
					<th>Item</th>
					${context.has_color_rows ? '<th class="jc-preview-center">Color</th>' : ''}
					<th class="jc-preview-center">Pcs</th>
					<th class="jc-preview-center">Qty</th>
					<th class="jc-preview-center">UOM</th>
					<th class="jc-preview-center">No</th>
					${context.has_glass_rows ? `
						<th class="jc-preview-center">Width</th>
						<th class="jc-preview-center">Height</th>
						<th class="jc-preview-center">Polish Sides</th>
						<th class="jc-preview-center">Holes</th>
						<th class="jc-preview-center">Notches</th>
					` : ''}
					<th class="jc-preview-right">Amount</th>
					${render_release_column_header()}
				</tr>
			</thead>
			<tbody>
				${rows}
				<tr>
					<td colspan="${context.has_color_rows ? 3 : 2}"></td>
					<td class="jc-preview-center jc-preview-strong">${jc_number(totals.pcs, 2)}</td>
					<td class="jc-preview-center jc-preview-strong">${jc_number(totals.qty, 3)}</td>
					${context.has_glass_rows ? `
						<td colspan="5"></td>
						<td class="jc-preview-center jc-preview-strong">${totals.holes}</td>
						<td class="jc-preview-center jc-preview-strong">${totals.notches}</td>
					` : '<td colspan="2"></td>'}
					<td class="jc-preview-right jc-preview-strong jc-main-total-amount">${format_currency(totals.amount)}</td>
					<td></td>
				</tr>
			</tbody>
		</table>
	`;
}

// Component pieces preview for a ceiling bundle row, computed from the release sq m
// the user currently has entered — same ratio formula the server uses, so what's shown
// here always matches what the invoice will actually generate.
function render_ceiling_component_preview_cells(row, release_sqm, columns) {
	return columns.map(column => {
		let component = CEILING_COMPONENTS.find(c => c.item_code === column);
		if (!component) return `<td class="jc-preview-center jc-ceiling-component-cell" data-row-name="${jc_escape(row.name || '')}" data-component="${jc_escape(column)}">-</td>`;
		let pcs = ceiling_component_default_pcs(release_sqm, component);
		return `<td class="jc-preview-center jc-ceiling-component-cell" data-row-name="${jc_escape(row.name || '')}" data-component="${jc_escape(column)}">${pcs}</td>`;
	}).join('');
}

function render_job_card_partial_invoice_ceiling_table(context) {
	if (!context.ceiling_rows.length) {
		return '';
	}

	let rows = context.ceiling_rows.map(row => {
		let is_bundle = flt(row.custom_ceiling_sq_m || 0) > 0;
		let ceiling_quantity = flt(row.custom_ceiling_sq_m || 0);
		let child_rows = get_job_card_child_rows(context.items, row.idx);
		let line_amount = flt(row.amount || 0);
		let item_label = context.ceiling_board_item_codes.includes(row.item_code)
			? 'Board'
			: (row.item_name || row.item_code || '');
		let display_uom = (is_bundle || context.ceiling_board_item_codes.includes(row.item_code))
			? (row.uom || 'Square Meter')
			: (row.uom || 'Nos');

		child_rows.forEach(child => {
			line_amount += flt(child.amount || 0);
		});

		// Bundle rows release on the same single sq-m input as every other row; the
		// component columns are a read-only preview derived from that release qty via
		// the standard ratios — pieces and money are no longer decoupled.
		let component_cells;
		if (is_bundle) {
			let native_full = get_partial_native_full(row);
			let collected = flt(row.custom_collected_qty || 0);
			let remaining = flt(native_full - collected, 3);
			if (remaining < 0) remaining = 0;
			component_cells = render_ceiling_component_preview_cells(row, remaining, context.ceiling_columns);
		} else {
			component_cells = context.ceiling_columns.map(column => {
				let value = item_label === column ? jc_number(row.qty || 0, 0) : '-';
				return `<td class="jc-preview-center">${jc_escape(value)}</td>`;
			}).join('');
		}

		return `
			<tr>
				<td class="jc-preview-center">${jc_escape(row.idx || '-')}</td>
				<td>${jc_escape(row.item_name || row.item_code || '')}</td>
				${context.has_ceiling_bundle ? `<td class="jc-preview-center">${is_bundle ? jc_number(ceiling_quantity, 3) : '-'}</td>` : ''}
				<td class="jc-preview-center">${jc_escape(jc_short_uom(display_uom))}</td>
				${component_cells}
				<td class="jc-preview-right jc-row-amount">${format_currency(line_amount)}</td>
				${render_partial_release_cell(context, row)}
			</tr>
		`;
	}).join('');

	return `
		<table class="jc-preview-table">
			<thead>
				<tr>
					<th class="jc-preview-center">No</th>
					<th>Item</th>
					${context.has_ceiling_bundle ? '<th class="jc-preview-center">Quantity</th>' : ''}
					<th class="jc-preview-center">UOM</th>
					${context.ceiling_columns.map(column => `<th class="jc-preview-center">${jc_escape(column)}</th>`).join('')}
					<th class="jc-preview-right">Amount</th>
					${render_release_column_header()}
				</tr>
			</thead>
			<tbody>${rows}</tbody>
		</table>
	`;
}

function render_job_card_partial_invoice_preview(quotation) {
	let context = get_job_card_print_table_context(quotation);
	let main_table = render_job_card_partial_invoice_main_table(context);
	let ceiling_table = render_job_card_partial_invoice_ceiling_table(context);

	return `
		<style>
			.jc-preview-wrap { overflow:auto; max-height:65vh; }
			.jc-preview-table { width:100%; min-width:920px; border-collapse:collapse; margin-bottom:16px; }
			.jc-preview-table th { background:#f8f9fa; color:#2c3e50; padding:9px 7px; border-bottom:2px solid #dee2e6; font-size:12px; white-space:nowrap; }
			.jc-preview-table td { padding:9px 7px; border-bottom:1px solid #dee2e6; vertical-align:middle; font-size:12px; }
			.jc-preview-center { text-align:center; white-space:nowrap; }
			.jc-preview-right { text-align:right; white-space:nowrap; }
			.jc-preview-strong { font-weight:700; white-space:nowrap; }
			.jc-release-input { height:32px !important; font-size:13px !important; padding:5px 8px !important; }
			.jc-release-input::-webkit-inner-spin-button,
			.jc-release-input::-webkit-outer-spin-button { min-height:28px; opacity:1; }
		</style>
		<div class="jc-preview-wrap">
			${main_table}
			${ceiling_table}
			${!main_table && !ceiling_table ? '<div style="padding:24px;text-align:center;color:var(--text-muted);">No printable quotation items found.</div>' : ''}
		</div>
		<div class="jc-release-summary" style="margin-top:12px;border-top:1px solid #dee2e6;padding-top:10px;max-width:280px;margin-left:auto;font-size:13px;">
			<div style="display:flex;justify-content:space-between;color:#6c757d;"><span>Subtotal</span><span data-summary="subtotal">-</span></div>
			<div style="display:flex;justify-content:space-between;color:#6c757d;"><span>V.A.T (16%)</span><span data-summary="vat">-</span></div>
			<div style="display:flex;justify-content:space-between;font-weight:700;font-size:16px;color:#2c3e50;margin-top:6px;"><span>Total</span><span data-summary="total">-</span></div>
		</div>
	`;
}

// Recompute the live Subtotal / VAT / Total. Every row (ceiling bundles included)
// contributes its released value: line_amount * release/native_full (VAT-exclusive).
// Also hides the primary action whenever the resulting total is 0 — there's nothing to
// invoice, so the button shouldn't even be there to click.
function update_partial_invoice_summary(dialog, $wrapper) {
	let subtotal = 0;
	let main_total = 0;
	$wrapper.find('.jc-release-input').each(function() {
		let $input = $(this);
		let native_full = flt($input.attr('data-native-full'));
		let line_amount = flt($input.attr('data-line-amount'));
		let remaining = flt($input.attr('data-remaining'));
		let release = flt($input.val());
		if (release < 0) release = 0;
		if (release > remaining) { release = remaining; $input.val(remaining); }
		if (native_full > 0) {
			let released_amount = line_amount * (release / native_full);
			subtotal += released_amount;
			main_total += released_amount;
			// Keep the row's Amount cell in step with what's actually being released, so
			// each line shows its contribution to this invoice instead of the full quoted value.
			$input.closest('tr').find('.jc-row-amount').text(format_currency(released_amount));
		}
	});
	$wrapper.find('.jc-main-total-amount').text(format_currency(main_total));
	let vat = subtotal * 0.16;
	let total = subtotal + vat;
	$wrapper.find('[data-summary="subtotal"]').text(format_currency(subtotal));
	$wrapper.find('[data-summary="vat"]').text(format_currency(vat));
	$wrapper.find('[data-summary="total"]').text(format_currency(total));
	dialog.get_primary_btn().toggle(total > 0.009);
	return subtotal;
}

// Live component pieces preview for a ceiling bundle row's release input: recomputes
// each component column from the currently typed release sq m via the standard ratios.
function refresh_ceiling_component_preview($input) {
	let remaining = flt($input.attr('data-remaining'));
	let release = flt($input.val());
	if (release < 0) release = 0;
	if (release > remaining) release = remaining;
	let row_name = $input.attr('data-row-name');
	CEILING_COMPONENTS.forEach(component => {
		let pcs = ceiling_component_default_pcs(release, component);
		$input.closest('table')
			.find(`.jc-ceiling-component-cell[data-row-name="${row_name}"][data-component="${component.item_code}"]`)
			.text(pcs);
	});
}

async function create_partial_invoice_from_job_card(job_card, dialog) {
	let $wrapper = dialog.fields_dict.preview.$wrapper;

	// Every row's release qty, ceiling bundles included — pieces and money both flow
	// from this same sq-m/qty release, same as quotation/sales order/full invoice.
	let releases = [];
	let releases_by_row = {};
	$wrapper.find('.jc-release-input').each(function() {
		let $input = $(this);
		let qty = flt($input.val());
		let remaining = flt($input.attr('data-remaining'));
		if (qty > remaining) qty = remaining;
		if (qty > 0) {
			let row_name = $input.attr('data-row-name');
			releases.push({ row: row_name, qty: qty });
			releases_by_row[row_name] = qty;
		}
	});

	if (!releases.length) {
		frappe.msgprint(__('Enter a quantity to release on the Release Items tab.'));
		return;
	}

	if (is_full_partial_invoice_release(job_card, releases_by_row, $wrapper)) {
		frappe.msgprint(__('You cannot release all remaining items while this Job Card still has an outstanding balance. Reduce the release quantity or clear the balance first.'));
		return;
	}

	let response = await frappe.call({
		method: 'crystal_alluminium_works.api.make_partial_sales_invoice_from_job_card',
		args: {
			job_card_name: job_card.name,
			releases: JSON.stringify(releases)
		},
		freeze: true,
		freeze_message: 'Creating partial Sales Invoice...'
	});

	if (response && !response.exc && response.message) {
		dialog.hide();
		frappe.show_alert({
			message: 'Partial Sales Invoice Created!',
			indicator: 'green'
		});
		frappe.set_route('sales-invoice-manager', response.message);
	}
}

async function open_partial_invoice_modal(job_card) {
	if (!job_card.quotation) {
		frappe.msgprint(__('This Job Card is not linked to a Quotation.'));
		return;
	}

	let quotation = await frappe.db.get_doc('Quotation', job_card.quotation);

	var dialog;
	dialog = new frappe.ui.Dialog({
		title: 'Partial Invoice',
		size: 'extra-large',
		fields: [
			{ fieldtype: 'HTML', fieldname: 'preview' }
		],
		primary_action_label: 'Create Partial Invoice',
		primary_action: function() {
			create_partial_invoice_from_job_card(job_card, dialog);
		}
	});

	// Dialog.hide() only hides the modal — it never removes $wrapper from <body>. Every
	// previous "Partial Invoice" opened in this session (even after navigating away)
	// stays parked in the DOM, and its elements share the same ids as this new dialog's
	// (the id is derived only from doctype + fieldname). Remove it once hidden so repeat
	// opens never accumulate stale, id-colliding dialogs.
	dialog.onhide = function() {
		dialog.$wrapper.remove();
	};

	let $wrapper = dialog.fields_dict.preview.$wrapper;
	$wrapper.html(render_job_card_partial_invoice_preview(quotation));
	$wrapper.on('input change', '.jc-release-input', function() {
		refresh_ceiling_component_preview($(this));
		update_partial_invoice_summary(dialog, $wrapper);
	});
	$wrapper.on('click', '.jc-reset-release-btn', function() {
		let $table = $(this).closest('table');
		$table.find('.jc-release-input').each(function() {
			$(this).val($(this).attr('data-remaining'));
			refresh_ceiling_component_preview($(this));
		});
		update_partial_invoice_summary(dialog, $wrapper);
	});
	update_partial_invoice_summary(dialog, $wrapper);
	dialog.show();
}

function bind_single_job_card_detail_events(page, $body, job_card, quotation, history, sales_invoices, released_items) {
	$body.off('click.job-card-detail');

	$body.on('click.job-card-detail', '[data-action="open-quotation"]', function() {
		if (job_card.quotation) {
			frappe.set_route('quotation-manager', job_card.quotation);
		}
	});

	$body.on('click.job-card-detail', '[data-action="open-customer"]', function() {
		if (job_card.customer) {
			frappe.set_route('customer-manager', job_card.customer);
		}
	});



	$body.on('click.job-card-detail', '[data-action="edit-job-card"]', function() {
		open_edit_job_card_modal(page, job_card, quotation);
	});

	$body.on('click.job-card-detail', '[data-action="jc-operations"]', function() {
		open_jc_operations_modal(page, job_card, quotation);
	});

	$body.on('click.job-card-detail', '[data-action="download-job-card-pdf"]', function() {
		let print_url = frappe.urllib.get_full_url(
			`/api/method/crystal_alluminium_works.api.download_crystal_job_card_pdf?name=${encodeURIComponent(job_card.name)}`
		);
		window.open(print_url, '_blank');
	});

	$body.on('click.job-card-detail', '[data-action="create-sales-invoice"]', function() {
		frappe.confirm(
			'<b>Create Sales Invoice?</b><br><br>This will create, submit, and mark the Sales Invoice as paid from the fully paid Job Card.',
			() => {
				frappe.call({
					method: 'crystal_alluminium_works.api.make_sales_invoice_from_job_card',
					args: { job_card_name: job_card.name },
					freeze: true,
					freeze_message: 'Creating paid Sales Invoice...',
					callback: function(r) {
						if (!r.exc && r.message) {
							frappe.show_alert({
								message: 'Paid Sales Invoice Created!',
								indicator: 'green'
							});
							frappe.set_route('sales-invoice-manager', r.message);
						}
					}
				});
			}
		);
	});

	$body.on('click.job-card-detail', '[data-action="cancel-job-card"]', function() {
		frappe.call({
			method: 'crystal_alluminium_works.api.get_job_card_cancel_eligibility',
			args: { job_card_name: job_card.name },
			freeze: true,
			callback: function(r) {
				let eligibility = r.message || {};
				if ((eligibility.reasons || []).length) {
					frappe.msgprint(eligibility.reasons.join('<br>'));
					return;
				}

				if (eligibility.needs_refund) {
					open_job_card_refund_modal(page, job_card, eligibility.refund_amount);
					return;
				}

				frappe.confirm(
					`<b>Cancel Job Card ${frappe.utils.escape_html(job_card.name)}?</b><br><br>This cannot be undone.`,
					() => {
						frappe.call({
							method: 'crystal_alluminium_works.api.cancel_job_card',
							args: { job_card_name: job_card.name },
							freeze: true,
							freeze_message: 'Cancelling Job Card...',
							callback: function(r) {
								if (!r.exc && r.message) {
									frappe.show_alert({ message: 'Job Card Cancelled', indicator: 'green' });
									load_single_job_card_detail(page, job_card.name);
								}
							}
						});
					}
				);
			}
		});
	});

	$body.on('click.job-card-detail', '[data-action="create-partial-invoice"]', function() {
		open_partial_invoice_modal(job_card);
	});

	$body.on('click.job-card-detail', '[data-action="go-to-sales-invoice"]', function() {
		if ((sales_invoices || [])[0] && sales_invoices[0].name) {
			frappe.set_route('sales-invoice-manager', sales_invoices[0].name);
		}
	});

	$body.on('click.job-card-detail', '[data-action="switch-jc-history-tab"]', function() {
		let tab = $(this).data('tab');
		let $card = $(this).closest('.jc-history-card');
		$card.find('.jc-history-tab').removeClass('active');
		$(this).addClass('active');
		$card.find('.jc-history-panel').removeClass('active');
		$card.find(`.jc-history-panel-${tab}`).addClass('active');
	});

	$body.on('change.job-card-detail', '[data-action="view-menu"]', function() {
		let action = $(this).val();
		if (action === 'open-quotation' && job_card.quotation) {
			frappe.set_route('quotation-manager', job_card.quotation);
		} else if (action === 'go-to-sales-invoice' && (sales_invoices || [])[0] && sales_invoices[0].name) {
			frappe.set_route('sales-invoice-manager', sales_invoices[0].name);
		} else if (action === 'open-customer' && job_card.customer) {
			frappe.set_route('customer-manager', job_card.customer);
		}
		$(this).val('');
	});

	$body.on('click.job-card-detail', '.jc-released-invoice-link', function(e) {
		e.preventDefault();
		let invoice_name = $(this).attr('data-invoice');
		if (invoice_name) {
			frappe.set_route('sales-invoice-manager', invoice_name);
		}
	});

	$body.on('click.job-card-detail', '[data-action="view-released-items"]', async function() {
		let invoice_name = $(this).attr('data-invoice');
		let items = (released_items || []).filter(entry => (entry.sales_invoice || '') === invoice_name);
		if (!job_card.quotation) {
			open_released_items_breakdown_modal(invoice_name, items, null);
			return;
		}
		// `quotation` here only carries summary fields from get_job_card_detail (no items
		// child table) — fetch the full doc, same as the partial invoice modal does.
		let full_quotation = await frappe.db.get_doc('Quotation', job_card.quotation);
		open_released_items_breakdown_modal(invoice_name, items, full_quotation);
	});
}

function open_released_items_breakdown_modal(invoice_name, items, quotation) {
	let dialog = new frappe.ui.Dialog({
		title: `Released Items — ${invoice_name || ''}`,
		size: 'extra-large',
		fields: [
			{
				fieldname: 'breakdown',
				fieldtype: 'HTML',
				options: render_released_items_breakdown_preview(items, quotation)
			}
		]
	});
	dialog.show();
}

// Reconstructs each released row's Pcs/Qty by scaling the order row's quantities
// down to the share that was actually released (qty_released / native full),
// since Glass/Aluminium/Ceiling rows split a single release across pieces and area.
function get_released_row_quantities(row, qty_released) {
	let category = row.custom_product_category || '';
	let base = get_job_card_row_quantities(row);

	if (category === 'Glass' && row.custom_glass_sale_mode === 'Sheet') {
		return { pieces: flt(qty_released || 0), qty: base.qty, uom: base.uom };
	}

	let native_full = get_partial_native_full(row);
	let ratio = native_full > 0 ? flt(qty_released || 0) / native_full : 0;
	return {
		pieces: jc_number(base.pieces * ratio, 2),
		qty: jc_number(base.qty * ratio, 3),
		uom: base.uom
	};
}

function build_released_breakdown_matches(items, quotation) {
	let rows_by_name = {};
	(quotation && quotation.items ? quotation.items : []).forEach(row => {
		rows_by_name[row.name] = row;
	});

	return (items || [])
		.map(entry => ({ entry, row: rows_by_name[entry.quotation_item] }))
		.filter(match => !!match.row);
}

function render_released_breakdown_main_table(matches, has_color_rows, has_glass_rows) {
	let main_matches = matches.filter(m => (m.row.custom_product_category || '') !== 'Ceiling');
	if (!main_matches.length) {
		return '';
	}

	let totals = { pcs: 0, qty: 0, holes: 0, notches: 0, amount: 0 };
	let rows = main_matches.map(({ entry, row }) => {
		let category = row.custom_product_category || '';
		let quantities = get_released_row_quantities(row, entry.qty_released);
		let line_amount = flt(entry.amount || 0);
		let width_sides = cint(row.custom_polish_width_sides || 0);
		let height_sides = cint(row.custom_polish_height_sides || 0);

		if (category === 'Glass' && !width_sides && !height_sides && cint(row.custom_polishing || 0)) {
			width_sides = 2;
			height_sides = 2;
		}

		let polish_sides = width_sides + height_sides;
		let display_width = category === 'Glass' ? (jc_number(row.custom_width_mm || 0, 0) || '-') : '-';
		let display_height = category === 'Glass' ? (jc_number(row.custom_height_mm || 0, 0) || '-') : '-';

		totals.pcs += flt(quantities.pieces || 0);
		totals.qty += flt(quantities.qty || 0);
		totals.holes += cint(row.custom_holes || 0);
		totals.notches += cint(row.custom_notches || 0);
		totals.amount += line_amount;

		return `
			<tr>
				<td class="jc-preview-strong">${jc_escape(row.item_code || '')}</td>
				<td>${jc_escape(row.item_name || row.item_code || '')}</td>
				${has_color_rows ? `<td class="jc-preview-center">${jc_escape(row.custom_aluminium_color || '-')}</td>` : ''}
				<td class="jc-preview-center">${jc_number(quantities.pieces, 2)}</td>
				<td class="jc-preview-center">${jc_number(quantities.qty, 3)}</td>
				<td class="jc-preview-center">${jc_escape(jc_short_uom(quantities.uom))}</td>
				<td class="jc-preview-center">${category === 'Glass' ? jc_escape(row.custom_numbering || '-') : '-'}</td>
				${has_glass_rows ? `
					<td class="jc-preview-center">${jc_escape(display_width)}</td>
					<td class="jc-preview-center">${jc_escape(display_height)}</td>
					<td class="jc-preview-center">${category === 'Glass' && polish_sides > 0 ? polish_sides : '-'}</td>
					<td class="jc-preview-center">${category === 'Glass' && cint(row.custom_holes || 0) > 0 ? cint(row.custom_holes || 0) : '-'}</td>
					<td class="jc-preview-center">${category === 'Glass' && cint(row.custom_notches || 0) > 0 ? cint(row.custom_notches || 0) : '-'}</td>
				` : ''}
				<td class="jc-preview-right jc-row-amount">${format_currency(line_amount)}</td>
			</tr>
		`;
	}).join('');

	return `
		<table class="jc-preview-table">
			<thead>
				<tr>
					<th>Code</th>
					<th>Item</th>
					${has_color_rows ? '<th class="jc-preview-center">Color</th>' : ''}
					<th class="jc-preview-center">Pcs</th>
					<th class="jc-preview-center">Qty</th>
					<th class="jc-preview-center">UOM</th>
					<th class="jc-preview-center">No</th>
					${has_glass_rows ? `
						<th class="jc-preview-center">Width</th>
						<th class="jc-preview-center">Height</th>
						<th class="jc-preview-center">Polish Sides</th>
						<th class="jc-preview-center">Holes</th>
						<th class="jc-preview-center">Notches</th>
					` : ''}
					<th class="jc-preview-right">Amount</th>
				</tr>
			</thead>
			<tbody>
				${rows}
				<tr>
					<td colspan="${has_color_rows ? 3 : 2}"></td>
					<td class="jc-preview-center jc-preview-strong">${jc_number(totals.pcs, 2)}</td>
					<td class="jc-preview-center jc-preview-strong">${jc_number(totals.qty, 3)}</td>
					${has_glass_rows ? `
						<td colspan="5"></td>
						<td class="jc-preview-center jc-preview-strong">${totals.holes}</td>
						<td class="jc-preview-center jc-preview-strong">${totals.notches}</td>
					` : '<td colspan="2"></td>'}
					<td class="jc-preview-right jc-preview-strong jc-main-total-amount">${format_currency(totals.amount)}</td>
				</tr>
			</tbody>
		</table>
	`;
}

function render_released_breakdown_ceiling_table(matches) {
	let ceiling_matches = matches.filter(m => (m.row.custom_product_category || '') === 'Ceiling');
	if (!ceiling_matches.length) {
		return '';
	}

	let ceiling_board_item_codes = JC_CEILING_BOARD_ITEM_CODES;
	let ceiling_component_labels = ['Board', 'MainT', 'Sub Cross 4ft', 'Sub Cross 2ft', 'Wall angle'];
	let has_ceiling_bundle = ceiling_matches.some(({ row }) => flt(row.custom_ceiling_sq_m || 0) > 0);
	let ceiling_single_labels = [];

	if (!has_ceiling_bundle) {
		ceiling_matches.forEach(({ row }) => {
			let label = ceiling_board_item_codes.includes(row.item_code)
				? 'Board'
				: (row.item_name || row.item_code || '');
			if (label && !ceiling_single_labels.includes(label)) {
				ceiling_single_labels.push(label);
			}
		});
	}

	let ceiling_columns = has_ceiling_bundle ? ceiling_component_labels : ceiling_single_labels;

	let rows = ceiling_matches.map(({ entry, row }, idx) => {
		let is_bundle = flt(row.custom_ceiling_sq_m || 0) > 0;
		let released_qty = flt(entry.qty_released || 0);
		let line_amount = flt(entry.amount || 0);
		let item_label = ceiling_board_item_codes.includes(row.item_code)
			? 'Board'
			: (row.item_name || row.item_code || '');
		let display_uom = (is_bundle || ceiling_board_item_codes.includes(row.item_code))
			? (row.uom || 'Square Meter')
			: (row.uom || 'Nos');

		let component_cells;
		if (is_bundle) {
			component_cells = ceiling_columns.map(column => {
				let component = CEILING_COMPONENTS.find(c => c.item_code === column);
				let pcs = component ? ceiling_component_default_pcs(released_qty, component) : '-';
				return `<td class="jc-preview-center">${pcs}</td>`;
			}).join('');
		} else {
			component_cells = ceiling_columns.map(column => {
				let value = item_label === column ? jc_number(released_qty, 0) : '-';
				return `<td class="jc-preview-center">${jc_escape(value)}</td>`;
			}).join('');
		}

		return `
			<tr>
				<td class="jc-preview-center">${idx + 1}</td>
				<td>${jc_escape(row.item_name || row.item_code || '')}</td>
				${has_ceiling_bundle ? `<td class="jc-preview-center">${is_bundle ? jc_number(released_qty, 3) : '-'}</td>` : ''}
				<td class="jc-preview-center">${jc_escape(jc_short_uom(display_uom))}</td>
				${component_cells}
				<td class="jc-preview-right jc-row-amount">${format_currency(line_amount)}</td>
			</tr>
		`;
	}).join('');

	return `
		<table class="jc-preview-table">
			<thead>
				<tr>
					<th class="jc-preview-center">No</th>
					<th>Item</th>
					${has_ceiling_bundle ? '<th class="jc-preview-center">Quantity</th>' : ''}
					<th class="jc-preview-center">UOM</th>
					${ceiling_columns.map(column => `<th class="jc-preview-center">${jc_escape(column)}</th>`).join('')}
					<th class="jc-preview-right">Amount</th>
				</tr>
			</thead>
			<tbody>${rows}</tbody>
		</table>
	`;
}

function render_released_items_breakdown_preview(items, quotation) {
	let matches = build_released_breakdown_matches(items, quotation);
	let has_color_rows = matches.some(({ row }) => (row.custom_aluminium_color || '').trim());
	let has_glass_rows = matches.some(({ row }) => (row.custom_product_category || '') === 'Glass');
	let main_table = render_released_breakdown_main_table(matches, has_color_rows, has_glass_rows);
	let ceiling_table = render_released_breakdown_ceiling_table(matches);

	return `
		<style>
			.jc-preview-wrap { overflow:auto; max-height:65vh; }
			.jc-preview-table { width:100%; min-width:920px; border-collapse:collapse; margin-bottom:16px; }
			.jc-preview-table th { background:#f8f9fa; color:#2c3e50; padding:9px 7px; border-bottom:2px solid #dee2e6; font-size:12px; white-space:nowrap; }
			.jc-preview-table td { padding:9px 7px; border-bottom:1px solid #dee2e6; vertical-align:middle; font-size:12px; }
			.jc-preview-center { text-align:center; white-space:nowrap; }
			.jc-preview-right { text-align:right; white-space:nowrap; }
			.jc-preview-strong { font-weight:700; white-space:nowrap; }
		</style>
		<div class="jc-preview-wrap">
			${main_table}
			${ceiling_table}
			${!main_table && !ceiling_table ? '<div style="padding:24px;text-align:center;color:var(--text-muted);">No released items found for this invoice.</div>' : ''}
		</div>
	`;
}

function render_job_card_history_rows(history, currency, job_card) {
	if (!history.length) {
		return `
			<tr>
				<td colspan="8" style="padding:24px;text-align:center;color:var(--text-muted);">
					No job card history yet.
				</td>
			</tr>
		`;
	}

	return history.map(function(entry) {
		return `
			<tr>
				<td>${frappe.utils.escape_html(entry.change_type || '-')}</td>
				<td>${frappe.utils.escape_html(entry.changed_by || '-')}</td>
				<td>${frappe.utils.escape_html(frappe.datetime.str_to_user(entry.creation || '') || '-')}</td>
				<td>${frappe.utils.escape_html(entry.payment_mode || '-')}</td>
				<td>${frappe.utils.escape_html(entry.payment_option || '-')}</td>
				<td style="text-align:right;">${format_currency(entry.amount_paid || 0, currency)}</td>
				<td style="text-align:right;">${format_currency(entry.payment_amount || 0, currency)}</td>
				<td style="text-align:right;font-weight:600;">${format_currency(entry.balance_amount || 0, currency)}</td>
			</tr>
		`;
	}).join('');
}

function group_released_items_by_invoice(released_items) {
	let groups_by_invoice = {};
	let order = [];

	released_items.forEach(function(entry) {
		let key = entry.sales_invoice || '';
		if (!groups_by_invoice[key]) {
			groups_by_invoice[key] = {
				sales_invoice: entry.sales_invoice,
				creation: entry.creation,
				is_partial: entry.is_partial,
				items_count: 0,
				amount: 0,
				items: []
			};
			order.push(key);
		}
		let group = groups_by_invoice[key];
		group.items.push(entry);
		group.items_count += 1;
		group.amount += flt(entry.amount || 0);
		// Keep the earliest creation/is_partial seen for the invoice-level row.
		if (entry.creation && (!group.creation || entry.creation < group.creation)) {
			group.creation = entry.creation;
		}
	});

	return order.map(key => groups_by_invoice[key]);
}

function render_job_card_released_items_rows(released_items, currency) {
	if (!released_items.length) {
		return `
			<tr>
				<td colspan="6" style="padding:24px;text-align:center;color:var(--text-muted);">
					No items released yet.
				</td>
			</tr>
		`;
	}

	let groups = group_released_items_by_invoice(released_items);

	return groups.map(function(group) {
		return `
			<tr>
				<td>${frappe.utils.escape_html(frappe.datetime.str_to_user(group.creation || '') || '-')}</td>
				<td>
					<a href="#" class="jc-released-invoice-link" data-invoice="${frappe.utils.escape_html(group.sales_invoice || '')}">
						${frappe.utils.escape_html(group.sales_invoice || '-')}
					</a>
				</td>
				<td style="text-align:right;">${group.items_count}</td>
				<td style="text-align:right;">${format_currency(group.amount || 0, currency)}</td>
				<td>${group.is_partial ? 'Partial' : 'Final'}</td>
				<td style="text-align:right;">
					<button class="btn btn-xs btn-default" data-action="view-released-items" data-invoice="${frappe.utils.escape_html(group.sales_invoice || '')}">
						View
					</button>
				</td>
			</tr>
		`;
	}).join('');
}

function render_job_card_history_section(history, released_items, currency, job_card, stock_deductions) {
	return `
		<div class="jc-detail-card jc-history-card">
			<div class="jc-history-tabs">
				<div class="jc-history-tab active" data-action="switch-jc-history-tab" data-tab="payments">Payment History</div>
				<div class="jc-history-tab" data-action="switch-jc-history-tab" data-tab="released">Released Items</div>
				<div class="jc-history-tab" data-action="switch-jc-history-tab" data-tab="deductions">Stock Deducted</div>
			</div>
			<div class="jc-history-panel jc-history-panel-payments active">
				<div class="jc-history-table-wrap">
					<table class="jc-history-table">
						<thead>
							<tr>
								<th>Change</th>
								<th>Changed By</th>
								<th>Changed On</th>
								<th>Payment Mode</th>
								<th>Payment Option</th>
								<th style="text-align:right;">Amount Paid</th>
								<th style="text-align:right;">Paid To Date</th>
								<th style="text-align:right;">Balance</th>
							</tr>
						</thead>
						<tbody>
							${render_job_card_history_rows(history, currency, job_card)}
						</tbody>
					</table>
				</div>
			</div>
			<div class="jc-history-panel jc-history-panel-released">
				<div class="jc-history-table-wrap">
					<table class="jc-history-table">
						<thead>
							<tr>
								<th>Released On</th>
								<th>Sales Invoice</th>
								<th style="text-align:right;">Items</th>
								<th style="text-align:right;">Amount</th>
								<th>Invoice Type</th>
								<th style="text-align:right;"></th>
							</tr>
						</thead>
						<tbody>
							${render_job_card_released_items_rows(released_items, currency)}
						</tbody>
					</table>
				</div>
			</div>
			<div class="jc-history-panel jc-history-panel-deductions">
				<div class="jc-history-deductions-scroll">
					${(function() {
						let glass_html = render_job_card_stock_deduction_group('Glass', stock_deductions, 'Glass', [
							{ label: 'Deducted On', align: 'left' },
							{ label: 'Saved On', align: 'left' },
							{ label: 'Item', align: 'left' },
							{ label: 'Qty (SFT)', align: 'right' },
							{ label: 'Glass Item Consumed', align: 'left' },
							{ label: 'Sheets Consumed', align: 'left' },
							{ label: 'Status', align: 'left' },
						], render_job_card_glass_deduction_row);
						let ceiling_html = render_job_card_stock_deduction_group('Ceiling', stock_deductions, 'Ceiling', [
							{ label: 'Deducted On', align: 'left' },
							{ label: 'Ceiling Product', align: 'left' },
							{ label: 'Item Consumed', align: 'left' },
							{ label: 'Qty', align: 'right' },
							{ label: 'UOM', align: 'left' },
							{ label: 'Status', align: 'left' },
						], render_job_card_generic_deduction_row);
						let other_html = render_job_card_stock_deduction_group('Other', stock_deductions, 'Other', [
							{ label: 'Deducted On', align: 'left' },
							{ label: 'Quotation Item', align: 'left' },
							{ label: 'Item Consumed', align: 'left' },
							{ label: 'Qty', align: 'right' },
							{ label: 'UOM', align: 'left' },
							{ label: 'Status', align: 'left' },
						], render_job_card_generic_deduction_row);

						let combined = glass_html + ceiling_html + other_html;
						if (!combined.trim()) {
							return `<div style="padding:24px;text-align:center;color:var(--text-muted);">No stock deductions recorded yet.</div>`;
						}
						return combined;
					})()}
				</div>
			</div>
		</div>
	`;
}

const JC_STOCK_DEDUCTION_BUCKETS = {
	Glass: ['Glass'],
	Ceiling: ['Ceiling'],
	Other: ['Aluminium', 'Fittings', 'Rubber', 'Silicone', ''],
};

function render_job_card_stock_deduction_group(title, stock_deductions, bucket, columns, row_renderer) {
	let categories = JC_STOCK_DEDUCTION_BUCKETS[bucket] || [];
	let rows = (stock_deductions || []).filter(function(row) {
		return categories.indexOf(row.category || '') !== -1;
	});

	if (!rows.length) {
		return '';
	}

	return `
		<div class="jc-history-deduction-group">
			<div class="jc-history-table-wrap">
				<table class="jc-history-table">
					<thead>
						<tr>
							${columns.map(function(col) {
								return `<th${col.align === 'right' ? ' style="text-align:right;"' : ''}>${jc_escape(col.label)}</th>`;
							}).join('')}
						</tr>
					</thead>
					<tbody>
						${rows.map(row_renderer).join('')}
					</tbody>
				</table>
			</div>
		</div>
	`;
}

function jc_stock_deduction_status_label(row) {
	if (row.status === 'Saved') {
		return `<span class="label" style="background-color: #ff9800; color: white; font-weight: normal; padding: 3px 8px; border-radius: 4px;">Saved</span>`;
	}
	return `<span class="label" style="background-color: #4caf50; color: white; font-weight: normal; padding: 3px 8px; border-radius: 4px;">Deducted</span>`;
}

function jc_stock_deduction_date_str(row) {
	let date_str = row.posting_date ? frappe.datetime.str_to_user(row.posting_date || '') : '';
	if (row.posting_time && date_str) {
		date_str += ' ' + row.posting_time;
	}
	return date_str;
}

function render_job_card_glass_deduction_row(row) {
	let date_str = jc_stock_deduction_date_str(row);

	let saved_on_str = row.saved_on ? frappe.datetime.str_to_user(row.saved_on.split(' ')[0]) : '';
	if (row.saved_on && row.saved_on.split(' ')[1]) {
		saved_on_str += ' ' + row.saved_on.split(' ')[1].substring(0, 8);
	}

	let sheets_display = '-';
	let sheets_title = '';
	if (row.sheets_consumed && row.sheets_consumed !== '-') {
		sheets_title = row.sheets_consumed;
		let parts = row.sheets_consumed.split(', ');
		if (parts.length > 1) {
			sheets_display = parts[0] + '...';
		} else {
			sheets_display = row.sheets_consumed;
		}
	}

	return `
		<tr>
			<td>${jc_escape(date_str || '-')}</td>
			<td>${jc_escape(saved_on_str || '-')}</td>
			<td>${jc_escape(row.quotation_item_name || row.quotation_item_code || '-')}</td>
			<td style="text-align:right;">${jc_number(row.qty, 4)}</td>
			<td>${jc_escape(row.item_code || '')}</td>
			<td title="${jc_escape(sheets_title)}">${jc_escape(sheets_display)}</td>
			<td>${jc_stock_deduction_status_label(row)}</td>
		</tr>
	`;
}

function render_job_card_generic_deduction_row(row) {
	let date_str = jc_stock_deduction_date_str(row);

	return `
		<tr>
			<td>${jc_escape(date_str || '-')}</td>
			<td>${jc_escape(row.quotation_item_name || row.quotation_item_code || '-')}</td>
			<td>${jc_escape(row.item_code || '')}</td>
			<td style="text-align:right;">${jc_number(row.qty, 4)}</td>
			<td>${jc_escape(row.uom || '-')}</td>
			<td>${jc_stock_deduction_status_label(row)}</td>
		</tr>
	`;
}

function render_single_job_card_detail(job_card, quotation, history, sales_invoices, flags, released_items, stock_deductions) {
	released_items = released_items || [];
	flags = flags || {};
	let amendment_pending = !!(flags.quotation_amendment_pending || flags.invoice_amendment_pending);
	let currency = quotation && quotation.currency ? quotation.currency : 'KES';
	let balance = flt(job_card.balance_amount || 0);
	let has_sales_invoice = !!((sales_invoices || []).length);
	// Edit Job Card / the deposit counter has no GL and no invoice behind it — it's a
	// cash-customer concept. Invoices (partial or full) only ever track released items,
	// never payments, for either customer type — so Edit Job Card must stay available even
	// after a Sales Invoice exists — it's the only way a cash customer who hadn't fully
	// paid before their first release can ever reach a zero balance.
	let is_cash_customer = normalize_job_card_payment_mode(job_card.payment_mode) === 'cash';
	let can_edit_job_card = balance > 0 && is_cash_customer;
	let can_create_invoice = can_create_invoice_from_job_card(job_card, quotation, history, sales_invoices);
	// Cash and invoice customers both release/bill items through the same Partial
	// Invoice flow now — the Job Card tracks payment/balance either way, and the
	// invoice itself never touches GL.
	let can_create_partial_invoice = !amendment_pending && can_create_partial_invoice_from_job_card(job_card, quotation);
	
	let glass_ops_rows = ((quotation || {}).items || [])
		.filter(item => 
			item.custom_product_category === 'Glass' && 
			(item.custom_glass_type === 'Laminated' || 
			 item.custom_glass_sale_mode === 'Resized' || 
			 item.custom_glass_sale_mode === 'Custom')
		)
		.map(item => item.name);
		
	let glass_ops_configured = true;
	if (glass_ops_rows.length > 0) {
		let saved_consumption = {};
		try {
			if (job_card.custom_sheet_consumption_json) {
				saved_consumption = JSON.parse(job_card.custom_sheet_consumption_json);
			}
		} catch (e) {}
		
		glass_ops_configured = glass_ops_rows.every(row_name => {
			let rows = saved_consumption[row_name] || [];
			return rows.length > 0 && rows.some(r => r.item_consumed && r.size && r.pcs > 0);
		});
	}
	let glass_ops_pending = glass_ops_rows.length > 0 && !glass_ops_configured;

	if (amendment_pending || glass_ops_pending) {
		can_edit_job_card = amendment_pending ? false : can_edit_job_card;
		can_create_invoice = false;
		can_create_partial_invoice = false;
	}
	let primary_invoice_action = !has_sales_invoice && can_create_invoice
		? '<button class="btn btn-primary" data-action="create-sales-invoice">Create Sales Invoice</button>'
		: '';

	// Best-effort visibility check — cancel_job_card re-verifies all of this server-side
	// via get_job_card_cancel_eligibility before actually cancelling.
	let has_submitted_invoice = (sales_invoices || []).some(inv => cint(inv.docstatus) === 1);
	let has_released_items = !!((released_items || []).length);
	let has_deducted_stock = (stock_deductions || []).some(d => d.status === 'Deducted');
	// A recorded payment no longer hard-blocks cancel — clicking Cancel routes through a
	// refund step first (see cancel-job-card handler). Only invoice/release/stock block here.
	let can_cancel_job_card = job_card.status !== 'Cancelled'
		&& !has_submitted_invoice
		&& !has_released_items
		&& !has_deducted_stock;
	let status_color = {
		'Draft': 'orange',
		'In Progress': 'blue',
		'Completed': 'green',
		'Cancelled': 'red'
	}[job_card.status] || 'grey';

	return `
	<style>
		.jc-detail-page { max-width: 1320px; margin: 0 auto; padding: 24px 16px; }
		.jc-detail-header { display:flex; justify-content:space-between; gap:18px; align-items:flex-start; margin-bottom:24px; }
		.jc-detail-title h2 { margin:0 0 8px; font-size:20px; line-height:1.25; font-weight:700; color:var(--heading-color); }
		.jc-detail-title p { margin:0; color:var(--text-muted); font-size:14px; }
		.jc-detail-actions { display:flex; gap:8px; flex-wrap:nowrap; justify-content:flex-end; overflow-x:auto; padding-bottom:2px; }
		.jc-detail-actions .btn { flex:0 0 auto; white-space:nowrap; }
		.jc-detail-actions .jc-download-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; }
		.jc-detail-grid { display:grid; grid-template-columns: minmax(0, 1.15fr) minmax(300px, 0.85fr); gap:18px; }
		.jc-detail-card { background:var(--fg-color); border:1px solid var(--border-color); border-radius:8px; box-shadow:var(--shadow-xs); overflow:hidden; }
		.jc-detail-card h4 { margin:0; padding:14px 18px; font-size:14px; font-weight:700; color:var(--heading-color); border-bottom:1px solid var(--border-color); background:var(--subtle-fg); }
		.jc-detail-card-body { padding:18px; }
		.jc-detail-fields { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:16px; }
		.jc-detail-field span { display:block; font-size:12px; color:var(--text-muted); margin-bottom:5px; text-transform:uppercase; letter-spacing:.4px; }
		.jc-detail-field strong { display:block; font-size:14px; color:var(--text-color); overflow-wrap:anywhere; }
		.jc-detail-payments { display:grid; gap:12px; }
		.jc-payment-row { display:flex; justify-content:space-between; gap:14px; padding:12px 0; border-bottom:1px solid var(--border-color); }
		.jc-payment-row:last-child { border-bottom:0; }
		.jc-payment-row span { color:var(--text-muted); }
		.jc-payment-row strong { font-size:16px; color:var(--text-color); }
		.jc-status-pill { display:inline-flex; align-items:center; gap:6px; padding:5px 10px; border-radius:999px; font-size:12px; font-weight:700; background:var(--subtle-fg); color:var(--text-color); }
		.jc-status-dot { width:8px; height:8px; border-radius:50%; background:${status_color}; display:inline-block; }
		.jc-history-card { margin-top:18px; }
		.jc-history-tabs { display:flex; gap:8px; padding:0 18px; border-bottom:1px solid var(--border-color); background:var(--subtle-fg); }
		.jc-history-tab { padding:14px 6px; cursor:pointer; user-select:none; font-size:13px; font-weight:600; color:var(--text-muted); border-bottom:2px solid transparent; }
		.jc-history-tab.active { color:var(--heading-color); border-bottom-color:var(--text-color); }
		.jc-history-panel { display:none; padding:0; }
		.jc-history-panel.active { display:block; }
		.jc-history-table-wrap { overflow-x:auto; }
		.jc-history-deduction-group { margin-bottom:20px; }
		.jc-history-deduction-group:last-child { margin-bottom:0; }
		.jc-history-deductions-scroll { max-height: 420px; overflow-y: auto; padding-bottom:4px; }
		.jc-history-table { width:100%; min-width:760px; border-collapse:collapse; }
		.jc-history-panel-deductions .jc-history-table { width: max-content; min-width: 100%; }
		.jc-history-table th { padding:12px 18px; font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:.4px; background:var(--subtle-fg); border-bottom:1px solid var(--border-color); text-align:left; }
		.jc-history-panel-deductions .jc-history-table th,
		.jc-history-panel-deductions .jc-history-table td { white-space: nowrap; }
		.jc-history-table td { padding:14px 18px; font-size:14px; color:var(--text-color); border-bottom:1px solid var(--border-color); vertical-align:top; }
		.jc-history-table tbody tr:last-child td { border-bottom:0; }
		@media (max-width: 800px) {
			.jc-detail-header { display:block; }
			.jc-detail-actions { justify-content:flex-start; margin-top:16px; }
			.jc-detail-grid { grid-template-columns: 1fr; }
			.jc-detail-fields { grid-template-columns: 1fr; }
		}
	</style>

	<div class="jc-detail-page">
		<div class="jc-detail-header">
			<div class="jc-detail-title">
				<h2>${frappe.utils.escape_html(job_card.name || '')}</h2>
			</div>
			<div class="jc-detail-actions">
				<button class="btn btn-primary jc-download-btn" data-action="download-job-card-pdf" title="Download Job Card PDF">${frappe.utils.icon('download', 'sm')}<span>Download</span></button>
				${can_create_partial_invoice ? '<button class="btn btn-default" data-action="create-partial-invoice">Partial Invoice</button>' : ''}
				${primary_invoice_action}
				<select class="form-control" data-action="view-menu" style="width:auto; min-width:170px; flex:0 0 auto;">
					<option value="">View</option>
					${job_card.quotation ? '<option value="open-quotation">Open Quotation</option>' : ''}
					${has_sales_invoice ? '<option value="go-to-sales-invoice">Go to Sales Invoice</option>' : ''}
					${job_card.customer ? '<option value="open-customer">Open Customer</option>' : ''}
				</select>
				<button class="btn btn-default" data-action="jc-operations">JC Operations</button>
				${can_edit_job_card ? '<button class="btn btn-primary" data-action="edit-job-card">Edit Job Card</button>' : ''}
				${can_cancel_job_card ? '<button class="btn btn-danger" data-action="cancel-job-card">Cancel Job Card</button>' : ''}
			</div>
		</div>

		${amendment_pending ? `
			<div style="margin-bottom:18px; padding:12px 16px; border-radius:8px; background:#fff7e6; border:1px solid #ffe1a8; color:#8a5a00; font-size:13px;">
				<strong>Amendment in progress.</strong>
				${flags.quotation_amendment_pending ? 'A Quotation amendment is pending — submit or discard the amended Quotation in the Quotation Manager. ' : ''}
				${flags.invoice_amendment_pending ? 'A cancelled Sales Invoice is awaiting its amendment — submit the amended invoice in the Sales Invoice Manager. ' : ''}
				Payments, invoices and releases are paused until it is resolved.
			</div>
		` : ''}

		${glass_ops_pending ? `
			<div style="margin-bottom:18px; padding:12px 16px; border-radius:8px; background:#fff3cd; border:1px solid #ffeeba; color:#856404; font-size:13px;">
				<strong>Glass Sheet Consumption Pending</strong><br>
				Please configure the raw materials/sheets consumed by Cut/Resized and Laminated Glass items via <b>JC Operations</b> to enable releases and billing.
			</div>
		` : ''}

		<div class="jc-detail-grid">
			<div class="jc-detail-card">
				<h4>Customer Details</h4>
				<div class="jc-detail-card-body">
					<div class="jc-detail-fields">
						${render_job_card_detail_field('Customer', job_card.customer_name || job_card.customer)}
						${render_job_card_detail_field('Payment Mode', job_card.payment_mode)}
						${render_job_card_detail_field('Payment Option', job_card.payment_option)}
						${render_job_card_detail_field('PIN', job_card.customer_pin)}
						${render_job_card_detail_field('Phone Number', job_card.phone_number)}
						${render_job_card_detail_field('Quotation', job_card.quotation)}
						${render_job_card_detail_field('Quotation Status', quotation ? quotation.status : '')}
					</div>
				</div>
			</div>

			<div class="jc-detail-card">
				<h4>Payment Summary</h4>
				<div class="jc-detail-card-body">
					<div class="jc-detail-payments">
						<div class="jc-payment-row"><span>Quotation Amount</span><strong>${format_currency(job_card.quotation_amount || 0, currency)}</strong></div>
						<div class="jc-payment-row"><span>Amount Paid</span><strong>${format_currency(job_card.payment_amount || 0, currency)}</strong></div>
						<div class="jc-payment-row"><span>Balance</span><strong>${format_currency(balance, currency)}</strong></div>
					</div>
				</div>
			</div>

			<div class="jc-detail-card">
				<h4>Job Status</h4>
				<div class="jc-detail-card-body">
					<span class="jc-status-pill"><span class="jc-status-dot"></span>${frappe.utils.escape_html(job_card.status || 'Draft')}</span>
				</div>
			</div>

			<div class="jc-detail-card">
				<h4>Record Info</h4>
				<div class="jc-detail-card-body">
					<div class="jc-detail-fields">
						${render_job_card_detail_field('Created', frappe.datetime.str_to_user(job_card.creation || ''))}
						${render_job_card_detail_field('Last Updated', frappe.datetime.str_to_user(job_card.modified || ''))}
					</div>
				</div>
			</div>
		</div>

		${render_job_card_history_section(history, released_items, currency, job_card, stock_deductions)}
	</div>
	`;
}

function render_job_card_detail_field(label, value) {
	return `
		<div class="jc-detail-field">
			<span>${frappe.utils.escape_html(label || '')}</span>
			<strong>${frappe.utils.escape_html(value || '-')}</strong>
		</div>
	`;
}
