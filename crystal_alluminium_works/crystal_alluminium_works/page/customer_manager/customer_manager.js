frappe.pages['customer-manager'].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Customer Manager',
		single_column: true,
	});

	wrapper.customer_manager_page = page;
	$(wrapper).data('page', page);

	bind_customer_manager_events(page);
	render_customer_manager_route(page);

	// frappe.app.sidebar.set_workspace_sidebar() mis-detects the active sidebar
	// when the route has a second segment (e.g. customer-manager/<customer name>),
	// since it treats that segment as the entity to resolve the sidebar for
	// instead of the page name. Re-assert our own sidebar after every route
	// change so it doesn't fall back to the default app sidebar.
	frappe.router.on('change', function () {
		if (frappe.get_route()[0] === 'customer-manager' && frappe.app.sidebar) {
			frappe.app.sidebar.setup('Crystal Alluminium Works');
		}
	});
};

frappe.pages['customer-manager'].on_page_show = function (wrapper) {
	let page = wrapper.customer_manager_page || $(wrapper).data('page');
	if (page) {
		render_customer_manager_route(page);
	}
};

const CUSTOMER_MANAGER_VAT_RATE = 0.16;
const CUSTOMER_MANAGER_PAGE_LENGTH = 30;

function get_customer_manager_list_state(page) {
	if (!page.customer_manager_list_state) {
		page.customer_manager_list_state = {
			page: 1,
			page_length: CUSTOMER_MANAGER_PAGE_LENGTH,
			total_count: 0,
			has_more: false,
		};
	}

	return page.customer_manager_list_state;
}

function get_customer_manager_list_columns(customer_type) {
	let type = (customer_type || 'invoice').trim().toLowerCase();
	let columns = [
		{ key: 'customer_name', label: 'Customer Name' }
	];

	if (type !== 'cash') {
		columns.push({ key: 'tax_id', label: 'PIN (Tax ID)' });
	}

	columns.push({ key: 'phone_number', label: 'Phone Number' });
	columns.push({ key: 'customer_type', label: 'Customer Type' });

	return columns;
}

function render_customer_manager_list_loading($wrapper, customer_type, message) {
	let columns = get_customer_manager_list_columns(customer_type);
	let header_html = columns.map(column => `<th>${frappe.utils.escape_html(column.label)}</th>`).join('');
	$wrapper.find('.cm-list-table thead tr').html(header_html);
	$wrapper.find('.cm-list-body').html(`
		<tr>
			<td colspan="${columns.length}" style="padding:24px; text-align:center; color:var(--text-muted);">
				${frappe.utils.escape_html(message || 'Loading customers...')}
			</td>
		</tr>
	`);
}

function render_customer_manager_route(page) {
	let route = frappe.get_route();
	let customer_name = route[1] ? decode_customer_route_name(route[1]) : null;
	let route_key = route.join('|');

	if (page.customer_manager_route_key === route_key) {
		return;
	}

	page.customer_manager_route_key = route_key;

	if (customer_name) {
		render_customer_detail(page, customer_name);
	} else {
		render_customer_list(page);
	}
}

function decode_customer_route_name(value) {
	try {
		return decodeURIComponent(value);
	} catch (e) {
		return value;
	}
}

function set_customer_list_actions(page) {
	page.set_title('Customer Manager');
	page.clear_secondary_action();
	page.set_primary_action('New Customer', function () {
		frappe.new_doc('Customer');
	});
}

function set_customer_detail_actions(page, customer_name) {
	page.set_title('Customer Details');
	page.set_primary_action('Open Customer', function () {
		frappe.set_route('Form', 'Customer', customer_name);
	});
	page.set_secondary_action('Back to Customers', function () {
		frappe.set_route('customer-manager');
	});
}

function render_customer_list(page) {
	set_customer_list_actions(page);
	$(page.body).html(get_customer_manager_html());
	page.customer_manager_list_state = {
		page: 1,
		page_length: CUSTOMER_MANAGER_PAGE_LENGTH,
		total_count: 0,
		has_more: false,
	};
	render_customer_manager_list_loading($(page.body), 'invoice', 'Loading customers...');
	load_customers(page, 1);
}

function get_customer_manager_html() {
	return `
	<style>
		.cm-list-page { max-width: 1120px; margin: 0 auto; padding: 24px 16px; }
		.cm-list-hero { margin-bottom: 24px; }
		.cm-list-hero h2 { margin-top: 0; font-size: 24px; font-weight: 700; color: var(--text-color); }
		.cm-list-hero p { margin-bottom: 0; font-size: 14px; color: var(--text-muted); }
		.cm-list-filters { padding: 18px; margin: 0 auto 24px; background: var(--fg-color); border: 1px solid var(--border-color); border-radius: 8px; box-shadow: var(--shadow-xs); }
		.cm-list-toolbar { display: flex; align-items: end; gap: 12px; flex-wrap: wrap; }
		.cm-list-toolbar-group { min-width: 0; }
		.cm-list-toolbar-group--search { flex: 1 1 320px; }
		.cm-list-toolbar-group--type { flex: 0 1 220px; }
		.cm-list-toolbar-actions { display: flex; align-items: end; justify-content: flex-end; gap: 12px; margin-left: auto; flex: 0 1 auto; }
		.cm-list-toolbar .form-label { margin-bottom: 6px; display: block; }
		.cm-list-table-wrap { margin: 0 auto; background: var(--fg-color); border: 1px solid var(--border-color); border-radius: 8px; box-shadow: var(--shadow-xs); overflow: hidden; }
		.cm-list-table-scroller { max-height: 620px; overflow: auto; }
		.cm-list-table { width: 100%; min-width: 800px; border-collapse: collapse; }
		.cm-list-table thead th { position: sticky; top: 0; z-index: 1; padding: 12px 16px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; text-align: left; letter-spacing: 0.5px; background: var(--subtle-fg); border-bottom: 1px solid var(--border-color); }
		.cm-list-table tbody tr { cursor: pointer; }
		.cm-list-table tbody tr:not(:last-child) td { border-bottom: 1px solid var(--border-color); }
		.cm-list-table tbody tr:hover { background: var(--subtle-fg); }
		.cm-list-table td { padding: 12px 16px; font-size: 14px; vertical-align: middle; color: var(--text-color); }
		.cm-list-pagination { padding: 16px 18px; border-top: 1px solid var(--border-color); }
		.cm-list-pagination-bar { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
		.cm-list-pagination-meta { font-size:13px; color:var(--text-muted); }
		.cm-list-pagination-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
		.cm-list-pagination-page { font-size:13px; color:var(--text-color); min-width:70px; text-align:center; }
		@media (max-width: 768px) {
			.cm-list-toolbar-actions { width: 100%; justify-content: stretch; margin-left: 0; }
			.cm-list-toolbar-actions .btn { flex: 1 1 0; }
			.cm-list-pagination-page { min-width: auto; }
			.cm-list-table-scroller { max-height: 440px; }
		}
		.cm-detail-page { max-width: 100%; margin: 0 auto; padding: 20px 16px; font-family: var(--font-stack); }
		.cm-detail-header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 20px; flex-wrap: wrap; }
		.cm-detail-title h2 { margin: 0 0 8px; font-size: 26px; font-weight: 700; color: var(--heading-color); }
		.cm-detail-title p { margin: 0; color: var(--text-muted); font-size: 14px; }
		.cm-detail-actions { display: flex; gap: 10px; flex-wrap: wrap; }
		.cm-detail-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }
		.cm-detail-stat { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 14px 16px; box-shadow: var(--shadow-xs); }
		.cm-detail-stat-label { color: var(--text-muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
		.cm-detail-stat-value { color: var(--heading-color); font-size: 18px; font-weight: 700; }
		.cm-detail-info { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 18px; margin-bottom: 20px; box-shadow: var(--shadow-xs); }
		.cm-detail-info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; }
		.cm-detail-field-label { color: var(--text-muted); font-size: 12px; margin-bottom: 4px; }
		.cm-detail-field-value { color: var(--text-color); font-size: 14px; font-weight: 600; }
		.cm-detail-section { margin-bottom: 22px; }
		.cm-detail-section-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
		.cm-detail-section-title h3 { margin: 0; font-size: 18px; font-weight: 700; color: var(--heading-color); }
		.cm-detail-section-title span { color: var(--text-muted); font-size: 13px; }
		.cm-detail-table-wrap { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; box-shadow: var(--shadow-xs); overflow: hidden; }
		.cm-detail-table-scroller { overflow-x: auto; }
		.cm-detail-table { width: 100%; min-width: 760px; border-collapse: collapse; }
		.cm-detail-table thead th { padding: 12px 16px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; text-align: left; letter-spacing: 0.5px; background: var(--subtle-fg); border-bottom: 1px solid var(--border-color); }
		.cm-detail-table tbody tr:not(:last-child) td { border-bottom: 1px solid var(--border-color); }
		.cm-detail-table tbody tr:hover { background: var(--subtle-fg); }
		.cm-detail-table td { padding: 12px 16px; font-size: 14px; vertical-align: middle; color: var(--text-color); }
		.cm-invoice-row { cursor: pointer; }
		.cm-status-pill { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; }
	</style>

	<div class="cm-list-page">
		<div class="cm-list-hero">
			<h2>Customer Manager</h2>
		</div>

		<div class="cm-list-filters">
			<div class="cm-list-toolbar">
				<div class="cm-list-toolbar-group cm-list-toolbar-group--search">
					<label class="form-label">Search</label>
					<input type="text" class="form-control" data-filter="search" placeholder="Customer name or ID">
				</div>
				<div class="cm-list-toolbar-group cm-list-toolbar-group--type">
					<label class="form-label">Customer Type</label>
					<select class="form-control" data-filter="customer_type">
						<option value="invoice">Invoice Customers</option>
						<option value="cash">Cash Customers</option>
					</select>
				</div>
				<div class="cm-list-toolbar-actions">
					<button class="btn btn-default cm-list-clear">Clear</button>
					<button class="btn btn-primary cm-list-apply">Apply Filters</button>
				</div>
			</div>
		</div>

		<div class="cm-list-table-wrap">
			<div class="cm-list-table-scroller">
				<table class="cm-list-table">
					<thead>
						<tr></tr>
					</thead>
					<tbody class="cm-list-body">
						<tr></tr>
					</tbody>
				</table>
			</div>
			<div class="cm-list-pagination"></div>
		</div>
	</div>
	`;
}

function bind_customer_manager_events(page) {
	let wrapper = page.body;

	$(wrapper).on('click', '.cm-list-apply', function () {
		load_customers(page, 1);
	});

	$(wrapper).on('keydown', '[data-filter="search"]', function (e) {
		if (e.key === 'Enter') {
			e.preventDefault();
			load_customers(page, 1);
		}
	});

	$(wrapper).on('change', '[data-filter="customer_type"]', function () {
		load_customers(page, 1);
	});

	$(wrapper).on('click', '.cm-list-clear', function () {
		$(wrapper).find('[data-filter="search"]').val('');
		$(wrapper).find('[data-filter="customer_type"]').val('invoice');
		load_customers(page, 1);
	});

	$(wrapper).on('click', '.cm-list-body tr[data-name]', function (e) {
		let name = $(this).attr('data-name');
		frappe.set_route('customer-manager', name);
	});

	$(wrapper).on('click', '.cm-detail-back', function () {
		frappe.set_route('customer-manager');
	});

	$(wrapper).on('click', '.cm-open-customer', function () {
		let name = $(this).attr('data-name');
		if (name) {
			frappe.set_route('Form', 'Customer', name);
		}
	});

	$(wrapper).on('click', '.cm-invoice-row', function () {
		let name = $(this).attr('data-name');
		let payment_mode = $(this).attr('data-payment-mode');
		if (name) {
			frappe.set_route('sales-invoice-manager', name, payment_mode);
		}
	});

	$(wrapper).on('click', '.cm-quotation-row', function () {
		let name = $(this).attr('data-name');
		if (name) {
			frappe.set_route('quotation-manager', name);
		}
	});

	$(wrapper).on('click', '.cm-payment-row', function () {
		let name = $(this).attr('data-name');
		if (name) {
			frappe.set_route('Form', 'Payments', name);
		}
	});

	$(wrapper).on('click', '.cm-payment-jobcard-link', function (e) {
		e.preventDefault();
		e.stopPropagation();
		let job_card_name = $(this).attr('data-job-card');
		if (job_card_name) {
			frappe.set_route('job-card-detail', job_card_name);
		}
	});

	$(wrapper).on('click', '.cm-job-card-row', function () {
		let name = $(this).attr('data-name');
		if (name) {
			frappe.set_route('job-card-detail', name);
		}
	});

	$(wrapper).on('change', '[data-filter="transaction_type"]', function () {
		render_customer_selected_transaction_table(page);
	});

	$(wrapper).on('click', '.btn-paging', function () {
		if ($(this).hasClass('disabled')) return;
		let p = $(this).attr('data-page');
		load_customers(page, parseInt(p));
	});
}

async function render_customer_detail(page, customer_name) {
	set_customer_detail_actions(page, customer_name);
	$(page.body).html(`
		<style>
			.cm-detail-page { max-width: 100%; margin: 0 auto; padding: 20px 16px; font-family: var(--font-stack); }
		</style>
		<div class="cm-detail-page">
			<div style="padding:40px; text-align:center; color:var(--text-muted);">
				<span class="spinner"></span> Loading customer details...
			</div>
		</div>
	`);

	try {
		const [customer, cash_sales, sales_invoices] = await Promise.all([
			frappe.db.get_doc('Customer', customer_name),
			get_customer_manager_invoices(customer_name, 'Cash'),
			get_customer_manager_invoices(customer_name, 'Cheque'),
		]);

		const [quotations, payments, job_cards] = await Promise.all([
			get_customer_manager_quotations(customer.name),
			get_customer_manager_payments(customer.name),
			get_customer_manager_job_cards(customer.name),
		]);

		if (page.customer_manager_route_key !== frappe.get_route().join('|')) {
			return;
		}

		page.customer_manager_transactions = {
			invoices: get_customer_combined_transactions(cash_sales, sales_invoices),
			quotations: quotations,
			payments: payments,
			job_cards: job_cards,
		};
		page.set_title(customer.customer_name || customer.name);
		$(page.body).html(get_customer_detail_html(customer, page.customer_manager_transactions));
		render_customer_selected_transaction_table(page);
	} catch (error) {
		console.error(error);
		$(page.body).html(`
			<style>
				.cm-detail-page { max-width: 100%; margin: 0 auto; padding: 20px 16px; font-family: var(--font-stack); }
			</style>
			<div class="cm-detail-page">
				<div class="msg-box" style="padding:40px; text-align:center; color:var(--text-muted);">
					<h3>Customer Not Found</h3>
					<p>Unable to load details for ${frappe.utils.escape_html(customer_name)}.</p>
					<div style="margin-top:20px;">
						<button class="btn btn-primary cm-detail-back">Back to Customers</button>
					</div>
				</div>
			</div>
		`);
	}
}

async function get_customer_manager_invoices(customer_name, payment_mode) {
	let rows = [];
	let page_number = 1;
	let has_next = true;

	while (has_next) {
		const response = await frappe.call({
			method: 'crystal_alluminium_works.api.get_sales_invoices_page',
			args: {
				customer: customer_name,
				payment_mode: payment_mode,
				page: page_number,
				page_length: 100,
			},
		});

		let message = response.message || {};
		rows = rows.concat(message.rows || []);
		has_next = !!message.has_next;
		page_number += 1;
	}

	return rows;
}

async function get_customer_manager_quotations(customer_name) {
	return get_customer_manager_records({
		doctype: 'Quotation',
		filters: { party_name: customer_name },
		fields: ['name', 'transaction_date', 'valid_till', 'status', 'currency', 'grand_total', 'rounded_total', 'total_taxes_and_charges', 'docstatus', 'creation'],
		order_by: 'transaction_date desc, creation desc',
	});
}

async function get_customer_manager_payments(customer_name) {
	return get_customer_manager_records({
		doctype: 'Payments',
		filters: { customer: customer_name },
		fields: ['name', 'amount', 'date', 'payment_method', 'deposit_to', 'reference', 'job_card', 'creation'],
		order_by: 'date desc, creation desc',
	});
}

async function get_customer_manager_job_cards(customer_name) {
	return get_customer_manager_records({
		doctype: 'CAW Job Card',
		filters: { customer: customer_name },
		fields: ['name', 'quotation', 'payment_mode', 'payment_option', 'quotation_amount', 'payment_amount', 'balance_amount', 'status', 'creation', 'modified'],
		order_by: 'creation desc',
	});
}

async function get_customer_manager_records({ doctype, filters, fields, order_by }) {
	try {
		let response = await frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: doctype,
				filters: filters,
				fields: fields,
				order_by: order_by,
				limit_page_length: 0,
			},
		});
		return response.message || [];
	} catch (e) {
		console.error(e);
		return [];
	}
}

function get_customer_uninvoiced_job_cards(job_cards, invoices) {
	let invoiced_quotations = new Set();
	(invoices || []).forEach(invoice => {
		if (invoice.custom_source_quotation) {
			invoiced_quotations.add(invoice.custom_source_quotation);
		}
	});

	return (job_cards || []).filter(job_card => {
		if (job_card.status === 'Cancelled') {
			return false;
		}
		return !job_card.quotation || !invoiced_quotations.has(job_card.quotation);
	});
}

function get_customer_detail_html(customer, transactions) {
	let all_invoices = transactions.invoices || [];
	let quotations = transactions.quotations || [];
	let payments = transactions.payments || [];
	let job_cards = transactions.job_cards || [];

	// Cash Customer job cards only produce a Sales Invoice once fully paid, so a
	// partially-paid job card has real committed revenue and a real outstanding
	// balance that the Invoices list alone can't see yet. Fold those in here so
	// Total Sales / Outstanding reflect job cards too, without double-counting
	// ones that have already been invoiced.
	let uninvoiced_job_cards = get_customer_uninvoiced_job_cards(job_cards, all_invoices);
	let uninvoiced_job_card_total = uninvoiced_job_cards.reduce((sum, job_card) => sum + flt(job_card.quotation_amount || 0), 0);
	let uninvoiced_job_card_outstanding = uninvoiced_job_cards.reduce((sum, job_card) => sum + flt(job_card.balance_amount || 0), 0);

	let total_sales = all_invoices.reduce((sum, invoice) => sum + get_customer_manager_invoice_total(invoice), 0) + uninvoiced_job_card_total;
	let outstanding = all_invoices.reduce((sum, invoice) => sum + get_customer_manager_invoice_outstanding(invoice), 0) + uninvoiced_job_card_outstanding;
	let currency = (all_invoices[0] && all_invoices[0].currency) || 'KES';

	return `
		${get_customer_manager_style_block()}
		<div class="cm-detail-page">
			<div class="cm-detail-header">
				<div class="cm-detail-title">
					<h2>${cm_text(customer.customer_name || customer.name)}</h2>
				</div>
			</div>

			<div class="cm-detail-summary">
				${get_customer_stat_html('Invoices', all_invoices.length)}
				${get_customer_stat_html('Quotations', quotations.length)}
				${get_customer_stat_html('Payments', payments.length)}
				${get_customer_stat_html('Job Cards', job_cards.length)}
				${get_customer_stat_html('Total Sales', format_currency(total_sales, currency))}
				${get_customer_stat_html('Outstanding', format_currency(outstanding, currency))}
			</div>

			<div class="cm-detail-info">
				<div class="cm-detail-info-grid">
					${get_customer_field_html('Customer ID', customer.name)}
					${get_customer_field_html('Type', customer.customer_type)}
					${get_customer_field_html('PIN (Tax ID)', customer.tax_id)}
					${get_customer_field_html('Email', customer.email_id)}
					${get_customer_field_html('Mobile', customer.mobile_no)}
					${get_customer_field_html('Phone', customer.phone)}
				</div>
			</div>

			${get_customer_transactions_section_html()}
		</div>
	`;
}

function get_customer_manager_style_block() {
	return `
	<style>
		.cm-list-page { max-width: 1120px; margin: 0 auto; padding: 24px 16px; }
		.cm-list-hero { margin-bottom: 24px; }
		.cm-list-hero h2 { margin-top: 0; font-size: 24px; font-weight: 700; color: var(--text-color); }
		.cm-list-hero p { margin-bottom: 0; font-size: 14px; color: var(--text-muted); }
		.cm-list-filters { padding: 18px; margin: 0 auto 24px; background: var(--fg-color); border: 1px solid var(--border-color); border-radius: 8px; box-shadow: var(--shadow-xs); }
		.cm-list-filter-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; margin-bottom: 16px; }
		.cm-list-filter-actions { display: flex; justify-content: flex-end; gap: 12px; }
		.cm-list-table-wrap { margin: 0 auto; background: var(--fg-color); border: 1px solid var(--border-color); border-radius: 8px; box-shadow: var(--shadow-xs); overflow: hidden; }
		.cm-list-table-scroller { overflow-x: auto; }
		.cm-list-table { width: 100%; min-width: 800px; border-collapse: collapse; }
		.cm-list-table thead th { padding: 12px 16px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; text-align: left; letter-spacing: 0.5px; background: var(--subtle-fg); border-bottom: 1px solid var(--border-color); }
		.cm-list-table tbody tr { cursor: pointer; }
		.cm-list-table tbody tr:not(:last-child) td { border-bottom: 1px solid var(--border-color); }
		.cm-list-table tbody tr:hover { background: var(--subtle-fg); }
		.cm-list-table td { padding: 12px 16px; font-size: 14px; vertical-align: middle; color: var(--text-color); }
		.cm-list-pagination { padding: 16px 18px; border-top: 1px solid var(--border-color); text-align: center; }
		.cm-detail-page { max-width: 100%; margin: 0 auto; padding: 20px 16px; font-family: var(--font-stack); }
		.cm-detail-header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 20px; flex-wrap: wrap; }
		.cm-detail-title h2 { margin: 0 0 8px; font-size: 26px; font-weight: 700; color: var(--heading-color); }
		.cm-detail-title p { margin: 0; color: var(--text-muted); font-size: 14px; }
		.cm-detail-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }
		.cm-detail-stat { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 14px 16px; box-shadow: var(--shadow-xs); }
		.cm-detail-stat-label { color: var(--text-muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
		.cm-detail-stat-value { color: var(--heading-color); font-size: 18px; font-weight: 700; }
		.cm-detail-info { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 18px; margin-bottom: 20px; box-shadow: var(--shadow-xs); }
		.cm-detail-info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; }
		.cm-detail-field-label { color: var(--text-muted); font-size: 12px; margin-bottom: 4px; }
		.cm-detail-field-value { color: var(--text-color); font-size: 14px; font-weight: 600; }
		.cm-detail-section { margin-bottom: 22px; }
		.cm-detail-section-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
		.cm-detail-section-title h3 { margin: 0; font-size: 18px; font-weight: 700; color: var(--heading-color); }
		.cm-detail-section-title span { color: var(--text-muted); font-size: 13px; }
		.cm-detail-filter { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-right: 1.5rem; }
		.cm-detail-filter label { margin: 0; color: var(--text-muted); font-size: 13px; }
		.cm-detail-filter select { width: 180px; }
		.cm-detail-table-wrap { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; box-shadow: var(--shadow-xs); overflow: hidden; }
		.cm-detail-table-scroller { overflow-x: auto; }
		.cm-detail-table { width: 100%; min-width: 860px; border-collapse: collapse; }
		.cm-detail-table thead th { padding: 12px 16px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; text-align: left; letter-spacing: 0.5px; background: var(--subtle-fg); border-bottom: 1px solid var(--border-color); }
		.cm-detail-table tbody tr:not(:last-child) td { border-bottom: 1px solid var(--border-color); }
		.cm-detail-table tbody tr:hover { background: var(--subtle-fg); }
		.cm-detail-table td { padding: 12px 16px; font-size: 14px; vertical-align: middle; color: var(--text-color); }
		.cm-transaction-row { cursor: pointer; }
		.cm-transaction-count { color: var(--text-muted); font-size: 13px; white-space: nowrap; }
		.cm-status-pill { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; }
	</style>
	`;
}

function get_customer_stat_html(label, value) {
	return `
		<div class="cm-detail-stat">
			<div class="cm-detail-stat-label">${cm_text(label)}</div>
			<div class="cm-detail-stat-value">${cm_text(value)}</div>
		</div>
	`;
}

function get_customer_field_html(label, value) {
	return `
		<div>
			<div class="cm-detail-field-label">${cm_text(label)}</div>
			<div class="cm-detail-field-value">${cm_text(value || '-')}</div>
		</div>
	`;
}

function get_customer_combined_transactions(cash_sales, sales_invoices) {
	return cash_sales.map(invoice => {
		return Object.assign({}, invoice, {
			transaction_type: 'Cash Sale',
			transaction_filter: 'cash',
			payment_mode: 'Cash',
		});
	}).concat(sales_invoices.map(invoice => {
		return Object.assign({}, invoice, {
			transaction_type: 'Invoice',
			transaction_filter: 'invoice',
			payment_mode: 'Cheque',
		});
	})).sort((a, b) => {
		return new Date(b.posting_date || b.creation || 0) - new Date(a.posting_date || a.creation || 0);
	});
}

function get_customer_transactions_section_html() {
	return `
		<div class="cm-detail-section">
			<div class="cm-detail-section-title">
				<h3>Transactions</h3>
				<div class="cm-detail-filter">
					<label>Filter</label>
					<select class="form-control" data-filter="transaction_type">
						<option value="invoices">All Invoices</option>
						<option value="quotations">Quotations</option>
						<option value="payments">Payments</option>
						<option value="job_cards">Job Cards</option>
					</select>
					<span class="cm-transaction-count"></span>
				</div>
			</div>
			<div class="cm-detail-table-wrap">
				<div class="cm-detail-table-scroller">
					<table class="cm-detail-table">
						<thead></thead>
						<tbody></tbody>
					</table>
				</div>
			</div>
		</div>
	`;
}

function get_customer_empty_transaction_row(message, colspan) {
	return `
		<tr class="cm-empty-row">
			<td colspan="${cint(colspan || 1)}" style="padding:24px; text-align:center; color:var(--text-muted);">
				${cm_text(message || 'No transactions found for this customer.')}
			</td>
		</tr>
	`;
}

function get_customer_invoice_row_html(invoice) {
	let status_color = get_customer_manager_status_color(invoice.status);
	let source = invoice.custom_source_quotation || 'Direct / Sales Order';

	return `
		<tr class="cm-transaction-row cm-invoice-row" data-name="${cm_attr(invoice.name)}" data-payment-mode="${cm_attr(invoice.payment_mode)}">
			<td>
				<span class="cm-status-pill" style="background:var(--subtle-fg); color:var(--text-color);">
					${cm_text(invoice.transaction_type)}
				</span>
			</td>
			<td>
				<div style="font-weight:600; color:var(--primary);">${cm_text(invoice.name)}</div>
				<div style="font-size:12px; color:var(--text-muted);">${cm_text(source)}</div>
			</td>
			<td>${invoice.posting_date ? cm_text(frappe.datetime.str_to_user(invoice.posting_date)) : '-'}</td>
			<td style="text-align:right; font-weight:600;">${format_currency(get_customer_manager_invoice_total(invoice), invoice.currency || 'KES')}</td>
			<td style="text-align:right;">${format_currency(get_customer_manager_invoice_outstanding(invoice), invoice.currency || 'KES')}</td>
			<td style="text-align:center;">
				<span class="cm-status-pill" style="background:${status_color}20; color:${status_color};">
					${cm_text(invoice.status || '-')}
				</span>
			</td>
		</tr>
	`;
}

function get_customer_quotation_row_html(quotation) {
	let status_color = get_customer_manager_status_color(quotation.status);
	let total = get_customer_manager_document_total(quotation);
	return `
		<tr class="cm-transaction-row cm-quotation-row" data-name="${cm_attr(quotation.name)}">
			<td>
				<div style="font-weight:600; color:var(--primary);">${cm_text(quotation.name)}</div>
				<div style="font-size:12px; color:var(--text-muted);">${quotation.valid_till ? `Valid till ${cm_text(frappe.datetime.str_to_user(quotation.valid_till))}` : 'No valid till date'}</div>
			</td>
			<td>${quotation.transaction_date ? cm_text(frappe.datetime.str_to_user(quotation.transaction_date)) : '-'}</td>
			<td style="text-align:right; font-weight:600;">${format_currency(total, quotation.currency || 'KES')}</td>
			<td style="text-align:center;">
				<span class="cm-status-pill" style="background:${status_color}20; color:${status_color};">
					${cm_text(quotation.status || '-')}
				</span>
			</td>
		</tr>
	`;
}

function get_customer_payment_row_html(payment, job_card) {
	let job_card_cell = payment.job_card
		? `<a href="#" class="cm-payment-jobcard-link" data-job-card="${cm_attr(payment.job_card)}" style="color:var(--primary); font-weight:600;">${cm_text(payment.job_card)}</a>`
		: '-';
	let balance_cell = job_card ? format_currency(job_card.balance_amount || 0, 'KES') : '-';

	return `
		<tr class="cm-transaction-row cm-payment-row" data-name="${cm_attr(payment.name)}">
			<td>
				<div style="font-weight:600; color:var(--primary);">${cm_text(payment.name)}</div>
				<div style="font-size:12px; color:var(--text-muted);">${cm_text(payment.reference || 'No reference')}</div>
			</td>
			<td>${payment.date ? cm_text(frappe.datetime.str_to_user(payment.date)) : '-'}</td>
			<td style="text-align:right; font-weight:600;">${format_currency(payment.amount || 0, 'KES')}</td>
			<td style="text-align:right;">${balance_cell}</td>
			<td>${cm_text(payment.payment_method || '-')}</td>
			<td>${cm_text(payment.deposit_to || '-')}</td>
			<td>${job_card_cell}</td>
		</tr>
	`;
}

function get_customer_job_card_row_html(job_card) {
	let status_color = get_customer_manager_status_color(job_card.status);
	return `
		<tr class="cm-transaction-row cm-job-card-row" data-name="${cm_attr(job_card.name)}">
			<td>
				<div style="font-weight:600; color:var(--primary);">${cm_text(job_card.name)}</div>
				<div style="font-size:12px; color:var(--text-muted);">${cm_text(job_card.quotation || 'No quotation')}</div>
			</td>
			<td>${cm_text(job_card.payment_mode || '-')}</td>
			<td>${cm_text(job_card.payment_option || '-')}</td>
			<td style="text-align:right; font-weight:600;">${format_currency(job_card.quotation_amount || 0, 'KES')}</td>
			<td style="text-align:right;">${format_currency(job_card.payment_amount || 0, 'KES')}</td>
			<td style="text-align:right;">${format_currency(job_card.balance_amount || 0, 'KES')}</td>
			<td style="text-align:center;">
				<span class="cm-status-pill" style="background:${status_color}20; color:${status_color};">
					${cm_text(job_card.status || '-')}
				</span>
			</td>
		</tr>
	`;
}

function render_customer_selected_transaction_table(page) {
	let $body = $(page.body);
	let selected = $body.find('[data-filter="transaction_type"]').val() || 'invoices';
	let transactions = page.customer_manager_transactions || {};
	let config = get_customer_transaction_table_config(selected, transactions);
	let rows = config.rows || [];

	let header_html = config.columns.map(column => {
		let style = column.align ? ` style="text-align:${cm_attr(column.align)};"` : '';
		return `<th${style}>${cm_text(column.label)}</th>`;
	}).join('');

	let row_html = rows.length
		? rows.map(config.render_row).join('')
		: get_customer_empty_transaction_row(config.empty_message, config.columns.length);

	$body.find('.cm-detail-table thead').html(`<tr>${header_html}</tr>`);
	$body.find('.cm-detail-table tbody').html(row_html);

	// Show count only, e.g. "1" instead of "1 payment"
	$body.find('.cm-transaction-count').text(rows.length);
}

function get_customer_transaction_table_config(selected, transactions) {
	let invoices = transactions.invoices || [];
	let quotations = transactions.quotations || [];
	let payments = transactions.payments || [];
	let job_cards = transactions.job_cards || [];

	if (selected === 'quotations') {
		return {
			rows: quotations,
			count_label: quotations.length === 1 ? 'quotation' : 'quotations',
			empty_message: 'No quotations found for this customer.',
			columns: [
				{ label: 'Quotation' },
				{ label: 'Date' },
				{ label: 'Amount', align: 'right' },
				{ label: 'Status', align: 'center' },
			],
			render_row: get_customer_quotation_row_html,
		};
	}

	if (selected === 'payments') {
		let job_card_by_name = {};
		job_cards.forEach(job_card => {
			job_card_by_name[job_card.name] = job_card;
		});

		return {
			rows: payments,
			count_label: payments.length === 1 ? 'payment' : 'payments',
			empty_message: 'No payments found for this customer.',
			columns: [
				{ label: 'Payment' },
				{ label: 'Date' },
				{ label: 'Amount', align: 'right' },
				{ label: 'Balance', align: 'right' },
				{ label: 'Method' },
				{ label: 'Deposit To' },
				{ label: 'Job Card' },
			],
			render_row: function (payment) {
				return get_customer_payment_row_html(payment, job_card_by_name[payment.job_card]);
			},
		};
	}

	if (selected === 'job_cards') {
		return {
			rows: job_cards,
			count_label: job_cards.length === 1 ? 'job card' : 'job cards',
			empty_message: 'No job cards found for this customer.',
			columns: [
				{ label: 'Job Card' },
				{ label: 'Payment Mode' },
				{ label: 'Payment Option' },
				{ label: 'Quotation Amount', align: 'right' },
				{ label: 'Payment', align: 'right' },
				{ label: 'Balance', align: 'right' },
				{ label: 'Status', align: 'center' },
			],
			render_row: get_customer_job_card_row_html,
		};
	}

	return {
		rows: invoices,
		count_label: invoices.length === 1 ? 'invoice' : 'invoices',
		empty_message: 'No invoices found for this customer.',
		columns: [
			{ label: 'Type' },
			{ label: 'Invoice' },
			{ label: 'Date' },
			{ label: 'Amount', align: 'right' },
			{ label: 'Outstanding', align: 'right' },
			{ label: 'Status', align: 'center' },
		],
		render_row: get_customer_invoice_row_html,
	};
}

function customer_manager_invoice_uses_visual_vat(invoice) {
	return flt(invoice.total_taxes_and_charges || 0) === 0;
}

function get_customer_manager_invoice_total(invoice) {
	let total = flt(invoice.grand_total || 0);
	return customer_manager_invoice_uses_visual_vat(invoice) ? flt(total * (1 + CUSTOMER_MANAGER_VAT_RATE)) : total;
}

function get_customer_manager_invoice_outstanding(invoice) {
	let outstanding = flt(invoice.outstanding_amount || 0);
	return customer_manager_invoice_uses_visual_vat(invoice) ? flt(outstanding * (1 + CUSTOMER_MANAGER_VAT_RATE)) : outstanding;
}

function get_customer_manager_document_total(doc) {
	let rounded_total = flt(doc.rounded_total || 0);
	if (rounded_total) {
		return rounded_total;
	}

	let total = flt(doc.grand_total || 0);
	return flt(doc.total_taxes_and_charges || 0) ? total : flt(total * (1 + CUSTOMER_MANAGER_VAT_RATE));
}

function get_customer_manager_status_color(status) {
	return {
		'Draft': '#f39c12',
		'Open': '#3498db',
		'Submitted': '#3498db',
		'Paid': '#2ecc71',
		'Partly Paid': '#16a085',
		'Unpaid': '#e67e22',
		'Overdue': '#e74c3c',
		'Ordered': '#2ecc71',
		'In Progress': '#3498db',
		'Completed': '#2ecc71',
		'Lost': '#e74c3c',
		'Return': '#8e44ad',
		'Credit Note Issued': '#8e44ad',
		'Cancelled': '#7f8c8d',
		'Expired': '#7f8c8d',
	}[status] || '#7f8c8d';
}

function cm_text(value) {
	return frappe.utils.escape_html(value === null || value === undefined || value === '' ? '-' : String(value));
}

function cm_attr(value) {
	return frappe.utils.escape_html(value === null || value === undefined ? '' : String(value));
}

function load_customers(page, page_no) {
	let state = get_customer_manager_list_state(page);
	let wrapper = page.body;
	let tbody = $(wrapper).find('.cm-list-body');
	let search = ($(wrapper).find('[data-filter="search"]').val() || '').trim();
	let customer_type = ($(wrapper).find('[data-filter="customer_type"]').val() || 'invoice').trim().toLowerCase();
	let columns = get_customer_manager_list_columns(customer_type);
	render_customer_manager_list_loading($(wrapper), customer_type, 'Loading customers...');

	frappe.call({
		method: 'crystal_alluminium_works.api.get_customer_manager_customers',
		args: {
			search: search,
			customer_type: customer_type,
			page: page_no,
			page_length: state.page_length
		},
		callback: function (r) {
			let message = r.message || {};
			let data = message.rows || [];
			state.page = message.page || page_no || 1;
			state.page_length = message.page_length || state.page_length;
			state.total_count = message.total_count || 0;
			state.has_more = !!message.has_more;

			if (data.length === 0) {
				tbody.html(`<tr><td colspan="${columns.length}" style="padding:24px; text-align:center; color:var(--text-muted);">No customers found.</td></tr>`);
				render_customer_manager_pagination(page);
				return;
			}

			let html = '';
			data.forEach(d => {
				let row_cells = [
					`<td style="font-weight: 600;">${frappe.utils.escape_html(d.customer_name || d.name || '')}</td>`
				];

				if (customer_type !== 'cash') {
					row_cells.push(`<td>${frappe.utils.escape_html(d.tax_id || '-')}</td>`);
				}

				row_cells.push(`<td>${frappe.utils.escape_html(d.phone_number || '-')}</td>`);
				row_cells.push(`<td>${frappe.utils.escape_html(d.customer_type || '-')}</td>`);
				html += `
					<tr data-name="${frappe.utils.escape_html(d.name || '')}">
						${row_cells.join('')}
					</tr>
				`;
			});

			tbody.html(html);
			render_customer_manager_pagination(page);
		}
	});
}

function render_customer_manager_pagination(page) {
	let state = get_customer_manager_list_state(page);
	let start = state.total_count ? ((state.page - 1) * state.page_length) + 1 : 0;
	let end = Math.min(state.page * state.page_length, state.total_count || 0);

	$(page.body).find('.cm-list-pagination').html(`
		<div class="cm-list-pagination-bar">
			<div class="cm-list-pagination-meta">
				Showing ${start}-${end} of ${state.total_count || 0} customers
			</div>
			<div class="cm-list-pagination-actions">
				<button class="btn btn-default btn-sm btn-paging ${state.page <= 1 ? 'disabled' : ''}" data-page="${state.page - 1}">
					Previous
				</button>
				<span class="cm-list-pagination-page">Page ${state.page}</span>
				<button class="btn btn-default btn-sm btn-paging ${!state.has_more ? 'disabled' : ''}" data-page="${state.page + 1}">
					Next
				</button>
			</div>
		</div>
	`);
}
