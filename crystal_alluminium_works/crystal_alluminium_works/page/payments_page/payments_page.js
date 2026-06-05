frappe.pages['payments-page'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Payments',
		single_column: true
	});

	wrapper.page = page;
};

frappe.pages['payments-page'].on_page_show = function(wrapper) {
	let page = wrapper.page || (wrapper.control ? wrapper.control.page : null);

	if (!page) {
		page = $(wrapper).data('page');
	}

	render_payments_page(page);
};

async function render_payments_page(page) {
	let $body = $(page.body);
	page.set_primary_action(__('Create Payment'), () => open_create_payment_modal(page));
	$body.html('<div style="padding:40px;text-align:center;color:var(--text-muted);"><span class="spinner"></span> Loading...</div>');

	let [mode_of_payments, payment_records] = await Promise.all([
		get_payment_mode_options(),
		get_payment_records()
	]);

	page._payments_page_context = { mode_of_payments };

	let html = `
	<style>
		.pay-page { max-width: 900px; margin: 0 auto; padding: 24px 16px; }
		.pay-toolbar { display: flex; justify-content: flex-end; margin-bottom: 18px; }
		.pay-card { background: var(--fg-color); border: 1px solid var(--border-color); border-radius: 8px; box-shadow: var(--shadow-xs); overflow: hidden; margin-bottom: 20px; }
		.pay-card-header { padding: 14px 18px; font-size: 15px; font-weight: 700; color: var(--heading-color); border-bottom: 1px solid var(--border-color); background: var(--subtle-fg); display: flex; align-items: center; gap: 10px; }
		.pay-card-header .pay-icon { font-size: 18px; }
		.pay-card-body { padding: 20px; }
		.pay-table-wrap { overflow-x: auto; }
		.pay-table { width: 100%; min-width: 760px; border-collapse: collapse; }
		.pay-table th { padding: 11px 14px; font-size: 12px; font-weight: 700; color: var(--text-muted); text-align: left; border-bottom: 1px solid var(--border-color); background: var(--subtle-fg); }
		.pay-table td { padding: 12px 14px; font-size: 13px; color: var(--text-color); border-bottom: 1px solid var(--border-color); vertical-align: top; }
		.pay-table tbody tr:last-child td { border-bottom: 0; }
		.pay-muted { color: var(--text-muted); }
	</style>

	<div class="pay-page">
		<div class="pay-toolbar">
			<button class="btn btn-primary" id="btn-create-payment">
				<i class="fa fa-plus" style="margin-right:6px;"></i>Create Payment
			</button>
		</div>

		<div class="pay-card">
			<div class="pay-card-header">
				<span class="pay-icon">#</span> Recent Payments
			</div>
			<div class="pay-card-body">
				<div class="pay-table-wrap">
					<table class="pay-table">
						<thead>
							<tr>
								<th>Date</th>
								<th>Customer</th>
								<th style="text-align:right;">Amount</th>
								<th>Method</th>
								<th>Deposit To</th>
								<th>Reference</th>
							</tr>
						</thead>
						<tbody>
							${render_payment_record_rows(payment_records)}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	</div>
	`;

	$body.html(html);
	bind_payments_page_events(page, $body);
}

async function get_payment_mode_options() {
	try {
		let mop_response = await frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Mode of Payment',
				fields: ['name'],
				limit_page_length: 0,
				order_by: 'name asc'
			}
		});
		return (mop_response.message || []).map(row => row.name);
	} catch (e) {
		return ['Cash', 'Bank', 'Paybill', 'Cheque'];
	}
}

async function get_payment_records() {
	try {
		let payments_response = await frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Payments',
				fields: ['name', 'customer', 'amount', 'date', 'payment_method', 'deposit_to', 'reference'],
				limit_page_length: 25,
				order_by: 'creation desc'
			}
		});
		return payments_response.message || [];
	} catch (e) {
		return [];
	}
}

function render_payment_record_rows(records) {
	if (!records.length) {
		return `
			<tr>
				<td colspan="6" class="pay-muted" style="text-align:center;padding:24px;">
					No payments recorded yet.
				</td>
			</tr>
		`;
	}

	return records.map(row => `
		<tr>
			<td>${frappe.utils.escape_html(row.date ? frappe.datetime.str_to_user(row.date) : '-')}</td>
			<td>${frappe.utils.escape_html(row.customer || '-')}</td>
			<td style="text-align:right;font-weight:600;">${format_currency(row.amount || 0, 'KES')}</td>
			<td>${frappe.utils.escape_html(row.payment_method || '-')}</td>
			<td>${frappe.utils.escape_html(row.deposit_to || '-')}</td>
			<td>${frappe.utils.escape_html(row.reference || '-')}</td>
		</tr>
	`).join('');
}

function bind_payments_page_events(page, $body) {
	$body.find('#btn-create-payment').on('click', function() {
		open_create_payment_modal(page);
	});
}

function open_create_payment_modal(page) {
	let mode_of_payments = (page._payments_page_context && page._payments_page_context.mode_of_payments) || ['Cash', 'Bank', 'Paybill', 'Cheque'];
	let d = new frappe.ui.Dialog({
		title: __('Create Payment'),
		fields: [
			{
				fieldtype: 'Link',
				fieldname: 'customer',
				label: 'Customer',
				options: 'Customer',
				reqd: 1,
				get_query: function() {
					return {
						query: 'crystal_alluminium_works.api.get_customer_names'
					};
				}
			},
			{ fieldtype: 'Column Break' },
			{
				fieldtype: 'Currency',
				fieldname: 'amount',
				label: 'Amount',
				reqd: 1,
			}
			,
			{ fieldtype: 'Section Break' },
			{
				fieldtype: 'Date',
				fieldname: 'date',
				label: 'Date',
				reqd: 1,
				default: frappe.datetime.get_today()
			},
			{ fieldtype: 'Column Break' },
			{
				fieldtype: 'Select',
				fieldname: 'payment_method',
				label: 'Payment Method',
				options: [''].concat(mode_of_payments).join('\n'),
				reqd: 1
			},
			{ fieldtype: 'Section Break' },
			{
				fieldtype: 'Link',
				fieldname: 'deposit_to',
				label: 'Deposit To',
				options: 'Account',
				reqd: 1,
				get_query: function() {
					return {
						filters: {
							account_type: ['in', ['Bank', 'Cash']],
							is_group: 0
						}
					};
				}
			},
			{ fieldtype: 'Column Break' },
			{
				fieldtype: 'Data',
				fieldname: 'reference',
				label: 'Reference'
			}
		],
		primary_action_label: __('Save Payment'),
		primary_action: function(values) {
			if (!values.customer) {
				frappe.msgprint(__('Please select a customer.'));
				return;
			}

			if (flt(values.amount || 0) <= 0) {
				frappe.msgprint(__('Amount must be greater than zero.'));
				return;
			}

			frappe.call({
				method: 'crystal_alluminium_works.api.record_customer_payment',
				args: {
					customer: values.customer,
					amount: values.amount,
					date: values.date,
					payment_method: values.payment_method,
					reference: values.reference,
					deposit_to: values.deposit_to
				},
				freeze: true,
				freeze_message: 'Recording Payment...',
				callback: function(r) {
					if (r.message) {
						d.hide();
						frappe.show_alert({
							message: __('Payment {0} recorded successfully.', [r.message]),
							indicator: 'green'
						});
						render_payments_page(page);
					}
				}
			});
		}
	});

	d.show();
}
