// Sales Portfolio: each sales person's accounts — the ones they introduced (Customer
// custom_introduced_by) — with the month's sales and collections and what is outstanding and
// overdue now (sales_portfolio.py). A sales person sees only their own; Accounts and Admin see
// everyone, and an Admin can hand one person's accounts over to another.
frappe.pages['sales-portfolio'].on_page_load = function (wrapper) {
	let page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Sales Portfolio',
		single_column: true,
	});
	wrapper.sales_portfolio_page = page;
	page.sp_month = frappe.datetime.month_start();

	page.sp_month_field = page.add_field({
		fieldtype: 'Date',
		fieldname: 'month',
		label: 'Month',
		default: page.sp_month,
		change() {
			page.sp_month = page.sp_month_field.get_value() || frappe.datetime.month_start();
			load_sales_portfolio(page);
		}
	});
	page.set_secondary_action('Refresh', () => load_sales_portfolio(page));

	$(page.body).html(`
		<style>
			.sp-page { max-width: 1200px; margin: 0 auto; padding: 20px 16px; }
			.sp-table-wrap { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; box-shadow: var(--shadow-xs); overflow-x: auto; margin-bottom: 20px; }
			.sp-table { width: 100%; min-width: 820px; border-collapse: collapse; }
			.sp-table th { padding: 10px 14px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; text-align: left; background: var(--subtle-fg); border-bottom: 1px solid var(--border-color); }
			.sp-table td { padding: 10px 14px; font-size: 13px; border-bottom: 1px solid var(--border-color); }
			.sp-table td.num, .sp-table th.num { text-align: right; font-variant-numeric: tabular-nums; }
			.sp-row { cursor: pointer; }
			.sp-row:hover, .sp-row.active { background: var(--subtle-fg); }
			.sp-bad { color: var(--red-600); font-weight: 600; }
			.sp-muted { color: var(--text-muted); font-size: 12px; }
			.sp-detail h4 { margin: 0 0 10px; }
		</style>
		<div class="sp-page">
			<div class="sp-note sp-muted" style="margin-bottom:10px;"></div>
			<div class="sp-table-wrap">
				<table class="sp-table">
					<thead><tr>
						<th>Sales Person</th><th class="num">Accounts</th><th class="num">Sales This Month</th>
						<th class="num">Collected This Month</th><th class="num">Outstanding</th><th class="num">Overdue</th><th></th>
					</tr></thead>
					<tbody class="sp-body"></tbody>
				</table>
			</div>
			<div class="sp-detail"></div>
		</div>
	`);

	$(page.body).on('click', '.sp-row', function (e) {
		if ($(e.target).closest('.sp-handover').length) return;
		$(page.body).find('.sp-row').removeClass('active');
		$(this).addClass('active');
		load_sales_portfolio_accounts(page, $(this).attr('data-sales-person'));
	});
	$(page.body).on('click', '.sp-handover', function (e) {
		e.stopPropagation();
		open_sales_portfolio_handover(page, $(this).attr('data-sales-person'));
	});
	$(page.body).on('click', '[data-open-customer]', function (e) {
		e.preventDefault();
		frappe.set_route('customer-manager', $(this).attr('data-open-customer'));
	});
};

frappe.pages['sales-portfolio'].on_page_show = function (wrapper) {
	if (wrapper.sales_portfolio_page) {
		load_sales_portfolio(wrapper.sales_portfolio_page);
	}
};

function sp_text(value) {
	return frappe.utils.escape_html(value === null || value === undefined || value === '' ? '-' : String(value));
}

function sp_money(value) {
	return format_currency(value || 0);
}

function load_sales_portfolio(page) {
	let $body = $(page.body).find('.sp-body');
	$(page.body).find('.sp-detail').empty();
	$body.html('<tr><td colspan="7" class="sp-muted" style="text-align:center;padding:20px;">Loading...</td></tr>');
	frappe.call({
		method: 'crystal_alluminium_works.sales_portfolio.get_portfolio',
		args: { month: page.sp_month },
		callback: (r) => {
			let data = r.message || {};
			page.sp_data = data;
			let month_label = data.month_start ? moment(data.month_start).format('MMMM YYYY') : '';
			$(page.body).find('.sp-note').text(
				data.message || `${month_label}. Outstanding and overdue are as of today. Collected is payments received, net of refunds.`
			);
			let rows = data.rows || [];
			if (!rows.length) {
				$body.html(`<tr><td colspan="7" class="sp-muted" style="text-align:center;padding:20px;">${sp_text(data.message || 'No accounts.')}</td></tr>`);
				return;
			}
			$body.html(rows.map(row => `
				<tr class="sp-row" data-sales-person="${frappe.utils.escape_html(row.sales_person)}">
					<td><b>${sp_text(row.sales_person)}</b>${row.on_hold ? `<div class="sp-muted">${row.on_hold} on hold</div>` : ''}</td>
					<td class="num">${row.accounts}</td>
					<td class="num">${sp_money(row.sales)}</td>
					<td class="num">${sp_money(row.collected)}</td>
					<td class="num">${sp_money(row.outstanding)}</td>
					<td class="num ${row.overdue ? 'sp-bad' : ''}">${sp_money(row.overdue)}</td>
					<td style="text-align:right;">${data.is_admin ? `<button class="btn btn-xs btn-default sp-handover" data-sales-person="${frappe.utils.escape_html(row.sales_person)}">Hand Over</button>` : ''}</td>
				</tr>`).join(''));
			if (rows.length === 1) {
				$body.find('.sp-row').first().trigger('click');
			}
		}
	});
}

async function load_sales_portfolio_accounts(page, sales_person) {
	let $detail = $(page.body).find('.sp-detail');
	$detail.html('<div class="sp-muted" style="padding:12px;">Loading accounts...</div>');
	let [accounts, trend] = await Promise.all([
		frappe.call({ method: 'crystal_alluminium_works.sales_portfolio.get_portfolio_accounts', args: { sales_person, month: page.sp_month } }),
		sales_person === '(Not assigned)'
			? Promise.resolve({ message: [] })
			: frappe.call({ method: 'crystal_alluminium_works.sales_portfolio.get_monthly_trend', args: { sales_person } }),
	]);
	let account_rows = (accounts.message || []).map(a => `
		<tr>
			<td><a href="#" data-open-customer="${frappe.utils.escape_html(a.customer)}">${sp_text(a.customer_name || a.customer)}</a>
				<div class="sp-muted">${sp_text(a.term)} · ${sp_text(a.status)}</div></td>
			<td class="num">${sp_money(a.sales)}</td>
			<td class="num">${sp_money(a.collected)}</td>
			<td class="num">${sp_money(a.outstanding)}${a.limit ? `<div class="sp-muted">limit ${sp_money(a.limit)}</div>` : ''}</td>
			<td class="num ${a.overdue ? 'sp-bad' : ''}">${sp_money(a.overdue)}${a.overdue ? '<div>follow up</div>' : ''}</td>
		</tr>`).join('') || '<tr><td colspan="5" class="sp-muted" style="text-align:center;padding:16px;">No accounts.</td></tr>';
	let trend_rows = (trend.message || []).map(t => `
		<tr><td>${sp_text(moment(t.month).format('MMM YYYY'))}</td><td class="num">${sp_money(t.sales)}</td><td class="num">${sp_money(t.collected)}</td></tr>`).join('');
	$detail.html(`
		<h4>${sp_text(sales_person)} — accounts</h4>
		<div class="sp-table-wrap"><table class="sp-table">
			<thead><tr><th>Account</th><th class="num">Sales This Month</th><th class="num">Collected This Month</th><th class="num">Outstanding</th><th class="num">Overdue</th></tr></thead>
			<tbody>${account_rows}</tbody></table></div>
		${trend_rows ? `
		<h4>Last 6 months</h4>
		<div class="sp-table-wrap" style="max-width:520px;"><table class="sp-table" style="min-width:0;">
			<thead><tr><th>Month</th><th class="num">Sales</th><th class="num">Collected</th></tr></thead>
			<tbody>${trend_rows}</tbody></table></div>` : ''}`);
}

function open_sales_portfolio_handover(page, from_sales_person) {
	let dialog = new frappe.ui.Dialog({
		title: `Hand over ${from_sales_person}'s accounts`,
		fields: [
			{ fieldtype: 'HTML', options: '<p class="text-muted">Every account is moved to the new sales person. Each move is kept on the account\'s history, which shows who held it and when.</p>' },
			{
				fieldtype: 'Link',
				fieldname: 'to_sales_person',
				label: 'Hand Over To',
				options: 'Sales Person',
				reqd: 1,
				get_query: () => ({ filters: { is_group: 0, enabled: 1, name: ['!=', from_sales_person] } })
			},
			{ fieldtype: 'Small Text', fieldname: 'reason', label: 'Reason (e.g. left the company)', reqd: 1 }
		],
		primary_action_label: 'Hand Over',
		primary_action(values) {
			frappe.call({
				method: 'crystal_alluminium_works.sales_portfolio.reassign_accounts',
				args: { from_sales_person, to_sales_person: values.to_sales_person, reason: values.reason },
				freeze: true,
				callback: (r) => {
					dialog.hide();
					frappe.show_alert({ message: `${r.message || 0} account(s) handed over`, indicator: 'green' });
					load_sales_portfolio(page);
				}
			});
		}
	});
	dialog.show();
}
