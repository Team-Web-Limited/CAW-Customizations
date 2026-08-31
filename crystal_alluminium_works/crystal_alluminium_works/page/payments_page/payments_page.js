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

const PAYMENTS_PAGE_LENGTH = 30;

function get_payments_page_state(page) {
	if (!page._payments_page_state) {
		page._payments_page_state = {
			page: 1,
			page_length: PAYMENTS_PAGE_LENGTH,
			total_count: 0,
			has_next: false,
			request_serial: 0
		};
	}
	return page._payments_page_state;
}

async function render_payments_page(page) {
	let $body = $(page.body);
	page.set_primary_action(__('Create Payment'), () => open_create_payment_modal(page));
	$body.html('<div style="padding:40px;text-align:center;color:var(--text-muted);"><span class="spinner"></span> Loading...</div>');

	let mode_of_payments = await get_payment_mode_options();
	page._payments_page_context = { mode_of_payments };

	let html = `
	<style>
		.pay-page { width:100%; max-width: 1400px; margin: 0 auto; padding: 24px 16px; }
		.pay-toolbar { display: flex; justify-content: flex-end; margin-bottom: 18px; }
		.pay-card { background: var(--fg-color); border: 1px solid var(--border-color); border-radius: 8px; box-shadow: var(--shadow-xs); overflow: hidden; margin-bottom: 20px; }
		.pay-card-header { padding: 14px 18px; font-size: 15px; font-weight: 700; color: var(--heading-color); border-bottom: 1px solid var(--border-color); background: var(--subtle-fg); display: flex; align-items: center; gap: 10px; }
		.pay-card-header .pay-icon { font-size: 18px; }
		.pay-filters { padding:16px 18px; border-bottom:1px solid var(--border-color); background:var(--fg-color); }
		.pay-filter-grid { display:grid; grid-template-columns:minmax(260px, 2fr) minmax(180px, 1fr) minmax(150px, .8fr) minmax(150px, .8fr) auto; gap:12px; align-items:end; }
		.pay-filter-field label { display:block; margin-bottom:6px; color:var(--text-muted); font-size:12px; font-weight:600; }
		.pay-filter-actions { display:flex; gap:8px; }
		.pay-table-scroll { height:560px; overflow:auto; }
		.pay-table { width: 100%; min-width: 1050px; border-collapse: separate; border-spacing:0; }
		.pay-table th { position:sticky; top:0; z-index:2; padding: 11px 14px; font-size: 12px; font-weight: 700; color: var(--text-muted); text-align: left; border-bottom: 1px solid var(--border-color); background: var(--subtle-fg); }
		.pay-table td { padding: 12px 14px; font-size: 13px; color: var(--text-color); border-bottom: 1px solid var(--border-color); vertical-align: top; }
		.pay-table tbody tr:last-child td { border-bottom: 0; }
		.pay-muted { color: var(--text-muted); }
		.pay-pagination { padding:14px 18px; border-top:1px solid var(--border-color); }
		.pay-pagination-bar { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
		.pay-pagination-meta { color:var(--text-muted); font-size:13px; }
		.pay-pagination-actions { display:flex; align-items:center; gap:8px; }
		.pay-pagination-page { min-width:70px; text-align:center; color:var(--text-color); font-size:13px; }
		@media (max-width: 900px) {
			.pay-filter-grid { grid-template-columns:repeat(2, minmax(0, 1fr)); }
			.pay-filter-search, .pay-filter-actions { grid-column:1 / -1; }
			.pay-table-scroll { height:480px; }
		}
		@media (max-width: 560px) {
			.pay-filter-grid { grid-template-columns:1fr; }
			.pay-filter-search, .pay-filter-actions { grid-column:auto; }
		}
	</style>

	<div class="pay-page">
		<div class="pay-card">
			<div class="pay-card-header">
				<span class="pay-icon">#</span> Recent Payments
			</div>
			<div class="pay-filters">
				<div class="pay-filter-grid">
					<div class="pay-filter-field pay-filter-search">
						<label>Search</label>
						<input type="search" class="form-control" data-filter="search" placeholder="Customer, job card, reference, method or account">
					</div>
					<div class="pay-filter-field">
						<label>Payment Method</label>
						<select class="form-control" data-filter="payment_method">
							<option value="">All methods</option>
							${mode_of_payments.map(method => `<option value="${frappe.utils.escape_html(method)}">${frappe.utils.escape_html(method)}</option>`).join('')}
						</select>
					</div>
					<div class="pay-filter-field">
						<label>From Date</label>
						<input type="date" class="form-control" data-filter="from_date">
					</div>
					<div class="pay-filter-field">
						<label>To Date</label>
						<input type="date" class="form-control" data-filter="to_date">
					</div>
					<div class="pay-filter-actions">
						<button class="btn btn-primary pay-filter-apply">Search</button>
						<button class="btn btn-default pay-filter-clear">Clear</button>
					</div>
				</div>
			</div>
			<div class="pay-table-scroll">
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
					<tbody class="pay-table-body"></tbody>
				</table>
			</div>
			<div class="pay-pagination"></div>
		</div>
	</div>
	`;

	$body.html(html);
	bind_payments_page_events(page, $body);
	load_payment_records(page, 1);
}

async function get_payment_mode_options() {
	try {
		let mop_response = await frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Mode of Payment',
				// Only enabled customer-receipt methods. USD TRANSFER and Petty Cash are
				// supplier / outgoing, not customer receipts.
				filters: { enabled: 1, name: ['not in', ['USD TRANSFER', 'Petty Cash']] },
				fields: ['name'],
				limit_page_length: 0,
				order_by: 'name asc'
			}
		});
		return (mop_response.message || []).map(row => row.name);
	} catch (e) {
		return ['Cash', 'Paybill', 'Bank Transfer i.e RTGS, TT', 'PESALINK', 'Cheque'];
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
	$body.off('.paymentsPage');

	$body.on('click.paymentsPage', '.pay-filter-apply', function() {
		load_payment_records(page, 1);
	});

	$body.on('click.paymentsPage', '.pay-filter-clear', function() {
		$body.find('[data-filter]').val('');
		load_payment_records(page, 1);
	});

	$body.on('keydown.paymentsPage', '.pay-filters input', function(event) {
		if (event.key === 'Enter') {
			load_payment_records(page, 1);
		}
	});

	$body.on('input.paymentsPage', '[data-filter="search"]', function() {
		clearTimeout(page._payments_search_timer);
		page._payments_search_timer = setTimeout(function() {
			load_payment_records(page, 1);
		}, 350);
	});

	$body.on('click.paymentsPage', '.pay-pagination-prev', function() {
		let state = get_payments_page_state(page);
		if (state.page > 1) {
			load_payment_records(page, state.page - 1);
		}
	});

	$body.on('click.paymentsPage', '.pay-pagination-next', function() {
		let state = get_payments_page_state(page);
		if (state.has_next) {
			load_payment_records(page, state.page + 1);
		}
	});
}

function load_payment_records(page, page_number) {
	let state = get_payments_page_state(page);
	let $body = $(page.body);
	let from_date = $body.find('[data-filter="from_date"]').val() || '';
	let to_date = $body.find('[data-filter="to_date"]').val() || '';

	if (from_date && to_date && from_date > to_date) {
		frappe.msgprint(__('From Date cannot be after To Date.'));
		return;
	}

	state.page = page_number || 1;
	state.request_serial += 1;
	let request_serial = state.request_serial;

	$body.find('.pay-table-body').html(`
		<tr><td colspan="6" class="pay-muted" style="text-align:center;padding:32px;">Loading payments...</td></tr>
	`);

	frappe.call({
		method: 'crystal_alluminium_works.api.get_payments_page',
		args: {
			search: $body.find('[data-filter="search"]').val() || '',
			payment_method: $body.find('[data-filter="payment_method"]').val() || '',
			from_date: from_date,
			to_date: to_date,
			page: state.page,
			page_length: state.page_length
		},
		callback: function(response) {
			if (request_serial !== state.request_serial) {
				return;
			}

			let result = response.message || {};
			state.page = result.page || 1;
			state.page_length = result.page_length || PAYMENTS_PAGE_LENGTH;
			state.total_count = result.total_count || 0;
			state.has_next = !!result.has_next;

			$body.find('.pay-table-body').html(render_payment_record_rows(result.rows || []));
			render_payments_pagination(page);
			$body.find('.pay-table-scroll').scrollTop(0);
		}
	});
}

function render_payments_pagination(page) {
	let state = get_payments_page_state(page);
	let start = state.total_count ? ((state.page - 1) * state.page_length) + 1 : 0;
	let end = Math.min(state.page * state.page_length, state.total_count);
	let total_pages = Math.max(Math.ceil(state.total_count / state.page_length), 1);

	$(page.body).find('.pay-pagination').html(`
		<div class="pay-pagination-bar">
			<div class="pay-pagination-meta">Showing ${start}-${end} of ${state.total_count} payments</div>
			<div class="pay-pagination-actions">
				<button class="btn btn-default pay-pagination-prev" ${state.page <= 1 ? 'disabled' : ''}>Previous</button>
				<span class="pay-pagination-page">Page ${state.page} of ${total_pages}</span>
				<button class="btn btn-default pay-pagination-next" ${!state.has_next ? 'disabled' : ''}>Next</button>
			</div>
		</div>
	`);
}

// Colour-coded pill for a job card's own payment state (what has been received against
// it before this payment), rendered read-only inside the allocations grid.
const JOB_CARD_PAYMENT_STATUS_COLORS = {
	'Paid': { bg: '#e8f6ec', fg: '#1f7a3d' },
	'Partial': { bg: '#fff4e0', fg: '#a35b00' },
	'Pending': { bg: '#fdeaea', fg: '#c0392b' }
};

function format_job_card_payment_status(status) {
	if (!status) {
		return '';  // row added manually, no job card picked yet
	}
	let colors = JOB_CARD_PAYMENT_STATUS_COLORS[status] || JOB_CARD_PAYMENT_STATUS_COLORS['Pending'];
	return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:${colors.bg};color:${colors.fg};">${frappe.utils.escape_html(__(status))}</span>`;
}

function open_create_payment_modal(page) {
	let mode_of_payments = (page._payments_page_context && page._payments_page_context.mode_of_payments) || ['Cash', 'Bank', 'Paybill', 'Cheque'];

	function get_allocation_total() {
		return (d.get_value('allocations') || []).reduce((sum, row) => sum + flt(row.amount || 0), 0);
	}

	// Live "how much is left" indicator above the allocations grid, recomputed as the user
	// types the amount or edits allocation rows.
	function update_allocation_balance() {
		if (!d || !d.fields_dict.allocation_balance) {
			return;
		}
		let amount = flt(d.get_value('amount') || 0);
		let remaining = amount - get_allocation_total();
		let over = remaining < -0.0001;
		let exact = amount > 0 && Math.abs(remaining) < 0.0001;
		let color = over ? '#e24c4c' : (exact ? '#28a745' : 'var(--text-muted)');
		let label = over ? __('Over-allocated by') : __('Unallocated balance');
		d.fields_dict.allocation_balance.$wrapper.html(
			`<div style="padding:4px 0 8px; font-weight:600; color:${color};">${label}: ${format_currency(Math.abs(remaining), 'KES')}</div>`
		);
	}

	// When a job card row is selected/edited, drive the top-level amount to equal
	// the sum of all allocation row amounts so the user never has to type it manually.
	function update_amount_from_allocations() {
		if (!d || !d.fields_dict.amount) return;
		let total = get_allocation_total();
		if (total > 0.0001) {
			d.set_value('amount', total);
		}
	}

	let d = new frappe.ui.Dialog({
		title: __('Create Payment'),
		fields: [
			{
				fieldtype: 'Select',
				fieldname: 'payment_type',
				label: 'Payment Type',
				options: 'General Payment\nRefund',
				default: 'General Payment',
				reqd: 1
			},
			{ fieldtype: 'Column Break' },
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
				},
				onchange: function() {
					// Clear prior allocation rows on customer switch
					let grid = d.fields_dict.allocations && d.fields_dict.allocations.grid;
					if (grid) {
						grid.df.data = [];
						grid.refresh();
					}
					d.set_value('amount', 0);
					update_allocation_balance();

					let customer = d.get_value('customer');
					if (!customer) return;

					// Auto-populate all outstanding job cards as allocation rows
					frappe.call({
						method: 'crystal_alluminium_works.api.get_customer_outstanding_job_cards',
						args: { customer: customer },
						callback: function(r) {
							let rows = r.message || [];
							let grid = d.fields_dict.allocations && d.fields_dict.allocations.grid;
							if (!grid) return;

							if (rows.length === 0) {
								// Show no-outstanding message in the balance indicator area
								if (d.fields_dict.allocation_balance) {
									d.fields_dict.allocation_balance.$wrapper.html(
										`<div style="padding:6px 0 8px; color:var(--text-muted); font-size:13px;">This customer has no outstanding job cards currently.</div>`
									);
								}
								return;
							}

							// Populate grid with one row per outstanding job card
							grid.df.data = rows.map(function(item) {
								return {
									job_card: item.job_card,
									amount: item.amount,
									payment_status: item.payment_status || 'Pending'
								};
							});
							grid.refresh();

							// Drive top-level amount from the total of all rows
							update_amount_from_allocations();
							update_allocation_balance();
						}
					});
				}
			},
			{ fieldtype: 'Column Break' },
			{
				fieldtype: 'Currency',
				fieldname: 'amount',
				label: 'Amount',
				reqd: 1,
				onchange: function() {
					update_allocation_balance();
				}
			},
			{ fieldtype: 'Section Break' },
			{
				fieldtype: 'HTML',
				fieldname: 'allocation_balance'
			},
			{
				fieldtype: 'Table',
				fieldname: 'allocations',
				label: 'Job Card Allocations',
				description: 'Optional — split this payment across job cards. Anything left unallocated becomes the customer\'s advance / credit.',
				cannot_add_rows: false,
				in_place_edit: false,
				data: [],
				fields: [
					{
						fieldtype: 'Link',
						fieldname: 'job_card',
						label: 'Job Card',
						options: 'CAW Job Card',
						in_list_view: 1,
						reqd: 1,
						columns: 5,
						get_query: function() {
							return {
								filters: {
									customer: d.get_value('customer') || '',
									status: ['!=', 'Cancelled']
								}
							};
						},
						onchange: function() {
							let row = this.doc;
							let control = this;
							if (!row || !row.job_card) {
								return;
							}
							// Pre-fill this row's amount with the job card's outstanding balance,
							// then drive the top-level amount to always equal the allocations total.
							frappe.call({
								method: 'crystal_alluminium_works.api.get_job_card_statement_balance',
								args: { job_card: row.job_card },
								callback: function(r) {
									let info = r.message || {};
									let balance = flt(info.balance || 0);
									row.amount = Math.max(balance, 0);
									row.payment_status = info.payment_status || 'Pending';
									if (control.grid_row) {
										control.grid_row.refresh_field('amount');
										control.grid_row.refresh_field('payment_status');
									}
									update_amount_from_allocations();
									update_allocation_balance();
								}
							});
						}
					},
					{
						fieldtype: 'Currency',
						fieldname: 'amount',
						label: 'Amount',
						in_list_view: 1,
						reqd: 1,
						columns: 3,
						onchange: function() {
							// When the user manually edits a row amount, sync the top-level amount
							// and clamp the row if it would over-allocate.
							update_amount_from_allocations();
							update_allocation_balance();
						}
					},
					{
						fieldtype: 'Data',
						fieldname: 'payment_status',
						label: 'Payment',
						in_list_view: 1,
						read_only: 1,
						columns: 2,
						formatter: function(value) {
							return format_job_card_payment_status(value);
						}
					}
				]
			},
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
				reqd: 1,
				onchange: function() {
					// Deposit account follows the method — derive it from Mode of Payment Account.
					let payment_method = d.get_value('payment_method');
					if (!payment_method) {
						d.set_value('deposit_to', '');
						return;
					}
					frappe.call({
						method: 'crystal_alluminium_works.api.get_mode_of_payment_account_info',
						args: { payment_method: payment_method },
						callback: function(r) {
							let info = (r && r.message) || {};
							d.set_value('deposit_to', info.default_account || '');
						}
					});
				}
			},
			{ fieldtype: 'Section Break' },
			{
				fieldtype: 'Link',
				fieldname: 'deposit_to',
				label: 'Deposit To',
				options: 'Account',
				reqd: 1,
				read_only: 1,
				description: 'Auto-derived from the selected payment method.'
			},
			{ fieldtype: 'Column Break' },
			{
				fieldtype: 'Data',
				fieldname: 'reference',
				label: 'Reference',
				reqd: 1
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

			let allocations = (values.allocations || [])
				.filter(row => row.job_card)
				.map(row => ({ job_card: row.job_card, amount: flt(row.amount || 0) }));
			if (allocations.some(row => row.amount <= 0)) {
				frappe.msgprint(__('Each allocation must have an amount greater than zero.'));
				return;
			}
			let allocated_total = allocations.reduce((sum, row) => sum + flt(row.amount || 0), 0);
			if (allocated_total - flt(values.amount || 0) > 0.0001) {
				frappe.msgprint(__('Allocated amount cannot exceed the payment amount.'));
				return;
			}

			let save_payment = function() {
				frappe.call({
					method: 'crystal_alluminium_works.api.record_customer_payment',
					args: {
						customer: values.customer,
						payment_type: values.payment_type,
						amount: values.amount,
						date: values.date,
						payment_method: values.payment_method,
						reference: values.reference,
						deposit_to: values.deposit_to,
						allocations: JSON.stringify(allocations)
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
							load_payment_records(page, 1);
						}
					}
				});
			};

			// Soft nudge: nothing is allocated, yet this customer already owes. Don't block —
			// recording it as an advance / credit is a legitimate flow (e.g. funding a future
			// job card) — just make sure the blank wasn't accidental.
			if (allocations.length === 0) {
				frappe.call({
					method: 'crystal_alluminium_works.api.get_customer_outstanding',
					args: { customer: values.customer },
					callback: function(r) {
						let info = r.message || {};
						let outstanding = flt(info.outstanding || 0);
						if (outstanding > 0.0001) {
							frappe.confirm(
								__('This customer owes {0} but this payment isn’t allocated to any job card. Record it as advance / credit?',
									[format_currency(outstanding, info.currency || 'KES')]),
								save_payment
							);
						} else {
							save_payment();
						}
					}
				});
			} else {
				save_payment();
			}
		}
	});

	// Live updates as the user types: the top amount, plus any edit/add/remove inside the
	// allocations grid (delegated so it covers rows created after the dialog opened).
	d.fields_dict.amount.$input.on('input', update_allocation_balance);
	d.fields_dict.allocations.grid.wrapper.on('input', 'input', function() {
		setTimeout(function() {
			update_amount_from_allocations();
			update_allocation_balance();
		}, 30);
	});
	d.fields_dict.allocations.grid.wrapper.on('click', '.grid-remove-rows, .grid-add-row', function() {
		setTimeout(function() {
			update_amount_from_allocations();
			update_allocation_balance();
		}, 60);
	});

	update_allocation_balance();
	d.show();
}
