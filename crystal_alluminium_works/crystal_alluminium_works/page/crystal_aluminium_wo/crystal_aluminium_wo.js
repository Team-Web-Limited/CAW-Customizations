frappe.pages['crystal-aluminium-wo'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Crystal Aluminium Works',
		single_column: true
	});

	// Inject the dashboard HTML
	$(page.body).html(get_dashboard_html());

	// Bind click handlers
	$(page.body).find('.caw-action-card').on('click', function() {
		let route = $(this).data('route');
		if (route === 'ManageItems') {
			frappe.set_route('manage-items');
		} else if (route === 'PriceList') {
			open_price_list_modal();
		} else if (route) {
			frappe.set_route(...route.split('/'));
		}
	});

	// Load recent quotations
	load_recent_quotations(page);
};

function load_recent_quotations(page) {
	frappe.call({
		method: 'frappe.client.get_list',
		args: {
			doctype: 'Quotation',
			fields: ['name', 'party_name', 'grand_total', 'status', 'creation'],
			order_by: 'creation desc',
			limit_page_length: 5,
			filters: { docstatus: ['<', 2] }
		},
		callback: function(r) {
			if (r.message && r.message.length) {
				let rows = r.message.map(function(q) {
					let status_color = {
						'Draft': '#f39c12',
						'Open': '#3498db',
						'Ordered': '#2ecc71',
						'Lost': '#e74c3c',
						'Cancelled': '#95a5a6',
						'Expired': '#95a5a6'
					}[q.status] || '#7f8c8d';

					return `<tr class="caw-recent-row" data-name="${q.name}" style="cursor:pointer;">
						<td style="padding: 12px 16px; font-weight: 500; color: var(--primary);">${q.name}</td>
						<td style="padding: 12px 16px;">${q.party_name || '—'}</td>
						<td style="padding: 12px 16px; text-align: right; font-weight: 600;">
							${format_currency(q.grand_total || 0, 'KES')}
						</td>
						<td style="padding: 12px 16px; text-align: center;">
							<span style="
								background: ${status_color}20;
								color: ${status_color};
								padding: 4px 12px;
								border-radius: 12px;
								font-size: 12px;
								font-weight: 600;
							">${q.status}</span>
						</td>
						<td style="padding: 12px 16px; color: var(--text-muted); font-size: 13px;">
							${frappe.datetime.prettyDate(q.creation)}
						</td>
					</tr>`;
				}).join('');

				$(page.body).find('.caw-recent-body').html(rows);

				// Click to open quotation
				$(page.body).find('.caw-recent-row').on('click', function() {
					frappe.set_route('quotation-manager', $(this).data('name'));
				});
			} else {
				$(page.body).find('.caw-recent-body').html(
					'<tr><td colspan="5" style="padding: 24px; text-align: center; color: var(--text-muted);">No quotations yet. Create your first one!</td></tr>'
				);
			}
		}
	});
}

function get_dashboard_html() {
	return `
		<style>
			.caw-dashboard {
				max-width: 1440px;
				margin: 0 auto;
				padding: 24px 20px 32px;
				font-family: var(--font-stack);
			}

		.caw-hero {
			text-align: center;
			margin-bottom: 40px;
		}

		.caw-hero-logo {
			width: min(280px, 72vw);
			max-height: 120px;
			object-fit: contain;
			display: block;
			margin: 0 auto 18px;
		}

		.caw-hero h2 {
			font-size: 28px;
			font-weight: 700;
			color: var(--heading-color);
			margin-bottom: 8px;
		}

		.caw-hero p {
			font-size: 15px;
			color: var(--text-muted);
			margin: 0;
		}

			.caw-cards-grid {
				display: grid;
				grid-template-columns: repeat(3, minmax(0, 1fr));
				gap: 18px;
				margin-bottom: 48px;
				align-items: stretch;
			}

			.caw-action-card {
				background: var(--card-bg);
				border: 1px solid var(--border-color);
				border-radius: 12px;
				min-height: 148px;
				padding: 24px 18px;
				text-align: center;
				cursor: pointer;
				transition: all 0.2s ease;
				position: relative;
				overflow: hidden;
				display: flex;
				flex-direction: column;
				align-items: center;
				justify-content: center;
			}

		.caw-action-card:hover {
			border-color: var(--primary);
			box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
			transform: translateY(-2px);
		}

		.caw-action-card .caw-icon {
			font-size: 36px;
			margin-bottom: 14px;
			display: block;
		}

		.caw-action-card .caw-card-title {
			font-size: 16px;
			font-weight: 600;
			color: var(--heading-color);
			margin-bottom: 6px;
		}

		.caw-action-card .caw-card-desc {
			font-size: 13px;
			color: var(--text-muted);
			line-height: 1.4;
		}

		.caw-action-card.caw-primary {
			background: var(--primary);
			border-color: var(--primary);
		}

		.caw-action-card.caw-primary .caw-card-title,
		.caw-action-card.caw-primary .caw-card-desc {
			color: #fff;
		}

		.caw-action-card.caw-primary:hover {
			box-shadow: 0 6px 20px rgba(44, 102, 246, 0.3);
		}

		.caw-section-title {
			font-size: 18px;
			font-weight: 600;
			color: var(--heading-color);
			margin-bottom: 16px;
		}

		.caw-recent-table {
			width: 100%;
			border-collapse: collapse;
			background: var(--card-bg);
			border: 1px solid var(--border-color);
			border-radius: 12px;
			overflow: hidden;
		}

		.caw-recent-table thead th {
			padding: 12px 16px;
			font-size: 12px;
			font-weight: 600;
			color: var(--text-muted);
			text-transform: uppercase;
			letter-spacing: 0.5px;
			border-bottom: 1px solid var(--border-color);
			background: var(--subtle-fg);
		}

		.caw-recent-table tbody tr:hover {
			background: var(--subtle-fg);
		}

			.caw-recent-table tbody tr:not(:last-child) td {
				border-bottom: 1px solid var(--border-color);
			}

			/* Seven cards share one row: tighter gap and a compact card so the titles still fit. */
			@media (min-width: 1100px) {
				.caw-cards-grid {
					grid-template-columns: repeat(7, minmax(0, 1fr));
					gap: 12px;
				}

				.caw-action-card {
					min-height: 104px;
					padding: 14px 8px;
				}

				.caw-action-card .caw-icon {
					font-size: 26px;
					margin-bottom: 8px;
				}

				.caw-action-card .caw-card-title {
					font-size: 14px;
					margin-bottom: 0;
				}
			}

			@media (max-width: 900px) {
				.caw-dashboard {
					padding-left: 16px;
					padding-right: 16px;
				}

				.caw-cards-grid {
					grid-template-columns: repeat(2, minmax(0, 1fr));
				}
			}

			@media (max-width: 640px) {
				.caw-cards-grid {
					grid-template-columns: 1fr;
				}

				.caw-action-card {
					min-height: 132px;
					padding: 20px 16px;
				}
			}
		</style>

	<div class="caw-dashboard">
		<div class="caw-hero">
			<img
				class="caw-hero-logo"
				src="/assets/crystal_alluminium_works/images/crystal-alluminium-works-logo.png"
				alt="Crystal Aluminium Works logo"
			/>
			<h2>👋 Welcome back</h2>
			<p>What would you like to do today?</p>
		</div>

		<div class="caw-cards-grid">
			<div class="caw-action-card caw-primary" data-route="quotation-builder">
				<span class="caw-icon">📄</span>
				<div class="caw-card-title">New Quotation</div>
			</div>

			<div class="caw-action-card" data-route="ManageItems">
				<span class="caw-icon">📦</span>
				<div class="caw-card-title">Manage Items</div>
			</div>

			<div class="caw-action-card" data-route="PriceList">
				<span class="caw-icon">🏷️</span>
				<div class="caw-card-title">Price List</div>
			</div>

			<div class="caw-action-card" data-route="quotations">
				<span class="caw-icon">📋</span>
				<div class="caw-card-title">All Quotations</div>
			</div>

			<div class="caw-action-card" data-route="sales-invoices">
				<span class="caw-icon">🧾</span>
				<div class="caw-card-title">Invoices</div>
			</div>

			<div class="caw-action-card" data-route="job-cards">
				<span class="caw-icon">🗂️</span>
				<div class="caw-card-title">Job Cards</div>
			</div>

			<div class="caw-action-card" data-route="cash-sales">
				<span class="caw-icon">💵</span>
				<div class="caw-card-title">Cash Sales</div>
			</div>
		</div>

		<div class="caw-section-title">Recent Quotations</div>
		<table class="caw-recent-table">
			<thead>
				<tr>
					<th>Quotation</th>
					<th>Customer</th>
					<th style="text-align: right;">Total</th>
					<th style="text-align: center;">Status</th>
					<th>Created</th>
				</tr>
			</thead>
			<tbody class="caw-recent-body">
				<tr>
					<td colspan="5" style="padding: 24px; text-align: center; color: var(--text-muted);">
						Loading...
					</td>
				</tr>
			</tbody>
		</table>
	</div>
	`;
}

// ---- Price List (read-only) -------------------------------------------------
// Lets the sales team look prices up without Manage Items, which also edits and
// deletes. Data comes from api.get_price_list, which is role-checked server side.
const PL_TABS = [
	'Aluminium', 'Ordinary Glass', 'Laminated Glass', 'Ready Laminated Glass',
	'Toughened Glass', 'Fittings', 'Ceiling', 'Rubber', 'Silicone', 'Services'
];

function open_price_list_modal() {
	const dialog = new frappe.ui.Dialog({
		title: __('Price List'),
		size: 'extra-large',
		fields: [{ fieldtype: 'HTML', fieldname: 'body' }]
	});
	const $root = $(dialog.fields_dict.body.wrapper);
	const cache = {};
	let category = PL_TABS[0];
	let token = 0;

	$root.html(`
		<style>
			.pl-tabs { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px; }
			.pl-tab { border:1px solid var(--border-color); background:var(--control-bg);
				color:var(--text-color); border-radius:16px; padding:4px 14px; font-size:13px; cursor:pointer; }
			.pl-tab.active { background:var(--primary); border-color:var(--primary); color:#fff; }
			.pl-scroll { max-height:55vh; overflow:auto; border:1px solid var(--border-color); border-radius:8px; }
			.pl-table { width:100%; border-collapse:collapse; font-size:13px; }
			.pl-table th { position:sticky; top:0; background:var(--subtle-fg); text-align:left; padding:10px 12px;
				font-size:11px; text-transform:uppercase; letter-spacing:.4px; color:var(--text-muted);
				border-bottom:1px solid var(--border-color); }
			.pl-table td { padding:9px 12px; border-bottom:1px solid var(--border-color); }
			.pl-num { text-align:right !important; white-space:nowrap; }
			.pl-empty { text-align:center; padding:24px; color:var(--text-muted); }
		</style>
		<div class="pl-tabs">${PL_TABS.map((c, i) =>
			`<button type="button" class="pl-tab${i ? '' : ' active'}" data-category="${c}">${__(c)}</button>`).join('')}</div>
		<input type="text" class="form-control pl-search" placeholder="${__('Search name or code')}" style="margin-bottom:12px;">
		<div class="pl-scroll"><table class="pl-table"><thead class="pl-head"></thead><tbody class="pl-body"></tbody></table></div>
		<div class="pl-note text-muted" style="margin-top:10px;font-size:12px;"></div>
	`);

	function render() {
		const rows = cache[category];
		const is_alu = category === 'Aluminium';
		const is_services = category === 'Services';
		const q = ($root.find('.pl-search').val() || '').trim().toLowerCase();
		const esc = frappe.utils.escape_html;
		const money = v => format_currency(v || 0, 'KES');

		// Services have one VAT-inclusive rate per type (holes, notches, polishing, sandblasting),
		// not retail/wholesale/special, so they get their own columns.
		const heads = is_services
			? [[__('Service'), ''], [__('Item Code'), ''], [__('Charged Per'), ''], [__('Rate (VAT incl.)'), 'pl-num']]
			: [[__('Item'), ''], [__('Product Code'), ''], [__('Item Code'), ''], [__('UOM'), ''], [__('Retail'), 'pl-num']]
				.concat(is_alu ? [[__('Rate/Kg'), 'pl-num']] : [[__('Wholesale'), 'pl-num'], [__('Special'), 'pl-num']]);
		$root.find('.pl-head').html('<tr>' + heads.map(h => `<th class="${h[1]}">${h[0]}</th>`).join('') + '</tr>');
		$root.find('.pl-note').text(is_services
			? __('Rates are set in Manage Items. Sandblasting Half is charged on half the glass area. A58 (Miscellaneous) has no fixed rate; it is priced per job.')
			: '');

		const $body = $root.find('.pl-body');
		if (!rows) {
			$body.html(`<tr><td class="pl-empty" colspan="${heads.length}">${__('Loading items...')}</td></tr>`);
			return;
		}
		const shown = rows
			.filter(r => !q || [r.item_name, r.item_code, r.product_code].some(v => (v || '').toLowerCase().includes(q)));
		if (!is_services) {
			shown.sort((a, b) => (a.item_code || '').localeCompare(b.item_code || '', undefined, { numeric: true, sensitivity: 'base' }));
		}
		if (!shown.length) {
			$body.html(`<tr><td class="pl-empty" colspan="${heads.length}">${__('No items found.')}</td></tr>`);
			return;
		}

		if (is_services) {
			$body.html(shown.map(r => `<tr>
				<td style="font-weight:500;">${esc(r.item_name || '')}</td>
				<td>${esc(r.item_code || '')}</td><td>${esc(r.uom || '')}</td>
				<td class="pl-num">${r.retail ? money(r.retail) : `<span class="text-muted">${__('Not set')}</span>`}</td>
			</tr>`).join(''));
			return;
		}
		$body.html(shown.map(r => `<tr>
			<td style="font-weight:500;">${esc(r.item_name || r.item_code || '')}</td>
			<td>${esc(r.product_code)}</td><td>${esc(r.item_code || '')}</td><td>${esc(r.uom || '')}</td>
			<td class="pl-num">${money(r.retail)}</td>
			${is_alu ? `<td class="pl-num">${money(r.rate_per_kg)}</td>`
				: `<td class="pl-num">${money(r.wholesale)}</td><td class="pl-num">${money(r.special)}</td>`}
		</tr>`).join(''));
	}

	function load() {
		const requested = category;
		render();
		if (cache[requested]) return;
		const my_token = ++token;
		frappe.call({
			method: 'crystal_alluminium_works.api.get_price_list',
			args: { category: requested },
			callback(r) {
				cache[requested] = r.message || [];
				// A slower earlier tab must not overwrite the one now showing.
				if (my_token === token && category === requested) render();
			}
		});
	}

	$root.on('click', '.pl-tab', function () {
		$root.find('.pl-tab').removeClass('active');
		$(this).addClass('active');
		category = $(this).data('category');
		load();
	});
	$root.on('input', '.pl-search', render);

	dialog.show();
	load();
}
