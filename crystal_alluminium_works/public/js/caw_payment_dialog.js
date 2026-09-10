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
 *     quotationTotal: 45000,       // optional — quotation's own grand total, so the deposit-
 *                                  // credit note can call out any excess held above it
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

	// Reference is only ever a real paper/audit trail for these two methods — Mpesa (Paybill),
	// PESALINK, Cash etc. don't need one. Kept in sync with the same list server-side
	// (api.py record_customer_payment) so the dialog's required-ness never lies about
	// what will actually save.
	const REFERENCE_REQUIRED_PAYMENT_METHODS = ['Bank Transfer i.e RTGS, TT', 'Cheque'];

	function is_reference_required_method(payment_method) {
		return REFERENCE_REQUIRED_PAYMENT_METHODS.indexOf(payment_method) !== -1;
	}

	// Marks a Customer search row that matched a walk-in's name rather than a Customer record
	// of its own. Kept in sync with api.py get_customer_names, which emits it.
	const WALKIN_DESCRIPTION_PREFIX = 'Walk-in: ';

	// Frappe labels every link suggestion with its own value (Customer has no
	// show_title_field_in_link), so a walk-in match would read "Cash Customer" with the real
	// name buried in the grey subtext below it. Relabel those rows with the walk-in's own name
	// and phone number (as api.get_customer_names formats them, "Name (07…)") and drop the
	// subtext, so staff read exactly what they searched for — the number included, since
	// walk-in names repeat and it's the only thing that tells two of them apart. Only the
	// display changes — the value written to the field stays the shared Cash Customer record,
	// which is the only real Customer a walk-in has.
	function show_walkin_names_in_customer_search(customer_control) {
		if (!customer_control || typeof customer_control.merge_duplicates !== 'function') {
			return;
		}
		let merge_duplicates = customer_control.merge_duplicates.bind(customer_control);
		customer_control.merge_duplicates = function(results) {
			return (merge_duplicates(results) || []).map(function(row) {
				let description = (row && row.description) || '';
				if (description.indexOf(WALKIN_DESCRIPTION_PREFIX) !== 0) {
					return row;
				}
				let names = description.slice(WALKIN_DESCRIPTION_PREFIX.length).trim();
				return names ? Object.assign({}, row, { label: names, description: '' }) : row;
			});
		};
	}

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
			amount: options.amount || route_prefill.amount || 0,
			// Optional — lets the deposit-credit note below call out how much of the credit
			// held against this quotation is actually excess over its own total, instead of
			// just showing one undifferentiated number.
			quotationTotal: options.quotationTotal || route_prefill.quotationTotal || 0
		};
		// e.g. Quotation Manager's Record Deposit locks this to General Payment (and Refund
		// Deposit to Refund) so staff can't accidentally flip the direction of the money.
		let lock_payment_type = !!options.lockPaymentType;
		// The customer the allocations grid has already been loaded for. Seeded with the
		// prefill so the Link field's default-application onchange is recognised as "no real
		// change" — see that handler below.
		let loaded_customer = prefill.customer || '';
		// The walk-in the dialog has already loaded for — same guard as loaded_customer, since
		// setting the field programmatically fires its onchange too.
		let loaded_walkin = '';

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

		// How much of the customer's existing advance/credit (fetched by
		// refresh_customer_credit_note, cached on d._customer_advance) the current allocation
		// rows would actually draw on — api.py record_customer_payment applies exactly this,
		// oldest-Payment-first, before any new money is collected (see _apply_customer_advance).
		// Capped at the allocation total: advance never funds more than what's being allocated.
		function get_advance_applied() {
			let advance = flt((d && d._customer_advance) || 0);
			return Math.min(advance, get_allocation_total());
		}

		// The money summary above the allocations grid — the advance already on file and what's
		// still unallocated — rendered as one row closed off by a rule, so it reads as its own
		// section rather than two loose lines. Recomputed as the user types the amount or edits
		// allocation rows. Existing advance counts as funds already in hand, so it factors into
		// `remaining` exactly like the top Amount does, and a payment fully covered by advance
		// still reads as "Unallocated balance: 0.00" rather than a false shortfall.
		function update_allocation_balance() {
			if (!d || !d.fields_dict.allocation_balance) {
				return;
			}
			let amount = flt(d.get_value('amount') || 0);
			let funded = amount + get_advance_applied();
			let remaining = funded - get_allocation_total();
			// Allocation rows default to each job card's full outstanding balance and are never
			// auto-shrunk when the top Amount is edited down — that's a deliberate partial-payment
			// path (e.g. paying 10,000 toward a 14,999.96 balance), not an error state, so this
			// reads as "here's what's still owed on the job card(s)" rather than "over-allocated".
			let short = remaining < -0.0001;
			let exact = funded > 0 && Math.abs(remaining) < 0.0001;
			let balance_color = short ? '#c0392b' : (exact ? '#28a745' : 'var(--text-muted)');
			let balance_label = short ? __('Balance remaining') : __('Unallocated balance');

			let advance = flt(d._customer_advance || 0);
			let applied = get_advance_applied();
			let advance_html = '';
			if (advance > 0.0001) {
				advance_html = `<div style="font-weight:600; color:#a35b00;">${__('Customer advance')}: ${format_currency(advance, 'KES')}`;
				if (applied > 0.0001) {
					advance_html += ` <span style="font-weight:400;">(${__('{0} will be applied', [format_currency(applied, 'KES')])})</span>`;
				}
				advance_html += '</div>';
			}

			d.fields_dict.allocation_balance.$wrapper.html(`
				<div style="display:flex; gap:28px; align-items:baseline; flex-wrap:wrap;
							padding:4px 0 10px; margin-bottom:12px;
							border-bottom:1px solid var(--border-color);">
					${advance_html}
					<div style="font-weight:600; color:${balance_color};">${balance_label}: ${format_currency(Math.abs(remaining), 'KES')}</div>
				</div>
			`);
		}

		// When a job card row is selected/edited, drive the top-level amount to equal the sum
		// of all allocation row amounts, minus whatever existing advance will cover (see
		// get_advance_applied) — so Amount always shows just the new money actually needed,
		// live, before Save Payment applies the same math for real.
		function update_amount_from_allocations() {
			if (!d || !d.fields_dict.amount) return;
			let total = get_allocation_total();
			if (total > 0.0001) {
				d.set_value('amount', Math.max(total - get_advance_applied(), 0));
			}
		}

		// Surface any advance/credit this customer already has sitting unallocated (from an
		// earlier General Payment never pinned to a job card) so staff see it *before* they
		// record a new payment — otherwise it's easy to collect the same money twice, or miss
		// that a "no payment history" job card is actually already funded. Save Payment then
		// draws on this automatically for whatever's in the allocations table (see api.py
		// get_customer_unallocated_credit / _apply_customer_advance).
		function refresh_customer_credit_note(customer) {
			d._customer_advance = 0;
			if (!customer) {
				update_allocation_balance();
				return;
			}
			frappe.call({
				method: 'crystal_alluminium_works.api.get_customer_unallocated_credit',
				args: { customer: customer },
				callback: function(r) {
					d._customer_advance = flt((r.message || {}).credit || 0);
					// The advance now on hand may change what Amount and the balance indicator
					// should read for whatever allocation rows are already loaded.
					update_amount_from_allocations();
					update_allocation_balance();
				}
			});
		}

		// The walk-in currently in scope. Every cash sale links to the one shared Cash Customer
		// record, so this — not the Customer field — is what actually identifies the person, and
		// what every lookup below is narrowed by.
		//
		// Held here rather than read back off the field: Dialog.set_value is async (it resolves
		// a promise after the control applies the value), so a lookup fired right after setting
		// it would still read the *previous* walk-in and load the wrong person's job cards.
		let current_walkin = '';

		// name -> phone number(s) on record for that walk-in, from get_customer_walkin_names.
		// Names repeat among walk-ins, so the number is what actually tells two of them apart —
		// it's shown in the picker's own rows and in the read-only Phone field beside it. It
		// stays display-only: every lookup still filters by custom_customer_name, which is the
		// only walk-in key the quotations and job cards carry.
		let walkin_phones = {};

		function get_walkin_name() {
			return current_walkin;
		}

		function get_walkin_phone(name) {
			return walkin_phones[(name || '').trim()] || '';
		}

		// Awesomplete row for one walk-in: just the name, with the phone as the row's grey
		// subtext — which is also what Awesomplete filters typed text against, so the picker
		// stays searchable by number without the number crowding the field's own value.
		function walkin_option(name, phone) {
			return {
				value: name,
				label: name,
				description: phone || ''
			};
		}

		function refresh_walkin_phone_field() {
			if (!d || !d.fields_dict.walkin_phone) {
				return;
			}
			let phone = get_walkin_phone(current_walkin);
			// Only worth the row when there's a walk-in in scope and a number on file for them.
			d.set_df_property('walkin_phone', 'hidden', phone ? 0 : 1);
			d.set_value('walkin_phone', phone);
		}

		function set_walkin_name(name) {
			current_walkin = (name || '').trim();
			// Keep the guard in step, so the field's own onchange treats this programmatic
			// write as "already handled" and doesn't reload a second time.
			loaded_walkin = current_walkin;
			if (d && d.fields_dict.walkin_name) {
				d.set_value('walkin_name', current_walkin);
			}
			refresh_walkin_phone_field();
		}

		// Offer the Walk-in field only for a customer that actually has walk-ins on record —
		// which is only ever the shared Cash Customer. An ordinary invoice customer identifies
		// itself, so the field stays hidden and every lookup runs customer-wide as before.
		// Calls `done` once the walk-in is settled, so callers don't load an unscoped list first.
		function refresh_walkin_field(customer, done) {
			done = done || function() {};
			if (!d || !d.fields_dict.walkin_name) {
				done();
				return;
			}
			if (!customer) {
				walkin_phones = {};
				d.set_df_property('walkin_name', 'hidden', 1);
				set_walkin_name('');
				done();
				return;
			}
			frappe.call({
				method: 'crystal_alluminium_works.api.get_customer_walkin_names',
				args: { customer: customer },
				callback: function(r) {
					// One row per walk-in name, each carrying whatever phone number(s) that name
					// has been seen with (see api.get_customer_walkin_names).
					let walkins = (r.message || []).map(function(row) {
						return typeof row === 'string' ? { name: row, phone: '' } : (row || {});
					}).filter(function(row) { return row.name; });
					let names = walkins.map(function(row) { return row.name; });
					walkin_phones = {};
					walkins.forEach(function(row) { walkin_phones[row.name] = row.phone || ''; });

					let options = walkins.map(function(row) { return walkin_option(row.name, row.phone); });
					d.set_df_property('walkin_name', 'hidden', names.length ? 0 : 1);
					d.fields_dict.walkin_name.df.options = options;
					if (d.fields_dict.walkin_name.set_data) {
						d.fields_dict.walkin_name.set_data(options);
					}
					// What was typed into Customer is what the user meant — adopt it when it
					// identifies exactly one walk-in, so the scoping below matches what they
					// picked. Matched against the phone number too, since that's the half of the
					// search row staff use when the name alone is ambiguous.
					let typed = (d._customer_typed_text || '').trim().toLowerCase();
					let hits = typed.length >= 2
						? walkins.filter(function(row) {
							return (row.name || '').toLowerCase().indexOf(typed) !== -1
								|| (row.phone || '').toLowerCase().indexOf(typed) !== -1;
						}).map(function(row) { return row.name; })
						: [];
					set_walkin_name(hits.length === 1 ? hits[0] : '');
					done();
				}
			});
		}

		// Tag the payment to the walk-in's own quotation, so money taken before a Job Card
		// exists still lands against the right job once one is created (see api.py
		// get_quotation_deposit_credit). Nothing else can carry that link: the Customer field
		// is the shared record, and there's no Job Card to allocate against yet.
		function resolve_walkin_quotation(customer) {
			if (!d || !d.fields_dict.quotation || prefill.quotation) {
				return;  // caller pinned the quotation — don't second-guess it
			}
			let walkin = get_walkin_name();
			if (!customer || !walkin) {
				return;
			}
			frappe.call({
				method: 'crystal_alluminium_works.api.search_customer_quotations',
				args: {
					doctype: 'Quotation', txt: '', searchfield: 'name', start: 0, page_len: 5,
					filters: { customer: customer, customer_name: walkin }
				},
				callback: function(r) {
					let matches = r.message || [];
					// Only auto-tag on an unambiguous hit — a walk-in with several quotations is
					// exactly when guessing would attach the money to the wrong one.
					if (matches.length !== 1) {
						return;
					}
					// Filled in silently — the Quotation field itself shows what was picked.
					d.set_value('quotation', matches[0][0]);
				}
			});
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
			refresh_customer_credit_note(customer);
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

			let walkin = get_walkin_name();
			frappe.call({
				method: 'crystal_alluminium_works.api.get_customer_outstanding_job_cards',
				// Scoped to the walk-in in play, or every walk-in billed to the shared Cash
				// Customer record would show up here regardless of which one was picked.
				args: { customer: customer, customer_name: walkin || undefined },
				callback: function(r) {
					let rows = r.message || [];
					let grid = d.fields_dict.allocations && d.fields_dict.allocations.grid;
					if (!grid) return;

					if (rows.length === 0) {
						// Nothing outstanding — the empty grid says that on its own, and the
						// summary row above must keep showing the advance / unallocated figures.
						return;
					}

					// Populate grid with one row per outstanding job card
					grid.df.data = rows.map(function(item) {
						return {
							job_card: item.job_card,
							// The job card's own customer_name — for a Cash Customer job card this
							// is the actual walk-in's name, not the shared "Cash Customer"
							// placeholder every such job card's Customer field is the same for.
							customer_name: item.customer_name || '',
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
					onchange: function() {
						// Money-in and money-out don't read the same — retitle the account fields
						// and the save button to match the direction currently selected.
						refresh_payment_direction_labels();
					}
				},
				{
					// The number on record for the walk-in picked in Name opposite. Read-only and
					// display-only — it's how staff confirm they're looking at the right person
					// before the money moves, since walk-in names repeat and nothing else on this
					// dialog distinguishes them. Hidden when there's no number on file.
					fieldtype: 'Data',
					fieldname: 'walkin_phone',
					label: 'Phone',
					read_only: 1,
					hidden: 1
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
						// Settle which walk-in is in scope *before* loading anything, so the
						// allocations never flash an unscoped list and then narrow.
						refresh_walkin_field(current, function() {
							load_customer_allocations(current, false);
							resolve_walkin_quotation(current);
						});
					}
				},
				{
					// The Customer field can only ever hold the one shared Cash Customer record,
					// so this is where the actual person lives — it drives the job card, quotation
					// and allocation lookups below. Hidden for invoice customers, who identify
					// themselves (see refresh_walkin_field).
					fieldtype: 'Autocomplete',
					fieldname: 'walkin_name',
					label: 'Name',
					options: [],
					hidden: 1,
					onchange: function() {
						// Read the control directly here — this is the one place the field is
						// ahead of current_walkin, because the user just changed it by hand.
						let picked = (d.get_value('walkin_name') || '').trim();
						if (picked === loaded_walkin) {
							return;  // our own programmatic write (see set_walkin_name)
						}
						loaded_walkin = picked;
						current_walkin = picked;
						refresh_walkin_phone_field();
						let customer = d.get_value('customer') || '';
						d.set_value('quotation', '');
						load_customer_allocations(customer, false);
						resolve_walkin_quotation(customer);
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
					// Read-only only when the caller pinned it (Record/Refund Deposit already
					// knows which quotation it means) — otherwise searchable, so a walk-in who
					// only has a Quotation so far (no Job Card yet, e.g. a deposit taken before
					// committing to one) can still be found and tagged by name, not just a
					// customer known through an existing Job Card (see search_customer_job_cards).
					read_only: prefill.quotation ? 1 : 0,
					get_query: function() {
						return {
							query: 'crystal_alluminium_works.api.search_customer_quotations',
							filters: {
								customer: d.get_value('customer') || '',
								customer_name: get_walkin_name() || undefined
							}
						};
					}
				},
				{ fieldtype: 'Section Break' },
				{
					// Renders the advance and unallocated-balance figures as one row closed off
					// by a rule — see update_allocation_balance.
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
							columns: 4,
							get_query: function() {
								// Custom query rather than the field's default — searches the job
								// card's own customer_name too, so multiple Cash Customer walk-ins
								// sharing the one "Cash Customer" record can be found by their real
								// name, not just by job card number.
								return {
									query: 'crystal_alluminium_works.api.search_customer_job_cards',
									filters: {
										customer: d.get_value('customer') || '',
										customer_name: get_walkin_name() || undefined,
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
										// The job card's own customer_name — for a Cash Customer job
										// card this is the walk-in's real name, so a manually-added
										// row shows the same name the auto-populated rows do.
										row.customer_name = info.customer_name || '';
										if (control.grid_row) {
											control.grid_row.refresh_field('amount');
											control.grid_row.refresh_field('payment_status');
											control.grid_row.refresh_field('customer_name');
										}
										update_amount_from_allocations();
										update_allocation_balance();
									}
								});
							}
						},
						{
							fieldtype: 'Data',
							fieldname: 'customer_name',
							label: 'Name',
							in_list_view: 1,
							read_only: 1,
							columns: 3
						},
						{
							fieldtype: 'Currency',
							fieldname: 'amount',
							label: 'Amount',
							in_list_view: 1,
							reqd: 1,
							columns: 2,
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
						let payment_method = d.get_value('payment_method');

						// Reference is only mandatory for Bank Transfer / Cheque — Mpesa (Paybill)
						// and everything else can save without one.
						d.set_df_property('reference', 'reqd', is_reference_required_method(payment_method) ? 1 : 0);

						// The account follows the method — derive it from Mode of Payment Account.
						// It's where the money lands for a receipt and where it's drawn from for a
						// refund (api.py _post_customer_payment_entry maps it to paid_to/paid_from).
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
					read_only: 1
				},
				{ fieldtype: 'Column Break' },
				{
					fieldtype: 'Data',
					fieldname: 'reference',
					label: 'Reference',
					// Toggled per payment_method's onchange above — only Bank Transfer / Cheque
					// require it.
					reqd: is_reference_required_method(prefill.payment_method) ? 1 : 0
				}
			],
			primary_action_label: options.saveLabel || __('Save Payment'),
			primary_action: function(values) {
				if (!values.customer) {
					frappe.msgprint(__('Please select a customer.'));
					return;
				}

				let allocations = (values.allocations || [])
					.filter(row => row.job_card)
					.map(row => ({ job_card: row.job_card, amount: flt(row.amount || 0) }));

				// A zero Amount is only legitimate when there are Job Card Allocations for the
				// existing advance to fully cover (api.py record_customer_payment applies it
				// before any new money is needed) — everything else still needs real money.
				if (flt(values.amount || 0) <= 0 && allocations.length === 0) {
					frappe.msgprint(__('Amount must be greater than zero.'));
					return;
				}

				if (allocations.some(row => row.amount <= 0)) {
					frappe.msgprint(__('Each allocation must have an amount greater than zero.'));
					return;
				}
				let allocated_total = allocations.reduce((sum, row) => sum + flt(row.amount || 0), 0);
				// Allocations may ask for more than Amount alone covers — the shortfall is meant
				// to come from the customer's existing advance (see get_advance_applied), so the
				// cap check allows for that headroom too, same as api.py's own validation.
				let advance_headroom = (values.payment_type || 'General Payment') === 'Refund' ? 0 : flt(d._customer_advance || 0);
				if (allocated_total - (flt(values.amount || 0) + advance_headroom) > 0.0001) {
					frappe.msgprint(__('The Job Card Allocations add up to more than the Amount being paid plus this customer\'s available advance. Lower an allocation row or raise the Amount before saving.'));
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
							if (!r.message) {
								return;
							}
							// record_customer_payment returns a plain Payments name normally, but an
							// {payment, advance_applied} object when Save Payment drew on existing
							// advance (see api.py _apply_customer_advance) — payment is null there if
							// the advance covered the allocations in full and no new money was needed.
							let is_advance_result = typeof r.message === 'object';
							let payment_name = is_advance_result ? r.message.payment : r.message;
							let advance_applied = is_advance_result ? flt(r.message.advance_applied || 0) : 0;

							d.hide();
							if (!payment_name) {
								frappe.show_alert({
									message: __('Fully covered by {0} of existing advance — no new payment needed.', [format_currency(advance_applied, 'KES')]),
									indicator: 'green'
								});
							} else {
								frappe.show_alert({
									message: advance_applied > 0.0001
										? __('Payment {0} recorded — {1} applied from existing advance.', [payment_name, format_currency(advance_applied, 'KES')])
										: __('Payment {0} recorded successfully.', [payment_name]),
									indicator: 'green'
								});
							}
							if (options.onSaved) {
								options.onSaved(payment_name);
							}
						}
					});
				};

				// Soft nudge: nothing is allocated, yet this customer already owes. Don't block —
				// recording it as an advance / credit is a legitimate flow (e.g. funding a future
				// job card) — just make sure the blank wasn't accidental. Only makes sense for
				// money coming in — a Refund is always unallocated by design (e.g. Refund Deposit
				// giving back an unconfirmed quotation deposit) and "record it as advance /
				// credit?" reads backwards for money going out, so skip it there.
				if (allocations.length === 0 && effective_payment_type !== 'Refund') {
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

		// Remember what was actually typed into Customer before the link widget replaces it
		// with the picked value — for a walk-in that text is their real name, the only clue to
		// which walk-in was meant once the field reads the shared "Cash Customer" (see
		// resolve_walkin_quotation).
		d.fields_dict.customer.$input.on('input', function() {
			d._customer_typed_text = $(this).val() || '';
		});
		show_walkin_names_in_customer_search(d.fields_dict.customer);

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
		route_quotation_field_to_manager(d);

		// Dialog `default` values don't fire onchange handlers, so a prefilled customer needs an
		// explicit kick — skip the outstanding-job-cards autofill when this is specifically a
		// quotation deposit/refund, and preserve whatever Amount default the caller supplied
		// (see load_customer_allocations above).
		if (prefill.customer) {
			// Same order as the field's own onchange: settle the walk-in first so the
			// allocations load already scoped to them.
			refresh_walkin_field(prefill.customer, function() {
				load_customer_allocations(prefill.customer, !!prefill.quotation, true);
			});
		}

		// Show the customer's available credit against this quotation as context when this
		// dialog was opened to record/refund an unconfirmed deposit.
		if (prefill.quotation && d.fields_dict.allocation_balance) {
			frappe.call({
				method: 'crystal_alluminium_works.api.get_quotation_deposit_credit',
				args: { quotation: prefill.quotation },
				callback: function(r) {
					let credit = flt((r.message || {}).credit || 0);
					let quotation_total = flt(prefill.quotationTotal || 0);
					let held_html = `Deposit credit currently held against this Quotation: <b>${format_currency(credit, 'KES')}</b>`;
					// Held credit isn't capped at the quotation's own total — a customer who
					// deposited more than this quotation needs has the difference sitting here
					// as advance/credit, not lost. Call that out explicitly instead of leaving
					// staff to subtract it themselves.
					if (quotation_total > 0 && credit - quotation_total > 0.0001) {
						let excess = credit - quotation_total;
						held_html += `<br>Of that, <b>${format_currency(excess, 'KES')}</b> is over and above this Quotation's total (${format_currency(quotation_total, 'KES')}) — held as advance credit for the customer.`;
					}
					d.fields_dict.allocation_balance.$wrapper.html(
						`<div style="padding:4px 0 8px; color:var(--text-muted); font-size:13px;">${held_html}</div>`
					);
				}
			});
		}

		return d;
	}

	// Quotations are worked in the Quotation Manager page, not the raw Quotation form, so the
	// Quotation field's "open link" arrow (and the plain anchor it renders when the caller
	// pinned the quotation, making the field read-only) has to land there instead. Delegated
	// off the wrapper so it keeps working as the value changes and the control re-renders.
	function route_quotation_field_to_manager(d) {
		let field = d.fields_dict.quotation;
		if (!field || !field.$wrapper) {
			return;
		}

		function quotation_name($anchor) {
			return d.get_value('quotation') || $anchor.attr('data-name') || '';
		}

		field.$wrapper.on('click', 'a', function(e) {
			let $anchor = $(this);
			if ($anchor.hasClass('btn-clear')) {
				return;  // the clear-link button isn't navigation
			}
			let name = quotation_name($anchor);
			if (!name) {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			d.hide();
			frappe.set_route('quotation-manager', name);
		});

		// Keep the href itself pointing at the manager too, so hover previews and
		// middle-click/open-in-new-tab agree with the click handler above.
		function retarget_hrefs() {
			field.$wrapper.find('a').each(function() {
				let $anchor = $(this);
				if ($anchor.hasClass('btn-clear')) {
					return;
				}
				let name = quotation_name($anchor);
				if (name) {
					$anchor.attr('href', '/desk/quotation-manager/' + encodeURIComponent(name));
				}
			});
		}
		field.$wrapper.on('mouseenter focusin', retarget_hrefs);
		retarget_hrefs();
	}

	window.CAWPaymentDialog = { open: open };
})();
