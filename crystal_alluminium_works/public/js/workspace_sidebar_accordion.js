(function () {
	const WORKSPACE_TITLE = "Crystal Alluminium Works";
	const EVENT_NAMESPACE = ".crystalWorkspaceAccordion";

	function get_workspace_sections() {
		const sidebar = frappe.app && frappe.app.sidebar;
		if (!sidebar || sidebar.sidebar_title !== WORKSPACE_TITLE || sidebar.editor?.edit_mode) {
			return [];
		}

		return (sidebar.items || []).filter(
			(section) => section && section.item?.type === "Section Break" && section.wrapper
		);
	}

	function save_accordion_state(sections) {
		if (!sections.length) return;

		let stored_state = {};
		try {
			stored_state = JSON.parse(localStorage.getItem("section-breaks-state") || "{}");
		} catch (error) {
			stored_state = {};
		}

		const workspace_key = sections[0].workspace_title || WORKSPACE_TITLE.toLowerCase();
		stored_state[workspace_key] = {};
		sections.forEach((section) => {
			stored_state[workspace_key][section.wrapper.attr("title")] = !!section.collapsed;
			section.section_breaks_state = stored_state;
		});

		localStorage.setItem("section-breaks-state", JSON.stringify(stored_state));
	}

	function keep_only_section_open(active_section) {
		const sections = get_workspace_sections();
		if (!sections.length || !active_section || active_section.collapsed) return;

		sections.forEach((section) => {
			if (section !== active_section && !section.collapsed) {
				section.close();
			}
		});
		save_accordion_state(sections);
	}

	function get_section_for_element(element, sections) {
		const section_element = $(element).closest(".section-item").get(0);
		return sections.find((section) => section.wrapper.get(0) === section_element);
	}

	function normalize_workspace_accordion() {
		const sidebar = frappe.app && frappe.app.sidebar;
		const sections = get_workspace_sections();
		if (!sections.length) return;

		let active_section = null;
		const active_item = sidebar.active_item?.get(0);
		if (active_item) {
			active_section = sections.find((section) => section.wrapper.get(0).contains(active_item));
		}

		const section_to_keep = active_section || sections.find((section) => !section.collapsed);
		if (!section_to_keep) {
			save_accordion_state(sections);
			return;
		}

		if (active_section && active_section.collapsed && sidebar.sidebar_expanded) {
			active_section.open();
		}
		keep_only_section_open(section_to_keep);
	}

	$(document)
		.off(EVENT_NAMESPACE)
		.on(
			`click${EVENT_NAMESPACE}`,
			".body-sidebar .section-item > .standard-sidebar-item",
			function () {
				const sections = get_workspace_sections();
				const clicked_section = get_section_for_element(this, sections);

				// Frappe's direct click handler runs before this delegated handler.
				// Defer once so its final open/closed state is the one we inspect.
				setTimeout(() => keep_only_section_open(clicked_section), 0);
			}
		)
		.on(`sidebar_setup${EVENT_NAMESPACE} page-change${EVENT_NAMESPACE}`, function () {
			setTimeout(normalize_workspace_accordion, 0);
		});

	$(function () {
		setTimeout(normalize_workspace_accordion, 0);
	});
})();
