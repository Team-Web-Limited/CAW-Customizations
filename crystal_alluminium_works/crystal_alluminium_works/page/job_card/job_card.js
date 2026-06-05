frappe.pages['job-card'].on_page_load = function(wrapper) {
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

frappe.pages['job-card'].on_page_show = function(wrapper) {
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
		render_job_card_missing(page);
		return;
	}

	load_single_job_card(page, job_card_name);
};

function load_single_job_card(page, job_card_name) {
	let $body = $(page.body);
	page.set_title(`Job Card: ${job_card_name}`);
	$body.html('<div style="padding:40px;text-align:center;color:var(--text-muted);">Loading job card...</div>');

	frappe.call({
		method: 'crystal_alluminium_works.api.get_job_card_detail',
		args: { name: job_card_name },
		callback: function(r) {
			let message = r.message || {};
			if (!message.job_card) {
				render_job_card_missing(page);
				return;
			}

			page.set_title(`Job Card: ${message.job_card.name}`);
			$body.html(render_single_job_card(message.job_card, message.quotation));
			bind_single_job_card_events($body, message.job_card);
		}
	});
}

function render_job_card_missing(page) {
	$(page.body).html(`
		<div style="padding:40px;text-align:center;color:var(--text-muted);">
			<h3 style="margin:0 0 8px;">No Job Card Selected</h3>
			<p style="margin:0 0 18px;">Open a job card from the Job Cards list.</p>
			<button class="btn btn-primary" onclick="frappe.set_route('job-cards')">View Job Cards</button>
		</div>
	`);
}

function bind_single_job_card_events($body, job_card) {
	$body.on('click', '[data-action="open-quotation"]', function() {
		if (job_card.quotation) {
			frappe.set_route('quotation-manager', job_card.quotation);
		}
	});

	$body.on('click', '[data-action="open-customer"]', function() {
		if (job_card.customer) {
			frappe.set_route('Form', 'Customer', job_card.customer);
		}
	});

	$body.on('click', '[data-action="edit-job-card"]', function() {
		frappe.set_route('Form', 'CAW Job Card', job_card.name);
	});
}

function render_single_job_card(job_card, quotation) {
	let currency = quotation && quotation.currency ? quotation.currency : 'KES';
	let balance = flt(job_card.balance_amount || 0);
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
				<button class="btn btn-default" data-action="open-customer">Open Customer</button>
				<button class="btn btn-primary" data-action="edit-job-card">Edit Job Card</button>
			</div>
		</div>

		<div class="jc-detail-grid">
			<div class="jc-detail-card">
				<h4>Customer Details</h4>
				<div class="jc-detail-card-body">
					<div class="jc-detail-fields">
						${render_job_card_field('Customer', job_card.customer_name || job_card.customer)}
						${render_job_card_field('Payment Mode', job_card.payment_mode)}
						${render_job_card_field('Payment Option', job_card.payment_option)}
						${render_job_card_field('PIN', job_card.customer_pin)}
						${render_job_card_field('Phone Number', job_card.phone_number)}
						${render_job_card_field('Quotation', job_card.quotation)}
						${render_job_card_field('Quotation Status', quotation ? quotation.status : '')}
					</div>
				</div>
			</div>

			<div class="jc-detail-card">
				<h4>Payment Summary</h4>
				<div class="jc-detail-card-body">
					<div class="jc-detail-payments">
						<div class="jc-payment-row"><span>Quotation Amount</span><strong>${format_currency(job_card.quotation_amount || 0, currency)}</strong></div>
						<div class="jc-payment-row"><span>Payment Amount</span><strong>${format_currency(job_card.payment_amount || 0, currency)}</strong></div>
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
						${render_job_card_field('Created', frappe.datetime.str_to_user(job_card.creation || ''))}
						${render_job_card_field('Last Updated', frappe.datetime.str_to_user(job_card.modified || ''))}
					</div>
				</div>
			</div>
		</div>
	</div>
	`;
}

function render_job_card_field(label, value) {
	return `
		<div class="jc-detail-field">
			<span>${frappe.utils.escape_html(label || '')}</span>
			<strong>${frappe.utils.escape_html(value || '-')}</strong>
		</div>
	`;
}
