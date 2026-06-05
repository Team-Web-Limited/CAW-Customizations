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
				message.sales_invoices || []
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
	let d = new frappe.ui.Dialog({
		title: 'Edit Sales Order',
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
					return {
						query: 'crystal_alluminium_works.api.search_builder_customers',
						filters: {
							payment_mode: normalize_job_card_payment_mode(d.get_value('payment_mode'))
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
					quotation: job_card.quotation,
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
				freeze_message: 'Saving Job Card...',
				callback: function(r) {
					if (r.message) {
						d.hide();
						frappe.show_alert({ message: `Job Card ${r.message} saved`, indicator: 'green' });
						load_single_job_card_detail(page, r.message);
					}
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
	});

	d.fields_dict.payment_mode.$input.on('change', function() {
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

function can_create_invoice_from_job_card(job_card, quotation, history, sales_invoices) {
	let has_sales_invoice = !!((sales_invoices || []).length);
	let quotation_amount = flt(job_card.quotation_amount || (quotation && quotation.grand_total) || 0);
	let payment_amount = flt(job_card.payment_amount || 0);
	return !has_sales_invoice
		&& quotation_amount > 0
		&& Math.abs(payment_amount - quotation_amount) < 0.0001;
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
			frappe.set_route('Form', 'Customer', job_card.customer);
		}
	});

	$body.on('click.job-card-detail', '[data-action="edit-job-card"]', function() {
		open_edit_job_card_modal(page, job_card, quotation);
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
							frappe.show_alert({message: 'Paid Sales Invoice Created!', indicator: 'green'});
							frappe.set_route('sales-invoice-manager', r.message);
						}
					}
				});
			}
		);
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

function render_single_job_card_detail(job_card, quotation, history, sales_invoices) {
	let currency = quotation && quotation.currency ? quotation.currency : 'KES';
	let balance = flt(job_card.balance_amount || 0);
	let can_create_invoice = can_create_invoice_from_job_card(job_card, quotation, history, sales_invoices);
	let has_sales_invoice = !!((sales_invoices || []).length);
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
		.jc-detail-page { max-width: 1120px; margin: 0 auto; padding: 24px 16px; }
		.jc-detail-header { display:flex; justify-content:space-between; gap:18px; align-items:flex-start; margin-bottom:24px; }
		.jc-detail-title h2 { margin:0 0 8px; font-size:26px; font-weight:700; color:var(--heading-color); }
		.jc-detail-title p { margin:0; color:var(--text-muted); font-size:14px; }
		.jc-detail-actions { display:flex; gap:10px; flex-wrap:wrap; justify-content:flex-end; }
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
				<p>${frappe.utils.escape_html(job_card.customer_name || job_card.customer || 'Customer not set')}</p>
			</div>
			<div class="jc-detail-actions">
				<button class="btn btn-default" data-action="open-quotation">Open Quotation</button>
				${primary_invoice_action}
				<button class="btn btn-default" data-action="open-customer">Open Customer</button>
				<button class="btn btn-primary" data-action="edit-job-card">Edit Job Card</button>
			</div>
		</div>

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
