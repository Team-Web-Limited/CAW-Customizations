frappe.pages['print-format-configurations'].on_page_load = function(wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Print Format Configurations',
		single_column: true
	});

	page.state = {
		schema: [],
		current_print_format: null
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
			.pfc-hint {
				margin: -8px 0 12px;
				font-size: 12px;
				color: var(--text-muted);
			}
			.pfc-row {
				display: flex;
				align-items: center;
				gap: 8px;
				margin-bottom: 8px;
			}
			.pfc-row-no {
				flex: 0 0 22px;
				text-align: right;
				font-size: 12px;
				color: var(--text-muted);
			}
			.pfc-row-text {
				flex: 1 1 auto;
				min-width: 0;
			}
			.pfc-row-bold {
				flex: 0 0 auto;
				display: flex;
				align-items: center;
				gap: 4px;
				margin: 0;
				font-size: 12px;
				color: var(--text-muted);
				white-space: nowrap;
			}
			.pfc-row-bold input {
				margin: 0;
			}
			.pfc-row .btn {
				flex: 0 0 auto;
			}
			.pfc-empty {
				color: var(--text-muted);
				font-size: 13px;
				padding: 4px 0 12px;
			}
			.pfc-loading {
				color: var(--text-muted);
				padding: 16px 0;
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
				page.state.current_print_format = first_print_format;
				page.state.print_format_control.set_value(first_print_format);
				load_print_format_configuration_values(page, first_print_format);
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

// Each section is an ordered list of one-line rows, stored as {section key: [{text, bold}]}.
// Order on screen is print order, so rows can be moved as well as added and deleted.
const PFC_SECTION_HINTS = {
	terms: __('Each line prints as one numbered term. Tick Bold to emphasise a line.'),
	payment_details: __('Write each line as LABEL: value — the label prints in bold. A value of QUOTE NO prints the document\'s own number.')
};

function render_configuration_form(page, values) {
	const schema = get_selected_print_format_schema(page);
	const $form = $(page.body).find('[data-area="form"]');

	if (!schema) {
		$form.html('<div class="pfc-loading">Select a print format to continue.</div>');
		return;
	}

	$form.empty();
	if (!(schema.sections || []).length) {
		$form.html('<div class="pfc-loading">This print format has no configurable text.</div>');
		return;
	}

	(schema.sections || []).forEach(section => {
		const allow_bold = section.key === 'terms';
		const hint = PFC_SECTION_HINTS[section.key];
		const $section = $(`
			<div class="pfc-panel" data-section="${frappe.utils.escape_html(section.key)}">
				<h4>${frappe.utils.escape_html(section.title)}</h4>
				${hint ? `<div class="pfc-hint">${frappe.utils.escape_html(hint)}</div>` : ''}
				<div class="pfc-rows"></div>
				<button type="button" class="btn btn-default btn-xs" data-action="add-row">${__('Add Row')}</button>
			</div>
		`).appendTo($form);
		const $rows = $section.find('.pfc-rows');

		(values[section.key] || []).forEach(row => add_configuration_row($rows, row, allow_bold));
		refresh_configuration_rows($rows);

		$section.find('[data-action="add-row"]').on('click', function() {
			const $row = add_configuration_row($rows, {}, allow_bold);
			refresh_configuration_rows($rows);
			$row.find('.pfc-row-text').trigger('focus');
		});
	});
}

function add_configuration_row($rows, row, allow_bold) {
	const $row = $(`
		<div class="pfc-row">
			<span class="pfc-row-no"></span>
			<input type="text" class="form-control input-sm pfc-row-text">
			${allow_bold ? `<label class="pfc-row-bold"><input type="checkbox"> ${__('Bold')}</label>` : ''}
			<button type="button" class="btn btn-default btn-xs" data-action="up" title="${__('Move up')}">&uarr;</button>
			<button type="button" class="btn btn-default btn-xs" data-action="down" title="${__('Move down')}">&darr;</button>
			<button type="button" class="btn btn-default btn-xs" data-action="delete" title="${__('Delete')}">&times;</button>
		</div>
	`).appendTo($rows);

	$row.find('.pfc-row-text').val(row.text || '');
	$row.find('.pfc-row-bold input').prop('checked', !!cint(row.bold));

	$row.find('[data-action="up"]').on('click', function() {
		$row.insertBefore($row.prev('.pfc-row'));
		refresh_configuration_rows($rows);
	});
	$row.find('[data-action="down"]').on('click', function() {
		$row.insertAfter($row.next('.pfc-row'));
		refresh_configuration_rows($rows);
	});
	$row.find('[data-action="delete"]').on('click', function() {
		$row.remove();
		refresh_configuration_rows($rows);
	});
	return $row;
}

// Renumber after any add/move/delete, disable the moves that would fall off either end, and
// show a placeholder when a section has no rows left.
function refresh_configuration_rows($rows) {
	const $all = $rows.children('.pfc-row');
	$all.each(function(index) {
		$(this).find('.pfc-row-no').text(`${index + 1}.`);
		$(this).find('[data-action="up"]').prop('disabled', index === 0);
		$(this).find('[data-action="down"]').prop('disabled', index === $all.length - 1);
	});
	$rows.children('.pfc-empty').remove();
	if (!$all.length) {
		$rows.append(`<div class="pfc-empty">${__('No rows — this section will not print. Use Add Row to add one.')}</div>`);
	}
}

function get_configuration_form_values(page) {
	const values = {};
	$(page.body).find('[data-section]').each(function() {
		values[$(this).attr('data-section')] = $(this).find('.pfc-row').map(function() {
			return {
				text: ($(this).find('.pfc-row-text').val() || '').trim(),
				bold: $(this).find('.pfc-row-bold input').prop('checked') ? 1 : 0
			};
		}).get().filter(row => row.text);
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
			// Reload so blank rows the save dropped disappear from the form too.
			load_print_format_configuration_values(page, print_format);
		}
	});
}
