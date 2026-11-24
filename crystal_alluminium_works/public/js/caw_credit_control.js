/**
 * CAW Credit Control — what staff see when an account control stops a piece of work
 * (credit_control.py). The server raises CreditControlBlock from any of the three checkpoints
 * (Create Job Card, Release, Invoice) and puts the figures in r.credit_block; this registers a
 * handler for that exception type, so every page that can hit a checkpoint shows the same dialog
 * without its own error handling:
 *
 *   - Account limit / overdue: the figures, plus Record Payment (CAWPaymentDialog) and Request
 *     One-time Approval (a reason goes to Accounts, decided on the Account Approvals page).
 *   - On hold: why, and that only Accounts can clear it.
 */
(function () {
	'use strict';

	const esc = (value) => frappe.utils.escape_html(value == null ? '' : String(value));
	const money = (value, currency) => format_currency(value || 0, currency || frappe.boot.sysdefaults.currency);

	function show_credit_block(block, server_message) {
		const is_hold = block.kind === 'on_hold';
		const currency = block.currency;
		const rows = is_hold
			? `<tr><th>Reason</th><td>${esc(block.reason)}</td></tr>`
			: `
				<tr><th>Account term</th><td>${esc(block.term)}</td></tr>
				<tr><th>Account limit</th><td>${money(block.limit, currency)}</td></tr>
				<tr><th>Outstanding now</th><td>${money(block.used, currency)}</td></tr>
				${block.amount ? `<tr><th>This ${esc((block.checkpoint || '').toLowerCase())}</th><td>${money(block.amount, currency)}</td></tr>` : ''}
				${block.excess ? `<tr><th>Over the limit by</th><td class="caw-credit-bad">${money(block.excess, currency)}</td></tr>` : ''}
				${block.overdue ? `<tr><th>Overdue</th><td class="caw-credit-bad">${money(block.overdue, currency)}</td></tr>` : ''}`;

		const dialog = new frappe.ui.Dialog({
			title: is_hold ? __('Account on hold') : (block.excess ? __('Account limit reached') : __('Overdue balance')),
			size: 'large',
			fields: [{ fieldtype: 'HTML', fieldname: 'body' }]
		});
		dialog.fields_dict.body.$wrapper.html(`
			<style>
				.caw-credit-block p { margin-bottom: 12px; }
				.caw-credit-block table { width: 100%; border-collapse: collapse; }
				.caw-credit-block th, .caw-credit-block td { padding: 6px 10px; border-bottom: 1px solid var(--border-color); text-align: left; }
				.caw-credit-block th { width: 40%; color: var(--text-muted); font-weight: 500; }
				.caw-credit-block .caw-credit-bad { color: var(--red-600); font-weight: 600; }
			</style>
			<div class="caw-credit-block">
				<p><b>${esc(block.customer_name || block.customer)}</b></p>
				<table>${rows}</table>
				<p class="text-muted" style="margin-top: 12px;">
					${is_hold
						? __('No new job cards, releases or invoices until Accounts clears the hold in Customer Manager.')
						: __('Record a payment, ask Accounts for a one-time approval, or have Accounts raise the limit.')}
				</p>
			</div>
		`);

		if (!is_hold) {
			dialog.set_primary_action(__('Request One-time Approval'), () => {
				dialog.hide();
				open_request_approval(block);
			});
			if (window.CAWPaymentDialog) {
				dialog.set_secondary_action_label(__('Record Payment'));
				dialog.set_secondary_action(() => {
					dialog.hide();
					window.CAWPaymentDialog.open({ customer: block.customer, quotation: block.quotation || undefined });
				});
			}
		}
		if (frappe.user.has_role(['Accounts Manager', 'System Manager'])) {
			dialog.add_custom_action(__('Open Account'), () => {
				dialog.hide();
				frappe.set_route('customer-manager', block.customer);
			});
		}
		dialog.show();
	}

	function open_request_approval(block) {
		const dialog = new frappe.ui.Dialog({
			title: __('Request One-time Approval'),
			fields: [
				{
					fieldtype: 'HTML',
					options: `<p class="text-muted">${__('Accounts will see this request on the Account Approvals page. Once approved, try again and the work will go ahead once.')}</p>`
				},
				{ fieldtype: 'Small Text', fieldname: 'reason', label: __('Why should this go ahead?'), reqd: 1 }
			],
			primary_action_label: __('Send Request'),
			primary_action(values) {
				frappe.call({
					method: 'crystal_alluminium_works.credit_control.request_credit_approval',
					args: {
						customer: block.customer,
						checkpoint: block.checkpoint,
						quotation: block.quotation || null,
						job_card: block.job_card || null,
						amount: block.amount || 0,
						reason: values.reason
					},
					freeze: true,
					callback: (r) => {
						dialog.hide();
						frappe.show_alert({ message: __('Approval requested ({0})', [r.message]), indicator: 'blue' }, 7);
					}
				});
			}
		});
		dialog.show();
	}

	frappe.request.error_handlers = frappe.request.error_handlers || {};
	frappe.request.error_handlers.CreditControlBlock = [
		function (r) {
			if (r && r.credit_block) {
				show_credit_block(r.credit_block);
			} else if (r && r._server_messages) {
				frappe.msgprint(JSON.parse(r._server_messages).map((m) => JSON.parse(m).message).join('<br>'));
			}
		}
	];

	window.CAWCredit = { show_block: show_credit_block, request_approval: open_request_approval };
})();
