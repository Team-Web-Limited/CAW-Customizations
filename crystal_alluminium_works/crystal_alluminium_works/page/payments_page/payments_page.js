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
	// Default the date range to today — both the table and the per-method totals pills read
	// straight off these inputs, so this is what makes them read "today" by default rather
	// than the whole all-time history.
	let today = frappe.datetime.get_today();

	let html = `
	<style>
		.pay-page { width:100%; max-width: 1400px; margin: 0 auto; padding: 24px 16px; }
		.pay-toolbar { display: flex; justify-content: flex-end; margin-bottom: 18px; }
		.pay-card { background: var(--fg-color); border: 1px solid var(--border-color); border-radius: 8px; box-shadow: var(--shadow-xs); overflow: hidden; margin-bottom: 20px; }
		.pay-card-header { padding: 14px 18px; font-size: 15px; font-weight: 700; color: var(--heading-color); border-bottom: 1px solid var(--border-color); background: var(--subtle-fg); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
		.pay-card-header .pay-icon { font-size: 18px; }
		.pay-method-totals { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
		.pay-method-pill { background: var(--fg-color); border: 1px solid var(--border-color); border-radius: 14px; padding: 5px 12px; font-size: 12px; font-weight: 600; color: var(--text-color); white-space: nowrap; }
		/* Compact correction marker, inline with the amount so a corrected row stays the same
		   height as every other one and the Amount column keeps its natural width. */
		.pay-cbadge { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; margin-right: 6px; border-radius: 50%; font-size: 10px; font-weight: 700; line-height: 1; cursor: help; vertical-align: middle; }
		.pay-cbadge-corrected { background: #e74c3c; color: #fff; }
		.pay-cbadge-correction { background: #f39c12; color: #fff; }
		.pay-method-pill .pay-method-pill-label { color: var(--text-muted); font-weight: 600; margin-right: 5px; }
		.pay-method-pill-total { background: #2c3e50; border-color: #2c3e50; color: #fff; }
		.pay-method-pill-total .pay-method-pill-label { color: rgba(255,255,255,.75); }
		.pay-filters { padding:16px 18px; border-bottom:1px solid var(--border-color); background:var(--fg-color); }
		.pay-filter-grid { display:grid; grid-template-columns:minmax(220px, 2fr) minmax(170px, 1fr) minmax(150px, .9fr) minmax(140px, .8fr) minmax(140px, .8fr) auto; gap:12px; align-items:end; }
		.pay-filter-field label { display:block; margin-bottom:6px; color:var(--text-muted); font-size:12px; font-weight:600; }
		.pay-filter-actions { display:flex; gap:8px; }
		.pay-download-dropdown { position: relative; display: inline-block; }
		.pay-download-menu { position: absolute; top: calc(100% + 4px); right: 0; background: var(--fg-color); border: 1px solid var(--border-color); border-radius: 6px; box-shadow: 0 4px 14px rgba(0,0,0,.15); min-width: 170px; z-index: 50; overflow: hidden; }
		.pay-download-option { padding: 9px 14px; font-size: 13px; color: var(--text-color); cursor: pointer; display: flex; align-items: center; }
		.pay-download-option:hover { background: var(--subtle-fg); }
		.pay-table-scroll { height:560px; overflow:auto; }
		.pay-table { width: 100%; min-width: 1250px; border-collapse: separate; border-spacing:0; }
		.pay-table th { position:sticky; top:0; z-index:2; padding: 11px 14px; font-size: 12px; font-weight: 700; color: var(--text-muted); text-align: left; border-bottom: 1px solid var(--border-color); background: var(--subtle-fg); }
		.pay-table td { padding: 12px 14px; font-size: 13px; color: var(--text-color); border-bottom: 1px solid var(--border-color); vertical-align: middle; }
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
				<div class="pay-method-totals"></div>
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
						<label>Correction</label>
						<select class="form-control" data-filter="correction_view">
							<option value="all">All payments</option>
							<option value="active">Active only</option>
							<option value="corrections">Corrections only</option>
							<option value="corrected">Superseded only</option>
						</select>
					</div>
					<div class="pay-filter-field">
						<label>From Date</label>
						<input type="date" class="form-control" data-filter="from_date" value="${today}">
					</div>
					<div class="pay-filter-field">
						<label>To Date</label>
						<input type="date" class="form-control" data-filter="to_date" value="${today}">
					</div>
					<div class="pay-filter-actions">
						<button class="btn btn-primary pay-filter-apply">Search</button>
						<button class="btn btn-default pay-filter-clear">Clear</button>
						<div class="pay-download-dropdown">
							<button class="btn btn-default pay-download-toggle" type="button" title="Download the currently filtered payments">
								<i class="fa fa-download" style="margin-right:6px;"></i>Download Report <i class="fa fa-caret-down" style="margin-left:6px;"></i>
							</button>
							<div class="pay-download-menu" hidden>
								<div class="pay-download-option" data-format="excel">
									<i class="fa fa-file-excel-o" style="margin-right:8px;"></i>Excel (.xlsx)
								</div>
								<div class="pay-download-option" data-format="pdf">
									<i class="fa fa-file-pdf-o" style="margin-right:8px;"></i>PDF
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
			<div class="pay-table-scroll">
				<table class="pay-table">
					<thead>
						<tr>
							<th>Date</th>
							<th style="text-align:center;">C.Type</th>
							<th>Name</th>
							<th>Phone</th>
							<th style="text-align:right;">Amount</th>
							<th>Method</th>
							<th>Deposit To</th>
							<th>Reference</th>
							<th>Quotation</th>
							<th style="text-align:center;">Actions</th>
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
				<td colspan="10" class="pay-muted" style="text-align:center;padding:24px;">
					No payments recorded yet.
				</td>
			</tr>
		`;
	}

	return records.map(row => {
		let correction = build_correction_display(row);
		let quotation_cell = '<span class="pay-muted">-</span>';
		if (row.quotation) {
			quotation_cell = frappe.utils.escape_html(row.quotation);
			if (!row.job_card) {
				quotation_cell += ' <span class="pay-muted" title="No Job Card yet — held as deposit credit">(deposit)</span>';
			}
		}
		let is_cash = row.customer_type === 'Cash';
		let type_color = is_cash ? '#16a085' : '#8e44ad';
		return `
			<tr>
				<td>${frappe.utils.escape_html(row.date ? frappe.datetime.str_to_user(row.date) : '-')}</td>
				<td style="text-align:center;">
					<span style="background:${type_color}20; color:${type_color}; padding:4px 12px; border-radius:12px; font-size:12px; font-weight:600;">
						${frappe.utils.escape_html(row.customer_type || '—')}
					</span>
				</td>
				<td style="font-weight:500;">${frappe.utils.escape_html(row.display_name || '-')}</td>
				<td>${frappe.utils.escape_html(row.display_phone || '-')}</td>
				<td style="text-align:right;font-weight:600;white-space:nowrap;">${correction.badge}<span${correction.amount_style}>${format_currency(row.amount || 0, 'KES')}</span></td>
				<td>${frappe.utils.escape_html(row.payment_method || '-')}</td>
				<td>${frappe.utils.escape_html(row.deposit_to || '-')}</td>
				<td>${frappe.utils.escape_html(row.reference || '-')}</td>
				<td>${quotation_cell}</td>
			<td style="text-align:center;">${correction.action}</td>
			</tr>
		`;
	}).join('');
}

function build_correction_display(row) {
	// The two halves of a correction (see api.py correct_payment) both stay listed — that
	// visibility IS the correction log, so the superseded original is struck through and badged
	// rather than hidden. `correction_counterpart` is pre-resolved server-side
	// (_attach_payment_correction_context) so this stays a pure render with no extra fetch.
	let counterpart = row.correction_counterpart || null;
	let display = { badge: '', amount_style: '', action: '<span class="pay-muted">-</span>' };

	if (row.is_corrected) {
		let bits = [];
		if (counterpart) {
			bits.push(`Replaced by Payment #${counterpart.name}`);
			if (Math.abs(flt(counterpart.amount) - flt(row.amount)) > 0.0001) {
				bits.push(`${format_currency(row.amount || 0, 'KES')} → ${format_currency(counterpart.amount || 0, 'KES')}`);
			}
			if (counterpart.payment_method && counterpart.payment_method !== row.payment_method) {
				bits.push(`${row.payment_method} → ${counterpart.payment_method}`);
			}
			if (counterpart.correction_reason) bits.push(`Reason: ${counterpart.correction_reason}`);
		}
		if (row.corrected_on) bits.push(`Corrected ${frappe.datetime.str_to_user(row.corrected_on)} by ${row.corrected_by || '—'}`);
		display.badge = `<span class="pay-cbadge pay-cbadge-corrected" title="${frappe.utils.escape_html('Corrected — ' + bits.join(' · '))}">C</span>`;
		// Struck through because this row is history, not money — it is excluded from the totals
		// pills and from both report downloads.
		display.amount_style = ' style="text-decoration:line-through;opacity:.55;"';
		return display;
	}

	if (row.corrects_payment) {
		let bits = [`Replaces Payment #${row.corrects_payment}`];
		if (counterpart) {
			if (Math.abs(flt(counterpart.amount) - flt(row.amount)) > 0.0001) {
				bits.push(`was ${format_currency(counterpart.amount || 0, 'KES')}`);
			}
			if (counterpart.payment_method && counterpart.payment_method !== row.payment_method) {
				bits.push(`was ${counterpart.payment_method}`);
			}
		}
		if (row.correction_reason) bits.push(`Reason: ${row.correction_reason}`);
		display.badge = `<span class="pay-cbadge pay-cbadge-correction" title="${frappe.utils.escape_html('Correction — ' + bits.join(' · '))}">C</span>`;
	}

	// Only the CHEAP half of the gate: age, type and whether there is a Payment Entry to reverse.
	// The expensive constraints — released items, JC Operations stock entries, invoices, closed
	// periods — are far too costly to evaluate for every row, so they run on click via
	// get_payment_correction_eligibility, the same way the Job Card cancel flow does.
	let correctable = !row.is_corrected && row.payment_type !== 'Refund'
		&& row.correction_window_open && row.payment_entry;
	if (correctable) {
		display.action = `<button class="btn btn-xs btn-default pay-correct-btn" data-payment="${frappe.utils.escape_html(String(row.name))}" title="Correct a mis-keyed amount, method or account">Correct</button>`;
	}
	return display;
}

function render_method_totals_pills(data) {
	let by_method = (data && data.by_method) || [];
	if (!by_method.length) {
		return '<span class="pay-muted" style="font-size:12px;">No payments match these filters.</span>';
	}
	let pills = by_method.map(row => `
		<span class="pay-method-pill">
			<span class="pay-method-pill-label">${frappe.utils.escape_html(row.payment_method)}</span>${format_currency(row.total || 0, 'KES')}
		</span>
	`).join('');
	pills += `
		<span class="pay-method-pill pay-method-pill-total">
			<span class="pay-method-pill-label">Total</span>${format_currency((data && data.total) || 0, 'KES')}
		</span>
	`;
	return pills;
}

function download_payments_report(page, format) {
	// Streams the file straight down; no File record is created (see api.py
	// download_payments_report / download_payments_report_pdf / _stream_xlsx_file). Uses
	// exactly the filters currently applied on the page — the same ones driving the table and
	// the totals pills — so the report's own totals-by-method summary matches what's on screen.
	let $body = $(page.body);
	let params = new URLSearchParams();
	let args = {
		search: $body.find('[data-filter="search"]').val() || '',
		payment_method: $body.find('[data-filter="payment_method"]').val() || '',
		from_date: $body.find('[data-filter="from_date"]').val() || '',
		to_date: $body.find('[data-filter="to_date"]').val() || ''
	};
	Object.keys(args).forEach(function(key) {
		if (args[key]) {
			params.append(key, args[key]);
		}
	});
	let method = format === 'pdf'
		? 'crystal_alluminium_works.api.download_payments_report_pdf'
		: 'crystal_alluminium_works.api.download_payments_report';
	window.open('/api/method/' + method + '?' + params.toString(), '_blank');
}

function load_payment_method_totals(page) {
	let $body = $(page.body);
	let from_date = $body.find('[data-filter="from_date"]').val() || '';
	let to_date = $body.find('[data-filter="to_date"]').val() || '';

	frappe.call({
		method: 'crystal_alluminium_works.api.get_payments_page_totals',
		args: {
			search: $body.find('[data-filter="search"]').val() || '',
			payment_method: $body.find('[data-filter="payment_method"]').val() || '',
			from_date: from_date,
			to_date: to_date
		},
		callback: function(response) {
			$body.find('.pay-method-totals').html(render_method_totals_pills(response.message || {}));
		}
	});
}

function bind_payments_page_events(page, $body) {
	$body.off('.paymentsPage');
	// Bound to document (needed to catch a click anywhere outside the dropdown), so it isn't
	// cleared by the $body.off above — clear it separately or it stacks up on re-render.
	$(document).off('.paymentsPageDownloadMenu');

	$body.on('click.paymentsPage', '.pay-filter-apply', function() {
		load_payment_records(page, 1);
	});

	$body.on('click.paymentsPage', '.pay-filter-clear', function() {
		$body.find('[data-filter]').val('');
		// Correction view has no meaningful blank state — reset it to its default instead.
		$body.find('[data-filter="correction_view"]').val('all');
		// Search / Payment Method clear to blank, but the date range goes back to today —
		// that's the page's default, not "all time".
		let today = frappe.datetime.get_today();
		$body.find('[data-filter="from_date"]').val(today);
		$body.find('[data-filter="to_date"]').val(today);
		load_payment_records(page, 1);
	});

	$body.on('click.paymentsPage', '.pay-download-toggle', function(event) {
		event.stopPropagation();
		$body.find('.pay-download-menu').prop('hidden', function(_, hidden) { return !hidden; });
	});

	$body.on('click.paymentsPage', '.pay-download-option', function() {
		let format = $(this).attr('data-format');
		$body.find('.pay-download-menu').prop('hidden', true);
		download_payments_report(page, format);
	});

	// Close the dropdown on any click elsewhere on the page.
	$(document).on('click.paymentsPageDownloadMenu', function() {
		$body.find('.pay-download-menu').prop('hidden', true);
	});

	$body.on('keydown.paymentsPage', '.pay-filters input', function(event) {
		if (event.key === 'Enter') {
			load_payment_records(page, 1);
		}
	});

	$body.on('change.paymentsPage', '[data-filter="correction_view"], [data-filter="payment_method"]', function() {
		load_payment_records(page, 1);
	});

	$body.on('click.paymentsPage', '.pay-correct-btn', function() {
		open_correct_payment_modal(page, $(this).attr('data-payment'));
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

	// Only the filters changed (a fresh page-1 load), not just paging within the same result
	// set — refetch the per-method totals then, not on every Previous/Next click.
	if (state.page === 1) {
		load_payment_method_totals(page);
	}

	$body.find('.pay-table-body').html(`
		<tr><td colspan="10" class="pay-muted" style="text-align:center;padding:32px;">Loading payments...</td></tr>
	`);

	frappe.call({
		method: 'crystal_alluminium_works.api.get_payments_page',
		args: {
			search: $body.find('[data-filter="search"]').val() || '',
			correction_view: $body.find('[data-filter="correction_view"]').val() || 'all',
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

function open_create_payment_modal(page) {
	// The dialog itself lives in the shared caw_payment_dialog.js (see app_include_js in
	// hooks.py) so other desk pages (e.g. Quotation Manager's Record/Refund Deposit) can
	// open it in place too. It also honours frappe.route_options on its own for any caller
	// that still navigates here instead of calling CAWPaymentDialog.open() directly.
	if (!window.CAWPaymentDialog) {
		frappe.msgprint(__('Payment dialog failed to load. Please refresh the page.'));
		return;
	}
	window.CAWPaymentDialog.open({
		onSaved: () => load_payment_records(page, 1)
	});
}

function open_correct_payment_modal(page, payment) {
	if (!window.CAWPaymentDialog || !window.CAWPaymentDialog.openCorrection) {
		frappe.msgprint(__('Payment dialog failed to load. Please refresh the page.'));
		return;
	}
	// The real gate runs here, on click, not when the row was rendered: checking releases, JC
	// Operations stock entries, invoices and closed periods for all 30 rows of a page would be
	// far too costly. Same pattern as the Job Card cancel flow, which consults its own
	// eligibility at the moment of action.
	frappe.call({
		method: 'crystal_alluminium_works.api.get_payment_correction_eligibility',
		args: { payment: payment },
		freeze: true,
		freeze_message: __('Checking...'),
		callback: function(r) {
			if (!r || !r.message) return;
			window.CAWPaymentDialog.openCorrection({
				payment: payment,
				eligibility: r.message,
				// Back to page 1, which also refreshes the per-method totals pills.
				onSaved: () => load_payment_records(page, 1)
			});
		}
	});
}

