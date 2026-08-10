// Copyright (c) 2026, Venum and contributors
// For license information, please see license.txt

frappe.query_reports["Forex FIFO Ledger"] = {
	filters: [
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
			reqd: 1,
			default: frappe.defaults.get_user_default("Company"),
		},
		{
			fieldname: "account",
			label: __("Account"),
			fieldtype: "Link",
			options: "Account",
			// Only bank/cash accounts held in a currency other than the
			// company's have a FIFO cost basis at all.
			get_query: () => {
				const company = frappe.query_report.get_filter_value("company");
				return {
					query: "crystal_alluminium_works.forex_fifo.tracked_account_query",
					filters: { company: company },
				};
			},
		},
		{
			fieldname: "from_date",
			label: __("From Date"),
			fieldtype: "Date",
			default: frappe.datetime.add_months(frappe.datetime.get_today(), -12),
		},
		{
			fieldname: "to_date",
			label: __("To Date"),
			fieldtype: "Date",
			default: frappe.datetime.get_today(),
		},
	],

	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);

		if (column.fieldname === "realized_gain_loss" && data && data.realized_gain_loss) {
			const colour = data.realized_gain_loss > 0 ? "green" : "red";
			value = `<span style="color:${colour}">${value}</span>`;
		}

		// Currency drawn on without a cost basis is a data-completeness problem,
		// not a rounding curiosity -- make it impossible to scroll past.
		if (column.fieldname === "lots_consumed" && data && data.shortfall) {
			value = `<span style="color:var(--red-500)">${value}</span>`;
		}

		return value;
	},
};
