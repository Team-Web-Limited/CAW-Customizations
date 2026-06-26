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

			@media (min-width: 1380px) {
				.caw-cards-grid {
					grid-template-columns: repeat(6, minmax(0, 1fr));
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

			<div class="caw-action-card" data-route="quotations">
				<span class="caw-icon">📋</span>
				<div class="caw-card-title">All Quotations</div>
			</div>

			<div class="caw-action-card" data-route="sales-invoices">
				<span class="caw-icon">🧾</span>
				<div class="caw-card-title">Sales Invoices</div>
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
