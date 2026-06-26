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
};

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
				}
			));
			bind_single_job_card_detail_events(
				page,
				$body,
				message.job_card,
				message.quotation,
				message.history || [],
				message.sales_invoices || []
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
	return normalize_job_card_payment_mode(payment_mode) === 'cash'
		? ['Cash', 'Paybill', 'Cheque']
		: ['Cheque'];
}

function refresh_job_card_payment_options(dialog, selected_option) {
	let payment_mode = dialog.get_value('payment_mode');
	let options = get_job_card_payment_option_choices(payment_mode);
	let next_option = options.includes(selected_option) ? selected_option : options[0] || '';
	dialog.set_df_property('payment_option', 'options', options.join('\n'));
	dialog.set_value('payment_option', next_option);

	refresh_job_card_payment_capture_fields(dialog);
}

function refresh_job_card_payment_capture_fields(dialog) {
	let has_new_payment = flt(dialog.get_value('payment_amount') || 0) > 0;

	['payment_method', 'deposit_to'].forEach(function(fieldname) {
		dialog.set_df_property(fieldname, 'hidden', has_new_payment ? 0 : 1);
	});
	dialog.set_df_property('payment_method', 'reqd', has_new_payment ? 1 : 0);
	dialog.set_df_property('deposit_to', 'reqd', has_new_payment ? 1 : 0);

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
	let payment_method = dialog.get_value('payment_method');

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

	if (!dialog.get_value('payment_method')) {
		frappe.msgprint(__('Please select a Payment Method to record this payment.'));
		return false;
	}

	if (!dialog.get_value('deposit_to')) {
		frappe.msgprint(__('Please select a Deposit To account to record this payment.'));
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
				label: 'Payment Option',
				options: get_job_card_payment_option_choices(job_card.payment_mode || get_job_card_payment_mode_label(defaults.payment_mode)).join('\n'),
				default: job_card.payment_option || get_job_card_payment_option_choices(job_card.payment_mode || get_job_card_payment_mode_label(defaults.payment_mode))[0],
				reqd: 1
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
				fieldname: 'payment_method',
				label: 'Payment Method',
				options: 'Mode of Payment',
				change: function() {
					refresh_job_card_deposit_to_options(d);
				},
				get_query: function() {
					let is_invoice = normalize_job_card_payment_mode(d.get_value('payment_mode')) === 'invoice';
					if (is_invoice) {
						return {
							filters: {
								name: ['in', ['Bank Transfer i.e RTGS, TT']]
							}
						};
					}

					return {
						filters: {
							name: ['not in', ['USD TRANSFER', 'Petty Cash', 'petty-cash', 'petty cash']]
						}
					};
				}
			},
			{ fieldtype: 'Column Break' },
			{
				fieldtype: 'Link',
				fieldname: 'deposit_to',
				label: 'Deposit To',
				options: 'Account',
				get_query: function() {
					let account_type = d && d._deposit_to_account_type;
					return {
						filters: {
							account_type: account_type || ['in', ['Bank', 'Cash']],
							is_group: 0,
							name: ['not in', ['DTB Bank USD A/C - CA', 'I & M USD A/C - CA']]
						}
					};
				}
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
								payment_method: values.payment_method,
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
		refresh_job_card_payment_options(d);
		d.set_value('customer', '');
		d.set_value('customer_name', '');
		d.set_value('customer_pin', '');
		d.set_value('phone_number', '');
		d.set_value('payment_method', '');
		d.set_value('deposit_to', '');
	});

	d.fields_dict.customer.$input.on('awesomplete-selectcomplete', function() {
		clearTimeout(d._job_card_customer_defaults_timer);
		d._job_card_customer_defaults_timer = setTimeout(function() {
			apply_job_card_customer_defaults(d);
		}, 500);
	});
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
	// Invoice customers can still release and bill collected items even when the
	// running paid amount is negative and the job card remains in Draft.
	let is_invoice_customer = normalize_job_card_payment_mode(job_card.payment_mode) === 'invoice';
	return ((job_card.status || '').trim() === 'In Progress' || is_invoice_customer)
		&& !!(quotation && quotation.has_releasable_items);
}

function can_release_goods_from_job_card(job_card, quotation) {
	// Cash customers release goods without an invoice while goods remain to release. Their
	// payments flow separately through the deposit path; releases are pure fulfilment
	// tracking and are allowed regardless of balance. The "no final invoice yet" condition
	// is applied at the call site via has_sales_invoice.
	let is_cash_customer = normalize_job_card_payment_mode(job_card.payment_mode) === 'cash';
	return is_cash_customer && !!(quotation && quotation.has_cash_releasable_items);
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
	let ceiling_board_item_codes = ['AMC', 'AGC'];
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
		// Sold per piece (1 piece = 1 metre); qty is the piece count.
		qty = flt(row.qty || 0);
		uom = row.uom || 'Meter';
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
	// Cash release tracks uninvoiced collection in custom_released_qty (kept separate from
	// custom_collected_qty, which the invoice-customer partial flow uses).
	let collected = flt((context.cash_release ? row.custom_released_qty : row.custom_collected_qty) || 0);
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
			let collected = flt((context.cash_release ? row.custom_released_qty : row.custom_collected_qty) || 0);
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

function render_job_card_partial_invoice_preview(quotation, cash_release) {
	let context = get_job_card_print_table_context(quotation);
	// Cash release (no invoice): goods only — no payment, so no Subtotal/VAT/Total summary,
	// and "remaining" is sourced from custom_released_qty.
	context.cash_release = !!cash_release;
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
		${context.cash_release ? '' : `
		<div class="jc-release-summary" style="margin-top:12px;border-top:1px solid #dee2e6;padding-top:10px;max-width:280px;margin-left:auto;font-size:13px;">
			<div style="display:flex;justify-content:space-between;color:#6c757d;"><span>Subtotal</span><span data-summary="subtotal">-</span></div>
			<div style="display:flex;justify-content:space-between;color:#6c757d;"><span>V.A.T (16%)</span><span data-summary="vat">-</span></div>
			<div style="display:flex;justify-content:space-between;font-weight:700;font-size:16px;color:#2c3e50;margin-top:6px;"><span>Total</span><span data-summary="total">-</span></div>
		</div>
		`}
	`;
}

// Recompute the live Subtotal / VAT / Total. Every row (ceiling bundles included)
// contributes its released value: line_amount * release/native_full (VAT-exclusive).
function update_partial_invoice_summary($wrapper) {
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
	$wrapper.find('[data-summary="subtotal"]').text(format_currency(subtotal));
	$wrapper.find('[data-summary="vat"]').text(format_currency(vat));
	$wrapper.find('[data-summary="total"]').text(format_currency(subtotal + vat));
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

// The partial modal always records a payment (its amount is derived from the released
// items), so the payment-capture fields are always shown — only the manual Reference
// field is gated on bank-type modes of payment (phone modes get an auto reference).
function refresh_partial_payment_reference(dialog) {
	let mop_is_bank_type = (dialog._mode_of_payment_type || '').toLowerCase() === 'bank';
	dialog.set_df_property('reference', 'hidden', mop_is_bank_type ? 0 : 1);
	dialog.set_df_property('reference', 'reqd', mop_is_bank_type ? 1 : 0);
}

async function refresh_partial_deposit_to_options(dialog) {
	let payment_method = dialog.get_value('payment_method');

	if (!payment_method) {
		dialog._mode_of_payment_type = null;
		dialog._deposit_to_account_type = null;
		refresh_partial_payment_reference(dialog);
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

	refresh_partial_payment_reference(dialog);
}

function refresh_partial_payment_options(dialog, selected_option) {
	let options = get_job_card_payment_option_choices(dialog.get_value('payment_mode'));
	let next_option = options.includes(selected_option) ? selected_option : options[0] || '';
	dialog.set_df_property('payment_option', 'options', options.join('\n'));
	dialog.set_value('payment_option', next_option);
}

function validate_partial_payment_capture(dialog) {
	if (!dialog.get_value('payment_method')) {
		frappe.msgprint(__('Please select a Payment Method to record this payment.'));
		return false;
	}
	if (!dialog.get_value('deposit_to')) {
		frappe.msgprint(__('Please select a Deposit To account to record this payment.'));
		return false;
	}
	let mop_is_bank_type = (dialog._mode_of_payment_type || '').toLowerCase() === 'bank';
	if (mop_is_bank_type && !(dialog.get_value('reference') || '').trim()) {
		frappe.msgprint(__('Please enter a Reference to record this payment.'));
		return false;
	}
	return true;
}

async function create_partial_invoice_from_job_card(job_card, dialog) {
	let $wrapper = dialog.fields_dict.preview.$wrapper;

	// Every row's release qty, ceiling bundles included — pieces and money both flow
	// from this same sq-m/qty release, same as quotation/sales order/full invoice.
	let releases = [];
	$wrapper.find('.jc-release-input').each(function() {
		let $input = $(this);
		let qty = flt($input.val());
		let remaining = flt($input.attr('data-remaining'));
		if (qty > remaining) qty = remaining;
		if (qty > 0) {
			releases.push({ row: $input.attr('data-row-name'), qty: qty });
		}
	});

	if (!releases.length) {
		frappe.msgprint(__('Enter a quantity to release on the Release Items tab.'));
		return;
	}

	if (!validate_partial_payment_capture(dialog)) {
		return;
	}

	let is_phone_payment_method = (dialog._mode_of_payment_type || '').toLowerCase() === 'phone';
	let payment_reference = is_phone_payment_method
		? generate_simulated_mpesa_reference()
		: dialog.get_value('reference');

	let payment_details = {
		customer: dialog.get_value('customer'),
		customer_name: dialog.get_value('customer_name'),
		customer_pin: dialog.get_value('customer_pin'),
		phone_number: dialog.get_value('phone_number'),
		payment_mode: normalize_job_card_payment_mode(dialog.get_value('payment_mode')),
		payment_option: dialog.get_value('payment_option'),
		payment_method: dialog.get_value('payment_method'),
		deposit_to: dialog.get_value('deposit_to'),
		reference: payment_reference
	};

	let response = await frappe.call({
		method: 'crystal_alluminium_works.api.make_partial_sales_invoice_from_job_card',
		args: {
			job_card_name: job_card.name,
			releases: JSON.stringify(releases),
			payment_details: JSON.stringify(payment_details)
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
	let payment_mode_label = job_card.payment_mode || get_job_card_payment_mode_label(job_card.payment_mode);
	let payment_options = get_job_card_payment_option_choices(payment_mode_label);

	var dialog;
	dialog = new frappe.ui.Dialog({
		title: 'Partial Invoice',
		size: 'extra-large',
		fields: [
			{ fieldtype: 'Tab Break', fieldname: 'tab_release', label: 'Release Items', parent: 'CAW Job Card', hidden: false },
			{ fieldtype: 'HTML', fieldname: 'preview' },
			{ fieldtype: 'Tab Break', fieldname: 'tab_payment', label: 'Payment Details', parent: 'CAW Job Card', hidden: false },
			{ fieldtype: 'Section Break', label: 'Customer Details', hide_border: true },
			{
				fieldtype: 'Select',
				fieldname: 'payment_mode',
				label: 'Payment Mode',
				options: 'Cash Customer\nInvoice Customer',
				default: payment_mode_label,
				reqd: 1
			},
			{
				fieldtype: 'Select',
				fieldname: 'payment_option',
				label: 'Payment Option',
				options: payment_options.join('\n'),
				default: job_card.payment_option || payment_options[0],
				reqd: 1
			},
			{
				fieldtype: 'Link',
				fieldname: 'customer',
				label: 'Customer',
				options: 'Customer',
				default: job_card.customer,
				reqd: 1,
				change: function() {
					queue_job_card_customer_defaults(dialog);
				},
				get_query: function() {
					// `customer` has a `default`, so Frappe validates it synchronously while
					// the Dialog constructor is still running — before the `dialog = new
					// frappe.ui.Dialog(...)` assignment below completes. At that moment this
					// closure's `dialog` is still undefined, so guard against it (the resulting
					// filter is irrelevant for that first, internal default-value validation).
					return {
						query: 'crystal_alluminium_works.api.search_builder_customers',
						filters: {
							payment_mode: normalize_job_card_payment_mode(dialog && dialog.get_value('payment_mode'))
						}
					};
				}
			},
			{ fieldtype: 'Column Break' },
			{ fieldtype: 'Data', fieldname: 'customer_name', label: 'Customer Name', default: job_card.customer_name },
			{ fieldtype: 'Data', fieldname: 'customer_pin', label: 'Customer PIN', default: job_card.customer_pin || '' },
			{ fieldtype: 'Data', fieldname: 'phone_number', label: 'Phone Number', default: job_card.phone_number || '' },
			{ fieldtype: 'Section Break', label: 'Record Payment' },
			{
				fieldtype: 'Link',
				fieldname: 'payment_method',
				label: 'Payment Method',
				options: 'Mode of Payment',
				reqd: 1,
				change: function() {
					refresh_partial_deposit_to_options(dialog);
				},
				get_query: function() {
					let is_invoice = normalize_job_card_payment_mode(dialog.get_value('payment_mode')) === 'invoice';
					if (is_invoice) {
						return { filters: { name: ['in', ['Bank Transfer i.e RTGS, TT']] } };
					}
					return { filters: { name: ['not in', ['USD TRANSFER', 'Petty Cash', 'petty-cash', 'petty cash']] } };
				}
			},
			{ fieldtype: 'Column Break' },
			{
				fieldtype: 'Link',
				fieldname: 'deposit_to',
				label: 'Deposit To',
				options: 'Account',
				reqd: 1,
				get_query: function() {
					let account_type = dialog && dialog._deposit_to_account_type;
					return {
						filters: {
							account_type: account_type || ['in', ['Bank', 'Cash']],
							is_group: 0,
							name: ['not in', ['DTB Bank USD A/C - CA', 'I & M USD A/C - CA']]
						}
					};
				}
			},
			{ fieldtype: 'Column Break' },
			{ fieldtype: 'Data', fieldname: 'reference', label: 'Reference', hidden: 1 }
		],
		primary_action_label: 'Create Partial Invoice',
		primary_action: function() {
			create_partial_invoice_from_job_card(job_card, dialog);
		}
	});

	// Dialog.hide() only hides the modal — it never removes $wrapper from <body>. Every
	// previous "Partial Invoice" opened in this session (even after navigating away)
	// stays parked in the DOM, and its Tab Break elements share the same ids as this
	// new dialog's (the id is derived only from doctype + fieldname). Remove it once
	// hidden so repeat opens never accumulate stale, id-colliding dialogs.
	dialog.onhide = function() {
		dialog.$wrapper.remove();
	};

	function refresh_partial_invoice_primary_action_visibility() {
		let $primary_btn = dialog && dialog.get_primary_btn ? dialog.get_primary_btn() : null;
		if (!$primary_btn || !$primary_btn.length) {
			return;
		}

		// Read the active state straight off the Tab object (dialog.tabs, since
		// frappe.ui.Dialog extends Layout) rather than matching the active nav button's
		// label text. Text-matching is fragile — it silently breaks on translation, and
		// can momentarily read stale DOM if called before the tab's own click handler
		// (tab.js, not a Bootstrap tab plugin — no 'shown.bs.tab' event is ever fired
		// here) has applied the 'active' class.
		let payment_tab = (dialog.tabs || []).find(tab => tab.df.fieldname === 'tab_payment');
		$primary_btn.toggle(!!(payment_tab && payment_tab.is_active()));
	}

	let $wrapper = dialog.fields_dict.preview.$wrapper;
	$wrapper.html(render_job_card_partial_invoice_preview(quotation));
	$wrapper.on('input change', '.jc-release-input', function() {
		refresh_ceiling_component_preview($(this));
		update_partial_invoice_summary($wrapper);
	});
	$wrapper.on('click', '.jc-reset-release-btn', function() {
		let $table = $(this).closest('table');
		$table.find('.jc-release-input').each(function() {
			$(this).val($(this).attr('data-remaining'));
			refresh_ceiling_component_preview($(this));
		});
		update_partial_invoice_summary($wrapper);
	});
	update_partial_invoice_summary($wrapper);
	dialog.show();
	refresh_partial_invoice_primary_action_visibility();

	// tab.js builds its own click-driven tabs (not the Bootstrap tab plugin), so no
	// 'shown.bs.tab' event is ever emitted here — only react to the click itself.
	dialog.$wrapper.on('click', '.nav-link, .nav-item a', function() {
		setTimeout(refresh_partial_invoice_primary_action_visibility, 0);
	});

	refresh_partial_payment_options(dialog, job_card.payment_option);

	if (job_card.customer) {
		await dialog.set_value('customer', job_card.customer);
		await dialog.set_value('customer_name', job_card.customer_name || '');
		await dialog.set_value('customer_pin', job_card.customer_pin || '');
		await dialog.set_value('phone_number', job_card.phone_number || '');
	}

	dialog.fields_dict.payment_mode.$input.on('change', function() {
		refresh_partial_payment_options(dialog);
		dialog.set_value('customer', '');
		dialog.set_value('customer_name', '');
		dialog.set_value('customer_pin', '');
		dialog.set_value('phone_number', '');
		dialog.set_value('payment_method', '');
		dialog.set_value('deposit_to', '');
	});

	dialog.fields_dict.customer.$input.on('awesomplete-selectcomplete', function() {
		clearTimeout(dialog._job_card_customer_defaults_timer);
		dialog._job_card_customer_defaults_timer = setTimeout(function() {
			apply_job_card_customer_defaults(dialog);
		}, 500);
	});
}

// Cash-only "Release Goods": records what the customer physically collected without creating
// a Sales Invoice or touching payment. Reuses the partial invoice's Release Items renderers in
// cash_release mode (no Payment Details tab, no totals, no ceiling paid-now/Balance). Payment is
// handled separately via the deposit / Edit Job Card path; the single full invoice is cut at the
// end once fully paid.
async function open_release_goods_modal(page, job_card) {
	if (!job_card.quotation) {
		frappe.msgprint(__('This Job Card is not linked to a Quotation.'));
		return;
	}

	let quotation = await frappe.db.get_doc('Quotation', job_card.quotation);

	var dialog;
	dialog = new frappe.ui.Dialog({
		title: 'Release Goods',
		size: 'extra-large',
		fields: [
			{ fieldtype: 'HTML', fieldname: 'preview' }
		],
		primary_action_label: 'Release Goods',
		primary_action: function() {
			create_job_card_release(page, job_card, dialog);
		}
	});

	// See open_partial_invoice_modal: remove the wrapper on hide so repeat opens never
	// accumulate stale, id-colliding dialogs.
	dialog.onhide = function() {
		dialog.$wrapper.remove();
	};

	let $wrapper = dialog.fields_dict.preview.$wrapper;
	$wrapper.html(render_job_card_partial_invoice_preview(quotation, true));
	// Keep the per-row Amount cell reactive to the released qty (informational value of the
	// goods); the summary panel is absent in cash mode so its updates are harmless no-ops.
	$wrapper.on('input change', '.jc-release-input', function() {
		refresh_ceiling_component_preview($(this));
		update_partial_invoice_summary($wrapper);
	});
	$wrapper.on('click', '.jc-reset-release-btn', function() {
		let $table = $(this).closest('table');
		$table.find('.jc-release-input').each(function() {
			$(this).val($(this).attr('data-remaining'));
			refresh_ceiling_component_preview($(this));
		});
		update_partial_invoice_summary($wrapper);
	});
	update_partial_invoice_summary($wrapper);
	dialog.show();
}

async function create_job_card_release(page, job_card, dialog) {
	let $wrapper = dialog.fields_dict.preview.$wrapper;

	// Every row's release qty, ceiling bundles included.
	let releases = [];
	$wrapper.find('.jc-release-input').each(function() {
		let $input = $(this);
		let qty = flt($input.val());
		let remaining = flt($input.attr('data-remaining'));
		if (qty > remaining) qty = remaining;
		if (qty > 0) {
			releases.push({ row: $input.attr('data-row-name'), qty: qty });
		}
	});

	if (!releases.length) {
		frappe.msgprint(__('Enter a quantity to release.'));
		return;
	}

	let response = await frappe.call({
		method: 'crystal_alluminium_works.api.make_job_card_release',
		args: {
			job_card_name: job_card.name,
			releases: JSON.stringify(releases)
		},
		freeze: true,
		freeze_message: 'Recording goods release...'
	});

	if (response && !response.exc && response.message) {
		dialog.hide();
		frappe.show_alert({
			message: 'Goods released',
			indicator: 'green'
		});
		load_single_job_card_detail(page, job_card.name);
	}
}

function bind_single_job_card_detail_events(page, $body, job_card, quotation, history, sales_invoices) {
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

	$body.on('click.job-card-detail', '[data-action="create-partial-invoice"]', function() {
		open_partial_invoice_modal(job_card);
	});

	$body.on('click.job-card-detail', '[data-action="release-goods"]', function() {
		open_release_goods_modal(page, job_card);
	});

	$body.on('click.job-card-detail', '[data-action="go-to-sales-invoice"]', function() {
		if ((sales_invoices || [])[0] && sales_invoices[0].name) {
			frappe.set_route('sales-invoice-manager', sales_invoices[0].name);
		}
	});

	$body.on('click.job-card-detail', '[data-action="toggle-history"]', function() {
		let $header = $(this);
		let $chevron = $header.find('.jc-history-chevron');
		let $historyBody = $header.closest('.jc-history-card').find('.jc-history-body');
		let isOpen = $historyBody.hasClass('open');
		$historyBody.toggleClass('open', !isOpen);
		$chevron.toggleClass('open', !isOpen);
		$header.toggleClass('open', !isOpen);
	});
}

function render_job_card_history_rows(history, currency) {
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

function render_job_card_history_section(history, currency) {
	return `
		<div class="jc-detail-card jc-history-card">
			<div class="jc-history-accordion-header" data-action="toggle-history">
				<h4>Job Card History</h4>
				<span class="jc-history-chevron">&#8964;</span>
			</div>
			<div class="jc-history-body">
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
							${render_job_card_history_rows(history, currency)}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	`;
}

function render_single_job_card_detail(job_card, quotation, history, sales_invoices, flags) {
	flags = flags || {};
	let amendment_pending = !!(flags.quotation_amendment_pending || flags.invoice_amendment_pending);
	let currency = quotation && quotation.currency ? quotation.currency : 'KES';
	let balance = flt(job_card.balance_amount || 0);
	let has_sales_invoice = !!((sales_invoices || []).length);
	// Once any Sales Invoice exists for this Job Card (partial or full), all further
	// money must flow through the Partial Invoice modal — it's the only path that
	// creates an invoice and keeps released qty / ceiling pieces in sync. Edit Job
	// Card only ever bumped a raw payment_amount with no invoice or release record
	// behind it, so allowing it after invoicing started would let payments and
	// balance drift away from what was actually invoiced/released. Customer detail
	// fields (name/PIN/phone) are still editable from the Partial Invoice modal's
	// Payment Details tab, so nothing is lost by hiding this button.
	// Edit Job Card / the deposit counter has no GL and no invoice behind it — it's a
	// cash-customer concept. For invoice customers, money flows through their POS-settled
	// partial invoices, so a deposit here would double-count; hide it for them entirely
	// (their customer-detail edits remain on the Partial Invoice modal's Payment Details tab).
	let is_cash_customer = normalize_job_card_payment_mode(job_card.payment_mode) === 'cash';
	let can_edit_job_card = balance > 0 && !has_sales_invoice && is_cash_customer;
	let can_create_invoice = can_create_invoice_from_job_card(job_card, quotation, history, sales_invoices);
	// Cash customers release goods WITHOUT an invoice (Release Goods); invoice customers
	// keep the per-release Partial Invoice flow. The two are mutually exclusive by mode.
	let can_create_partial_invoice = !amendment_pending && !is_cash_customer && can_create_partial_invoice_from_job_card(job_card, quotation);
	let can_release_goods = !amendment_pending && !has_sales_invoice && can_release_goods_from_job_card(job_card, quotation);
	if (amendment_pending) {
		can_edit_job_card = false;
		can_create_invoice = false;
	}
	let primary_invoice_action = has_sales_invoice
		? '<button class="btn btn-primary" data-action="go-to-sales-invoice">Go to Sales Invoice</button>'
		: (can_create_invoice ? '<button class="btn btn-primary" data-action="create-sales-invoice">Create Sales Invoice</button>' : '');
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
		.jc-history-accordion-header { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; cursor:pointer; user-select:none; border-bottom:0; transition:background 0.15s; }
		.jc-history-accordion-header:hover { background:var(--control-bg); }
		.jc-history-accordion-header.open { border-bottom:1px solid var(--border-color); }
		.jc-history-accordion-header h4 { margin:0; padding:0; border:0; background:none; font-size:14px; font-weight:700; color:var(--heading-color); }
		.jc-history-chevron { transition:transform 0.2s ease; color:var(--text-muted); line-height:1; font-size:16px; }
		.jc-history-chevron.open { transform:rotate(180deg); }
		.jc-history-body { display:none; padding:0; }
		.jc-history-body.open { display:block; }
		.jc-history-table-wrap { overflow-x:auto; }
		.jc-history-table { width:100%; min-width:760px; border-collapse:collapse; }
		.jc-history-table th { padding:12px 18px; font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:.4px; background:var(--subtle-fg); border-bottom:1px solid var(--border-color); text-align:left; }
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
				<button class="btn btn-default" data-action="open-quotation">Open Quotation</button>
				<button class="btn btn-primary jc-download-btn" data-action="download-job-card-pdf" title="Download Job Card PDF">${frappe.utils.icon('download', 'sm')}<span>Download</span></button>
				${can_create_partial_invoice ? '<button class="btn btn-default" data-action="create-partial-invoice">Partial Invoice</button>' : ''}
				${can_release_goods ? '<button class="btn btn-default" data-action="release-goods">Release Goods</button>' : ''}
				${primary_invoice_action}
				<button class="btn btn-default" data-action="open-customer">Open Customer</button>
				${can_edit_job_card ? '<button class="btn btn-primary" data-action="edit-job-card">Edit Job Card</button>' : ''}
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

		${render_job_card_history_section(history, currency)}
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
