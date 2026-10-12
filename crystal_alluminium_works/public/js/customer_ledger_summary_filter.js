// Adds a "Customer Billing Type" filter to ERPNext's Customer Ledger Summary report.
// Frappe has no hook for extending a standard report's JS: the report script is
// evaluated on first open and assigns frappe.query_reports["Customer Ledger Summary"],
// so a setter on that key injects the filter into whatever gets assigned.
// Server side: customer_ledger_summary_override.py.
(function () {
	const REPORT_NAME = "Customer Ledger Summary";
	const FILTER = {
		fieldname: "customer_billing_type",
		label: __("Customer Billing Type"),
		fieldtype: "Select",
		options: ["", "Invoice Customer", "Cash Customer"],
	};

	function add_filter(settings) {
		const filters = settings && settings.filters;
		if (!Array.isArray(filters) || filters.some((f) => f.fieldname === FILTER.fieldname)) {
			return;
		}
		const after = filters.findIndex((f) => f.fieldname === "customer_group");
		filters.splice(after === -1 ? filters.length : after + 1, 0, { ...FILTER });
	}

	frappe.provide("frappe.query_reports");
	let settings = frappe.query_reports[REPORT_NAME];
	add_filter(settings);

	Object.defineProperty(frappe.query_reports, REPORT_NAME, {
		configurable: true,
		enumerable: true,
		get: () => settings,
		set: (value) => {
			add_filter(value);
			settings = value;
		},
	});
})();
