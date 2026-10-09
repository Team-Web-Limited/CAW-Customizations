// Fixes the Payment Document links in ERPNext's Bank Reconciliation Statement report.
// Its formatter gives the "Cheques and Deposits incorrectly cleared" summary row a click
// handler by setting column.link_onclick — on the column object every row shares, so once
// that row has rendered, every Payment Entry / Journal Entry link in the column opens the
// utility report instead of its own document. This replaces the formatter with one that sets
// the handler on a copy of the column for that one row only.
// Same setter technique as customer_ledger_summary_filter.js (no hook exists for this).
(function () {
	const REPORT_NAME = "Bank Reconciliation Statement";

	function fix_formatter(settings) {
		if (!settings || settings._caw_link_fix) {
			return;
		}
		settings._caw_link_fix = true;
		settings.formatter = function (value, row, column, data, default_formatter) {
			if (column.fieldname === "payment_entry" && value === __("Cheques and Deposits incorrectly cleared")) {
				column = {
					...column,
					link_onclick: "frappe.query_reports['Bank Reconciliation Statement'].open_utility_report()",
				};
			}
			return default_formatter(value, row, column, data);
		};
	}

	frappe.provide("frappe.query_reports");
	let settings = frappe.query_reports[REPORT_NAME];
	fix_formatter(settings);

	Object.defineProperty(frappe.query_reports, REPORT_NAME, {
		configurable: true,
		enumerable: true,
		get: () => settings,
		set: (value) => {
			fix_formatter(value);
			settings = value;
		},
	});
})();
