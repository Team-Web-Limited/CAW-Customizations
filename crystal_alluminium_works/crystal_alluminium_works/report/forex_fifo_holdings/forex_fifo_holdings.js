// Copyright (c) 2026, Venum and contributors
// For license information, please see license.txt

frappe.query_reports["Forex FIFO Holdings"] = {
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
			get_query: () => {
				const company = frappe.query_report.get_filter_value("company");
				return {
					query: "crystal_alluminium_works.forex_fifo.tracked_account_query",
					filters: { company: company },
				};
			},
		},
	],

	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);

		// Per-account roll-up rows carry no voucher; bold them so the lot list
		// above each one reads as belonging to it.
		if (data && data.is_total) {
			value = `<b>${value}</b>`;
		}

		return value;
	},
};
