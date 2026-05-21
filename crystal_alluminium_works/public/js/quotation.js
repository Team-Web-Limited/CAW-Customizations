const VALID_PRODUCT_CATEGORIES = ['Aluminium', 'Glass', 'Fittings', 'Ceiling', 'Rubber', 'Silicone'];

frappe.ui.form.on('Quotation Item', {
    // When Product Category changes, filter Item Code to that group and clear the old item
    custom_product_category: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        let category = row.custom_product_category;

        // Clear the old item since category changed
        frappe.model.set_value(cdt, cdn, 'item_code', '');
        frappe.model.set_value(cdt, cdn, 'item_name', '');

        // Set dynamic filter on item_code for this row
        let grid_row = frm.fields_dict.items.grid.grid_rows_by_docname[cdn];
        if (grid_row) {
            let item_code_field = grid_row.get_field('item_code');
            if (item_code_field) {
                if (category) {
                    item_code_field.get_query = function() {
                        return {
                            filters: {
                                'item_group': category
                            }
                        };
                    };
                } else {
                    item_code_field.get_query = null;
                }
            }
        }
    },

    // When Item Code is selected, auto-set the Product Category from item_group
    item_code: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        if (row.item_code) {
            frappe.db.get_value('Item', row.item_code, 'item_group', function(r) {
                if (r && r.item_group) {
                    if (VALID_PRODUCT_CATEGORIES.includes(r.item_group)) {
                        frappe.model.set_value(cdt, cdn, 'custom_product_category', r.item_group);
                    }
                }
            });
        }
    },

    // Real-time glass dimension calculation
    custom_width_mm: function(frm, cdt, cdn) {
        calculate_glass_area(frm, cdt, cdn);
    },
    custom_height_mm: function(frm, cdt, cdn) {
        calculate_glass_area(frm, cdt, cdn);
    }
});

// Apply item_code filter when the form loads (for existing quotations)
frappe.ui.form.on('Quotation', {
    refresh: function(frm) {
        // Apply filters for any rows that already have a category
        (frm.doc.items || []).forEach(function(row) {
            if (row.custom_product_category) {
                let grid_row = frm.fields_dict.items.grid.grid_rows_by_docname[row.name];
                if (grid_row) {
                    let item_code_field = grid_row.get_field('item_code');
                    if (item_code_field) {
                        let cat = row.custom_product_category;
                        item_code_field.get_query = function() {
                            return { filters: { 'item_group': cat } };
                        };
                    }
                }
            }
        });
    }
});

function calculate_glass_area(frm, cdt, cdn) {
    let row = locals[cdt][cdn];

    if (row.custom_width_mm || row.custom_height_mm) {
        frappe.call({
            method: 'crystal_alluminium_works.pricing_engine.calculate_dimensions',
            args: {
                item_code: row.item_code || '',
                width_mm: row.custom_width_mm || 0,
                height_mm: row.custom_height_mm || 0
            },
            callback: function(r) {
                if (r.message) {
                    frappe.model.set_value(cdt, cdn, 'custom_width_ft', r.message.width_ft);
                    frappe.model.set_value(cdt, cdn, 'custom_height_ft', r.message.height_ft);
                    frappe.model.set_value(cdt, cdn, 'custom_area_sqft', r.message.area_sqft);
                    frappe.model.set_value(cdt, cdn, 'custom_perimeter_rft', r.message.perimeter_rft);
                }
            }
        });
    }
}
