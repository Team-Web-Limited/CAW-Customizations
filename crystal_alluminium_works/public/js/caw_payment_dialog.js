/**
 * CAW Payment Dialog — the one place a customer payment (allocated to a Job Card, or left
 * as unallocated advance/credit) actually gets recorded or refunded, extracted from the
 * Payments page so other desk pages (e.g. Quotation Manager's "Record Deposit" /
 * "Refund Deposit") can open it in place, without navigating the user away.
 *
 * Usage:
 *   CAWPaymentDialog.open({
 *     customer: 'CUST-0001',       // optional prefill
 *     quotation: 'SAL-QTN-...',    // optional — tags the payment and shows deposit-credit
 *                                  // context; also suppresses the outstanding-job-cards
 *                                  // autofill so the payment defaults to staying unallocated
 *     payment_type: 'Refund',      // optional — 'General Payment' (default) or 'Refund'
 *     onSaved: function (paymentName) {...}  // optional — called after a successful save
 *   });
 */
(function () {
	'use strict';

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

	async function open(options) {
		options = options || {};
		// A caller not passing explicit options (e.g. the Payments page's own "Create
		// Payment" button) can still hand off via frappe.route_options. Consume and clear
		// it immediately so navigating back to this page later doesn't silently reuse it.
		let route_prefill = frappe.route_options || {};
		frappe.route_options = null;
		let prefill = {
			customer: options.customer || route_prefill.customer || '',
			quotation: options.quotation || route_prefill.quotation || '',
			payment_type: options.payment_type || route_prefill.payment_type || '',
			amount: options.amount || route_prefill.amount || 0
		};
		// e.g. Quotation Manager's Record Deposit locks this to General Payment (and Refund
		// Deposit to Refund) so staff can't accidentally flip the direction of the money.
		let lock_payment_type = !!options.lockPaymentType;
		// The customer the allocations grid has already been loaded for. Seeded with the
		// prefill so the Link field's default-application onchange is recognised as "no real
		// change" — see that handler below.
		let loaded_customer = prefill.customer || '';

		let mode_of_payments = await get_payment_mode_options();

		function get_allocation_total() {
			return (d.get_value('allocations') || []).reduce((sum, row) => sum + flt(row.amount || 0), 0);
		}

		// "Deposit To" / "Payment Method" / "Save Payment" all read as money coming IN, which is
		// backwards for a refund — the same account field is the one the money is paid OUT of
		// (api.py _post_customer_payment_entry uses it as paid_from when is_refund). Retitle
		// them for the direction in play; re-run whenever Payment Type changes, since on the
		// Payments page it stays switchable.
		function refresh_payment_direction_labels() {
			let is_refund = (d.get_value('payment_type') || prefill.payment_type) === 'Refund';
			let is_deposit_context = !!prefill.quotation;

			d.set_df_property('payment_method', 'label', is_refund ? __('Refund Method') : __('Payment Method'));
			d.set_df_property('deposit_to', 'label', is_refund ? __('Paid From') : __('Deposit To'));
			d.set_df_property('deposit_to', 'description', is_refund
				? __('Auto-derived from the refund method — the cash/bank account the refund is paid out of.')
				: __('Auto-derived from the selected payment method.'));

			let save_label = options.saveLabel;
			if (!save_label) {
				if (is_deposit_context) {
					save_label = is_refund ? __('Refund Deposit') : __('Record Deposit');
				} else {
					save_label = is_refund ? __('Record Refund') : __('Save Payment');
				}
			}
			let $primary = d.get_primary_btn ? d.get_primary_btn() : d.$wrapper.find('.modal-footer .btn-primary');
			if ($primary && $primary.length) {
				$primary.text(save_label);
			}

			if (!options.title) {
				if (is_deposit_context) {
					d.set_title(is_refund ? __('Refund Deposit') : __('Record Deposit'));
				} else {
					d.set_title(is_refund ? __('Create Refund') : __('Create Payment'));
				}
			}
		}

		// Live "how much is left" indicator above the allocations grid, recomputed as the user
		// types the amount or edits allocation rows.
		function update_allocation_balance() {
			if (!d || !d.fields_dict.allocation_balance) {
				return;
			}
			let amount = flt(d.get_value('amount') || 0);
			let remaining = amount - get_allocation_total();
			// Allocation rows default to each job card's full outstanding balance and are never
			// auto-shrunk when the top Amount is edited down — that's a deliberate partial-payment
			// path (e.g. paying 10,000 toward a 14,999.96 balance), not an error state, so this
			// reads as "here's what's still owed on the job card(s)" rather than "over-allocated".
			let short = remaining < -0.0001;
			let exact = amount > 0 && Math.abs(remaining) < 0.0001;
			let color = short ? '#c0392b' : (exact ? '#28a745' : 'var(--text-muted)');
			let label = short ? __('Balance remaining') : __('Unallocated balance');
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

		// Clear prior allocation rows, then (unless skip_autofill — used when this dialog was
		// opened specifically to record/refund a quotation deposit, which should default to
		// staying unallocated credit rather than being pre-spread across unrelated job cards)
		// auto-populate all of the customer's other outstanding job cards as allocation rows.
		// preserve_amount keeps whatever Amount is already showing — used for the initial
		// post-show "kick" (see below) so a caller-supplied prefill amount survives it; a
		// genuine customer switch via the field's own onchange always resets it, since a
		// previously-entered amount is unlikely to still be right for a different customer.
		function load_customer_allocations(customer, skip_autofill, preserve_amount) {
			let grid = d.fields_dict.allocations && d.fields_dict.allocations.grid;
			if (grid) {
				grid.df.data = [];
				grid.refresh();
			}
			if (!preserve_amount) {
				d.set_value('amount', 0);
			}
			update_allocation_balance();

			if (!customer || skip_autofill) return;

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

		let d = new frappe.ui.Dialog({
			// Both of these get retitled for the money's direction right after show() —
			// see refresh_payment_direction_labels — unless the caller pinned them.
			title: options.title || __('Create Payment'),
			fields: [
				{
					fieldtype: 'Select',
					fieldname: 'payment_type',
					label: 'Payment Type',
					options: 'General Payment\nRefund',
					default: prefill.payment_type === 'Refund' ? 'Refund' : 'General Payment',
					reqd: 1,
					read_only: lock_payment_type ? 1 : 0,
					description: lock_payment_type ? __('Fixed to {0} for this action.', [prefill.payment_type || 'General Payment']) : '',
					onchange: function() {
						// Money-in and money-out don't read the same — retitle the account fields
						// and the save button to match the direction currently selected.
						refresh_payment_direction_labels();
					}
				},
				{ fieldtype: 'Column Break' },
				{
					fieldtype: 'Link',
					fieldname: 'customer',
					label: 'Customer',
					options: 'Customer',
					default: prefill.customer || '',
					reqd: 1,
					get_query: function() {
						return {
							query: 'crystal_alluminium_works.api.get_customer_names'
						};
					},
					onchange: function() {
						// Frappe fires this while applying the field's `default` too, not just on a
						// real user pick — and that early firing would wipe a caller-supplied Amount
						// prefill and re-autofill allocations we deliberately skipped. Compare against
						// the customer already loaded for so only a genuine switch does the reset.
						let current = d.get_value('customer') || '';
						if (current === loaded_customer) {
							return;
						}
						loaded_customer = current;
						load_customer_allocations(current, false);
					}
				},
				{ fieldtype: 'Column Break' },
				{
					fieldtype: 'Currency',
					fieldname: 'amount',
					label: 'Amount',
					default: prefill.amount || 0,
					reqd: 1,
					onchange: function() {
						update_allocation_balance();
					}
				},
				{
					fieldtype: 'Link',
					fieldname: 'quotation',
					label: 'Quotation',
					options: 'Quotation',
					default: prefill.quotation || '',
					hidden: prefill.quotation ? 0 : 1,
					read_only: 1,
					description: 'This payment is a deposit/refund against this Quotation — no Job Card exists for it yet.'
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
						// The account follows the method — derive it from Mode of Payment Account.
						// It's where the money lands for a receipt and where it's drawn from for a
						// refund (api.py _post_customer_payment_entry maps it to paid_to/paid_from).
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
			primary_action_label: options.saveLabel || __('Save Payment'),
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
					frappe.msgprint(__('The Job Card Allocations add up to more than the Amount being paid. Lower an allocation row or raise the Amount before saving.'));
					return;
				}

				// When the caller locked the direction of the money, send that value rather than
				// reading it back off a read-only control — an empty read-back would fall through
				// to the backend's "General Payment" default and post a refund as a receipt.
				let effective_payment_type = lock_payment_type
					? (prefill.payment_type || 'General Payment')
					: (values.payment_type || 'General Payment');

				let save_payment = function() {
					frappe.call({
						method: 'crystal_alluminium_works.api.record_customer_payment',
						args: {
							customer: values.customer,
							payment_type: effective_payment_type,
							amount: values.amount,
							date: values.date,
							payment_method: values.payment_method,
							reference: values.reference,
							deposit_to: values.deposit_to,
							allocations: JSON.stringify(allocations),
							quotation: values.quotation || null
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
								if (options.onSaved) {
									options.onSaved(r.message);
								}
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
		refresh_payment_direction_labels();

		// Dialog `default` values don't fire onchange handlers, so a prefilled customer needs an
		// explicit kick — skip the outstanding-job-cards autofill when this is specifically a
		// quotation deposit/refund, and preserve whatever Amount default the caller supplied
		// (see load_customer_allocations above).
		if (prefill.customer) {
			load_customer_allocations(prefill.customer, !!prefill.quotation, true);
		}

		// Show the customer's available credit against this quotation as context when this
		// dialog was opened to record/refund an unconfirmed deposit.
		if (prefill.quotation && d.fields_dict.allocation_balance) {
			frappe.call({
				method: 'crystal_alluminium_works.api.get_quotation_deposit_credit',
				args: { quotation: prefill.quotation },
				callback: function(r) {
					let credit = flt((r.message || {}).credit || 0);
					d.fields_dict.allocation_balance.$wrapper.html(
						`<div style="padding:4px 0 8px; color:var(--text-muted); font-size:13px;">Deposit credit currently held against this Quotation: <b>${format_currency(credit, 'KES')}</b></div>`
					);
				}
			});
		}

		return d;
	}

	window.CAWPaymentDialog = { open: open };
})();
