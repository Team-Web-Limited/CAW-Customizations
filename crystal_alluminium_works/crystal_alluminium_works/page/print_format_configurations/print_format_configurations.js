frappe.pages['print-format-configurations'].on_page_load = function(wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Print Format Configurations',
		single_column: true
	});

	page.state = {
		schema: [],
		current_print_format: null,
		controls: {}
	};

	page.set_primary_action('Save', function() {
		save_print_format_configuration(page);
	});

	render_print_format_configurations_page(page);
	load_print_format_configuration_schema(page);
};

function render_print_format_configurations_page(page) {
	$(page.body).html(`
		<style>
			.pfc-shell {
				max-width: 960px;
				padding: 20px 0 40px;
			}
			.pfc-panel {
				background: var(--card-bg);
				border: 1px solid var(--border-color);
				border-radius: 6px;
				padding: 18px;
				margin-bottom: 16px;
			}
			.pfc-panel h4 {
				margin: 0 0 14px;
				font-size: 14px;
				font-weight: 700;
				color: var(--heading-color);
			}
			.pfc-grid {
				display: grid;
				grid-template-columns: repeat(2, minmax(240px, 1fr));
				gap: 12px 18px;
			}
			.pfc-loading {
				color: var(--text-muted);
				padding: 16px 0;
			}
			@media (max-width: 767px) {
				.pfc-grid {
					grid-template-columns: 1fr;
				}
			}
		</style>
		<div class="pfc-shell">
			<div class="pfc-panel">
				<div data-field="print_format"></div>
			</div>
			<div data-area="form">
				<div class="pfc-loading">Loading configuration...</div>
			</div>
		</div>
	`);

	const print_format_control = frappe.ui.form.make_control({
		parent: $(page.body).find('[data-field="print_format"]'),
		df: {
			fieldtype: 'Select',
			fieldname: 'print_format',
			label: 'Print Format',
			reqd: 1,
			options: []
		},
		render_input: true
	});

	print_format_control.$input.on('change', function() {
		const print_format = print_format_control.get_value();
		if (print_format) {
			page.state.current_print_format = print_format;
			load_print_format_configuration_values(page, print_format);
		}
	});

	page.state.print_format_control = print_format_control;
}

function load_print_format_configuration_schema(page) {
	frappe.call({
		method: 'crystal_alluminium_works.print_format_config.get_print_format_configuration_schema',
		callback: function(r) {
			page.state.schema = r.message || [];
			const options = page.state.schema.map(row => row.print_format).join('\n');
			page.state.print_format_control.df.options = options;
			page.state.print_format_control.refresh();

			const first_print_format = page.state.schema[0] && page.state.schema[0].print_format;
			if (first_print_format) {
				page.state.print_format_control.set_value(first_print_format);
			} else {
				$(page.body).find('[data-area="form"]').html('<div class="pfc-loading">No configurable print formats found.</div>');
			}
		}
	});
}

function get_selected_print_format_schema(page) {
	return (page.state.schema || []).find(row => row.print_format === page.state.current_print_format);
}

function load_print_format_configuration_values(page, print_format) {
	$(page.body).find('[data-area="form"]').html('<div class="pfc-loading">Loading configuration...</div>');

	frappe.call({
		method: 'crystal_alluminium_works.print_format_config.get_print_format_configuration_values',
		args: { print_format },
		callback: function(r) {
			render_configuration_form(page, r.message || {});
		}
	});
}

function render_configuration_form(page, values) {
	const schema = get_selected_print_format_schema(page);
	const $form = $(page.body).find('[data-area="form"]');
	page.state.controls = {};

	if (!schema) {
		$form.html('<div class="pfc-loading">Select a print format to continue.</div>');
		return;
	}

	$form.empty();
	(schema.sections || []).forEach(section => {
		const $section = $(`
			<div class="pfc-panel">
				<h4>${frappe.utils.escape_html(section.title)}</h4>
				<div class="pfc-grid"></div>
			</div>
		`).appendTo($form);
		const $grid = $section.find('.pfc-grid');

		(section.fields || []).forEach(field => {
			const $field = $('<div></div>').appendTo($grid);
			const control = frappe.ui.form.make_control({
				parent: $field,
				df: {
					fieldtype: field.fieldtype,
					fieldname: field.fieldname,
					label: field.label
				},
				render_input: true
			});
			control.set_value(values[field.fieldname]);
			page.state.controls[field.fieldname] = control;
		});
	});
}

function get_configuration_form_values(page) {
	const values = {};
	Object.keys(page.state.controls || {}).forEach(fieldname => {
		values[fieldname] = page.state.controls[fieldname].get_value();
	});
	return values;
}

function save_print_format_configuration(page) {
	const print_format = page.state.current_print_format;
	if (!print_format) {
		frappe.msgprint('Please select a print format.');
		return;
	}

	frappe.call({
		method: 'crystal_alluminium_works.print_format_config.save_print_format_configuration',
		args: {
			print_format,
			values: get_configuration_form_values(page)
		},
		freeze: true,
		freeze_message: 'Saving print format configuration...',
		callback: function() {
			frappe.show_alert({ message: 'Print format configuration saved', indicator: 'green' });
		}
	});
}
