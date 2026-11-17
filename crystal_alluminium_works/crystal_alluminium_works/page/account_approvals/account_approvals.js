// Account Approvals: one-time requests to let work through that an account limit or overdue
// balance stopped (credit_control.request_credit_approval). Accounts approves or rejects each;
// an approved request lets that one job card / release / invoice go ahead once and is then
// marked Used. Requests above the Admin threshold (CAW Credit Settings) need a System Manager.
frappe.pages['account-approvals'].on_page_load = function (wrapper) {
	let page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Account Approvals',
		single_column: true,
	});
	wrapper.account_approvals_page = page;
	page.aa_tab = 'Pending';

	page.set_secondary_action('Refresh', () => load_account_approvals(page));
	$(page.body).html(`
		<style>
			.aa-page { max-width: 1200px; margin: 0 auto; padding: 20px 16px; }
			.aa-tabs { display: flex; gap: 8px; margin-bottom: 16px; }
			.aa-table-wrap { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; box-shadow: var(--shadow-xs); overflow-x: auto; }
			.aa-table { width: 100%; min-width: 900px; border-collapse: collapse; }
			.aa-table th { padding: 10px 14px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; text-align: left; background: var(--subtle-fg); border-bottom: 1px solid var(--border-color); }
			.aa-table td { padding: 10px 14px; font-size: 13px; vertical-align: top; border-bottom: 1px solid var(--border-color); }
			.aa-muted { color: var(--text-muted); font-size: 12px; }
			.aa-bad { color: var(--red-600); font-weight: 600; }
		</style>
		<div class="aa-page">
			<div class="aa-tabs">
				<button class="btn btn-sm btn-primary" data-tab="Pending">Pending</button>
				<button class="btn btn-sm btn-default" data-tab="Decided">Decided</button>
				<button class="btn btn-sm btn-default" data-tab="Documents">Company Documents</button>
			</div>
			<div class="aa-docs"></div>
			<div class="aa-table-wrap">
				<table class="aa-table">
					<thead><tr>
						<th>Requested</th><th>Customer</th><th>For</th><th>Figures</th><th>Reason</th><th>Status</th><th></th>
					</tr></thead>
					<tbody class="aa-body"></tbody>
				</table>
			</div>
		</div>
	`);

	$(page.body).on('click', '[data-tab]', function () {
		page.aa_tab = $(this).attr('data-tab');
		$(page.body).find('[data-tab]').removeClass('btn-primary').addClass('btn-default');
		$(this).removeClass('btn-default').addClass('btn-primary');
		load_account_approvals(page);
	});
	$(page.body).on('click', '[data-decide]', function () {
		decide_account_approval(page, $(this).attr('data-name'), cint($(this).attr('data-decide')));
	});
	$(page.body).on('click', '[data-open-customer]', function (e) {
		e.preventDefault();
		frappe.set_route('customer-manager', $(this).attr('data-open-customer'));
	});
	$(page.body).on('click', '[data-open-job-card]', function (e) {
		e.preventDefault();
		frappe.set_route('job-card-detail', $(this).attr('data-open-job-card'));
	});
	$(page.body).on('click', '[data-open-quotation]', function (e) {
		e.preventDefault();
		frappe.set_route('quotation-manager', $(this).attr('data-open-quotation'));
	});
};

frappe.pages['account-approvals'].on_page_show = function (wrapper) {
	if (wrapper.account_approvals_page) {
		load_account_approvals(wrapper.account_approvals_page);
	}
};

function aa_text(value) {
	return frappe.utils.escape_html(value === null || value === undefined || value === '' ? '-' : String(value));
}

function load_account_approvals(page) {
	let is_docs = page.aa_tab === 'Documents';
	$(page.body).find('.aa-table-wrap').toggle(!is_docs);
	$(page.body).find('.aa-docs').toggle(is_docs);
	if (is_docs) {
		load_document_queue(page);
		return;
	}
	let $body = $(page.body).find('.aa-body');
	$body.html('<tr><td colspan="7" class="aa-muted" style="text-align:center;padding:20px;">Loading...</td></tr>');
	frappe.call({
		method: 'crystal_alluminium_works.credit_control.get_credit_approvals',
		args: { status: page.aa_tab },
		callback: (r) => {
			let rows = r.message || [];
			if (!rows.length) {
				$body.html(`<tr><td colspan="7" class="aa-muted" style="text-align:center;padding:20px;">${page.aa_tab === 'Pending' ? 'No requests waiting.' : 'Nothing decided yet.'}</td></tr>`);
				return;
			}
			$body.html(rows.map(aa_row_html).join(''));
		}
	});
}

function aa_row_html(row) {
	let money = (value) => format_currency(value || 0);
	let work = [];
	if (row.job_card) work.push(`<a href="#" data-open-job-card="${frappe.utils.escape_html(row.job_card)}">${aa_text(row.job_card)}</a>`);
	if (row.quotation) work.push(`<a href="#" data-open-quotation="${frappe.utils.escape_html(row.quotation)}">${aa_text(row.quotation)}</a>`);
	let figures = [
		`Limit ${money(row.credit_limit)}`,
		`Outstanding ${money(row.used_amount)}`,
		row.amount ? `This work ${money(row.amount)}` : '',
		row.excess ? `<span class="aa-bad">Over by ${money(row.excess)}</span>` : '',
		row.overdue ? `<span class="aa-bad">Overdue ${money(row.overdue)}</span>` : '',
	].filter(Boolean).join('<br>');
	let decision = row.status === 'Pending'
		? (row.needs_admin ? '<div class="aa-muted">Above the Admin threshold</div>' : '')
		: `<div class="aa-muted">${aa_text(row.decided_by)} · ${aa_text(frappe.datetime.str_to_user(row.decided_on))}</div>`
			+ (row.decision_note ? `<div class="aa-muted">${aa_text(row.decision_note)}</div>` : '')
			+ (row.used_for ? `<div class="aa-muted">Used for ${aa_text(row.used_for)}</div>` : '');
	let actions = row.can_decide
		? `<button class="btn btn-xs btn-primary" data-decide="1" data-name="${frappe.utils.escape_html(row.name)}">Approve</button>
		   <button class="btn btn-xs btn-default" data-decide="0" data-name="${frappe.utils.escape_html(row.name)}">Reject</button>`
		: '';
	return `
		<tr>
			<td>${aa_text(frappe.datetime.str_to_user(row.requested_on))}<div class="aa-muted">${aa_text(row.requested_by)}</div></td>
			<td><a href="#" data-open-customer="${frappe.utils.escape_html(row.customer)}">${aa_text(row.customer_name || row.customer)}</a></td>
			<td>${aa_text(row.checkpoint)}<div class="aa-muted">${work.join(' · ')}</div></td>
			<td>${figures}</td>
			<td>${aa_text(row.reason)}</td>
			<td><b>${aa_text(row.status)}</b>${decision}</td>
			<td style="white-space:nowrap;">${actions}</td>
		</tr>`;
}

function decide_account_approval(page, name, approve) {
	let dialog = new frappe.ui.Dialog({
		title: approve ? 'Approve Request' : 'Reject Request',
		fields: [
			{
				fieldtype: 'Small Text',
				fieldname: 'note',
				label: approve ? 'Note (optional)' : 'Reason for rejecting',
				reqd: approve ? 0 : 1
			}
		],
		primary_action_label: approve ? 'Approve' : 'Reject',
		primary_action(values) {
			frappe.call({
				method: 'crystal_alluminium_works.credit_control.decide_credit_approval',
				args: { name: name, approve: approve, note: values.note || '' },
				freeze: true,
				callback: () => {
					dialog.hide();
					frappe.show_alert({ message: approve ? 'Approved' : 'Rejected', indicator: approve ? 'green' : 'orange' });
					load_account_approvals(page);
				}
			});
		}
	});
	dialog.show();
}

// Company documents (customer_documents.py): uploads waiting for Accounts to check, and credit
// applications — late ones first — with what they still need. Checking and approving happen on
// the customer's page in Customer Manager.
function load_document_queue(page) {
	let $docs = $(page.body).find('.aa-docs');
	$docs.html('<div class="aa-muted" style="padding:20px;text-align:center;">Loading...</div>');
	frappe.call({
		method: 'crystal_alluminium_works.customer_documents.get_document_queue',
		callback: (r) => {
			let q = r.message || {};
			let open = (customer, label) => `<a href="#" data-open-customer="${frappe.utils.escape_html(customer)}">${aa_text(label || customer)}</a>`;
			let doc_rows = (q.documents || []).map(d => `
				<tr>
					<td>${open(d.customer, d.customer_name)}</td>
					<td>${aa_text(d.document_type)}${d.pin_on_document ? `<div class="aa-muted">PIN ${aa_text(d.pin_on_document)}</div>` : ''}</td>
					<td>${d.file ? `<a href="${frappe.utils.escape_html(d.file)}" target="_blank">View</a>` : '-'}</td>
					<td>${aa_text(d.uploaded_by)}<div class="aa-muted">${aa_text(frappe.datetime.str_to_user(d.uploaded_on))}</div></td>
				</tr>`).join('') || '<tr><td colspan="4" class="aa-muted" style="text-align:center;padding:16px;">No documents waiting to be checked.</td></tr>';
			let app_rows = (q.applications || []).map(a => `
				<tr>
					<td>${open(a.customer, a.customer_name)}</td>
					<td class="${a.late ? 'aa-bad' : ''}">${aa_text(frappe.datetime.str_to_user(a.due_on))}${a.late ? '<div>late</div>' : ''}</td>
					<td>${aa_text(a.requested_term)}<div class="aa-muted">${a.requested_limit ? format_currency(a.requested_limit) : ''}</div></td>
					<td>${a.complete ? `<b style="color:var(--green-600);">Ready for Admin approval</b>` : `<span class="aa-muted">Needs: ${aa_text(a.missing.join(', '))}</span>`}</td>
				</tr>`).join('') || '<tr><td colspan="4" class="aa-muted" style="text-align:center;padding:16px;">No open credit applications.</td></tr>';
			$docs.html(`
				<h4 style="margin:4px 0 10px;">Waiting for Accounts to check</h4>
				<div class="aa-table-wrap" style="margin-bottom:24px;"><table class="aa-table">
					<thead><tr><th>Customer</th><th>Document</th><th>File</th><th>Uploaded</th></tr></thead>
					<tbody>${doc_rows}</tbody></table></div>
				<h4 style="margin:4px 0 10px;">Open credit applications</h4>
				<div class="aa-table-wrap"><table class="aa-table">
					<thead><tr><th>Customer</th><th>Documents Due</th><th>Requested</th><th>Progress</th></tr></thead>
					<tbody>${app_rows}</tbody></table></div>
				<p class="aa-muted" style="margin-top:10px;">Check documents and approve accounts on the customer's page in Customer Manager.</p>`);
		}
	});
}
