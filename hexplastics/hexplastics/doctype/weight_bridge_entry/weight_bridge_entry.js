// Copyright (c) 2025, beetashoke chakraborty and contributors
// For license information, please see license.txt

frappe.ui.form.on('Weight Bridge Entry', {
    onload: function (frm) {
        // Hide conditional sections by default
        frm.set_df_property('purchase_invoice_details', 'hidden', 1);
        frm.set_df_property('sales_invoice_details', 'hidden', 1);
        frm.set_df_property('purpose', 'hidden', 1);

        // Not mandatory by default
        frm.set_df_property('purchase_invoice_details', 'reqd', 0);
        frm.set_df_property('sales_invoice_details', 'reqd', 0);
        frm.set_df_property('purpose', 'reqd', 0);
    },

    purchase: function (frm) {
        if (frm.doc.purchase) {
            // Uncheck other checkboxes
            frm.set_value('sales', 0);
            frm.set_value('others', 0);

            // Show purchase child table and make it mandatory
            frm.set_df_property('purchase_invoice_details', 'hidden', 0);
            frm.set_df_property('purchase_invoice_details', 'reqd', 1);

            // Hide and clear other conditional sections
            frm.set_df_property('sales_invoice_details', 'hidden', 1);
            frm.set_df_property('sales_invoice_details', 'reqd', 0);
            frm.clear_table('sales_invoice_details');
            frm.refresh_field('sales_invoice_details');

            frm.set_df_property('purpose', 'hidden', 1);
            frm.set_df_property('purpose', 'reqd', 0);
            frm.set_value('purpose', '');
        } else {
            // Hide purchase child table if unchecked
            frm.set_df_property('purchase_invoice_details', 'hidden', 1);
            frm.set_df_property('purchase_invoice_details', 'reqd', 0);
            frm.clear_table('purchase_invoice_details');
            frm.refresh_field('purchase_invoice_details');
        }
    },

    sales: function (frm) {
        if (frm.doc.sales) {
            // Uncheck other checkboxes
            frm.set_value('purchase', 0);
            frm.set_value('others', 0);

            // Show sales child table and make it mandatory
            frm.set_df_property('sales_invoice_details', 'hidden', 0);
            frm.set_df_property('sales_invoice_details', 'reqd', 1);

            // Hide and clear other conditional sections
            frm.set_df_property('purchase_invoice_details', 'hidden', 1);
            frm.set_df_property('purchase_invoice_details', 'reqd', 0);
            frm.clear_table('purchase_invoice_details');
            frm.refresh_field('purchase_invoice_details');

            frm.set_df_property('purpose', 'hidden', 1);
            frm.set_df_property('purpose', 'reqd', 0);
            frm.set_value('purpose', '');
        } else {
            // Hide sales child table if unchecked
            frm.set_df_property('sales_invoice_details', 'hidden', 1);
            frm.set_df_property('sales_invoice_details', 'reqd', 0);
            frm.clear_table('sales_invoice_details');
            frm.refresh_field('sales_invoice_details');
        }
    },

    others: function (frm) {
        if (frm.doc.others) {
            // Uncheck other checkboxes
            frm.set_value('purchase', 0);
            frm.set_value('sales', 0);

            // Show purpose and make it mandatory; hide child tables
            frm.set_df_property('purpose', 'hidden', 0);
            frm.set_df_property('purpose', 'reqd', 1);

            frm.set_df_property('purchase_invoice_details', 'hidden', 1);
            frm.set_df_property('purchase_invoice_details', 'reqd', 0);
            frm.clear_table('purchase_invoice_details');
            frm.refresh_field('purchase_invoice_details');

            frm.set_df_property('sales_invoice_details', 'hidden', 1);
            frm.set_df_property('sales_invoice_details', 'reqd', 0);
            frm.clear_table('sales_invoice_details');
            frm.refresh_field('sales_invoice_details');
        } else {
            // Hide purpose if unchecked
            frm.set_df_property('purpose', 'hidden', 1);
            frm.set_df_property('purpose', 'reqd', 0);
            frm.set_value('purpose', '');
        }
    },

    refresh: function (frm) {
        // Handle field visibility based on checkbox states
        if (frm.doc.purchase) {
            frm.set_df_property('purchase_invoice_details', 'hidden', 0);
            frm.set_df_property('purchase_invoice_details', 'reqd', 1);
            frm.set_df_property('sales_invoice_details', 'hidden', 1);
            frm.set_df_property('sales_invoice_details', 'reqd', 0);
            frm.set_df_property('purpose', 'hidden', 1);
            frm.set_df_property('purpose', 'reqd', 0);
        } else if (frm.doc.sales) {
            frm.set_df_property('sales_invoice_details', 'hidden', 0);
            frm.set_df_property('sales_invoice_details', 'reqd', 1);
            frm.set_df_property('purchase_invoice_details', 'hidden', 1);
            frm.set_df_property('purchase_invoice_details', 'reqd', 0);
            frm.set_df_property('purpose', 'hidden', 1);
            frm.set_df_property('purpose', 'reqd', 0);
        } else if (frm.doc.others) {
            frm.set_df_property('purpose', 'hidden', 0);
            frm.set_df_property('purpose', 'reqd', 1);
            frm.set_df_property('purchase_invoice_details', 'hidden', 1);
            frm.set_df_property('purchase_invoice_details', 'reqd', 0);
            frm.set_df_property('sales_invoice_details', 'hidden', 1);
            frm.set_df_property('sales_invoice_details', 'reqd', 0);
        } else {
            // All checkboxes unchecked - hide all conditional sections
            frm.set_df_property('purchase_invoice_details', 'hidden', 1);
            frm.set_df_property('sales_invoice_details', 'hidden', 1);
            frm.set_df_property('purpose', 'hidden', 1);
        }

        // Calculate values on form load
        calculate_weights(frm);
    },

    weight_of_packing_material: function (frm) {
        calculate_weights(frm);
    },

    weight_of_finished_material: function (frm) {
        calculate_weights(frm);
    },

    actual_kata_weight: function (frm) {
        calculate_weights(frm);
    },

    // Trigger when a row is added to purchase child table
    purchase_invoice_details_add: function (frm) {
        frm.trigger('sync_first_row_info');
    },

    // Trigger when a row is added to sales child table
    sales_invoice_details_add: function (frm) {
        frm.trigger('sync_first_row_info');
    },

    // Shared helper to sync from first row of whichever section is active
    sync_first_row_info: function (frm) {
        let getFirst = () => {
            if (frm.doc.purchase && Array.isArray(frm.doc.purchase_invoice_details) && frm.doc.purchase_invoice_details.length > 0) {
                return { type: 'Purchase Invoice', name: frm.doc.purchase_invoice_details[0].purchase_invoice };
            }
            if (frm.doc.sales && Array.isArray(frm.doc.sales_invoice_details) && frm.doc.sales_invoice_details.length > 0) {
                return { type: 'Sales Invoice', name: frm.doc.sales_invoice_details[0].sales_invoice };
            }
            return null;
        };

        let first = getFirst();
        if (!first || !first.name) {
            frm.set_value('transporter_name', '');
            frm.set_value('veichle_field', '');
            return;
        }

        frappe.db.get_doc(first.type, first.name)
            .then(doc => {
                let transporter = doc.transporter_name || '';
                let vehicleNo = doc.vehicle_no || doc.veichle_field || '';
                frm.set_value('transporter_name', transporter);
                frm.set_value('veichle_field', vehicleNo);
            })
            .catch(() => {
                frm.set_value('transporter_name', '');
                frm.set_value('veichle_field', '');
            });
    },

    // Recompute parent finished material weight whenever child rows change
    purchase_invoice_details_remove: function (frm) {
        recompute_finished_material_weight(frm);
    },
    sales_invoice_details_remove: function (frm) {
        recompute_finished_material_weight(frm);
    }
});

// React when invoice link inside child rows changes
frappe.ui.form.on('Weight Bridge Entry Purchase Invoice', {
    purchase_invoice: function (frm, cdt, cdn) {
        // keep parent auto-fill in sync
        frm.trigger('sync_first_row_info');

        // when a purchase invoice is selected/changed in a row, fetch item names and
        // populate the row's item_description with a comma-separated list
        let row = locals[cdt][cdn];
        let pinv = row && row.purchase_invoice;

        if (!pinv) {
            frappe.model.set_value(cdt, cdn, 'item_description', '');
            return;
        }

        frappe.db.get_doc('Purchase Invoice', pinv)
            .then(doc => {
                let names = Array.isArray(doc.items) ? doc.items
                    .map(it => it && it.item_name)
                    .filter(Boolean) : [];
                frappe.model.set_value(cdt, cdn, 'item_description', names.join(', '));
            })
            .catch(() => {
                frappe.model.set_value(cdt, cdn, 'item_description', '');
            });

        // also recompute finished material weight (in case quantities are pre-fetched)
        recompute_finished_material_weight(frm);
    },
    total_quantity: function (frm, cdt, cdn) {
        recompute_finished_material_weight(frm);
    }
});

frappe.ui.form.on('Weight Bridge Entry Sales Invoice', {
    sales_invoice: function (frm, cdt, cdn) {
        // keep parent auto-fill in sync
        frm.trigger('sync_first_row_info');

        // when a sales invoice is selected/changed in a row, fetch item names and
        // populate the row's item_description with a comma-separated list
        let row = locals[cdt][cdn];
        let sinv = row && row.sales_invoice;

        if (!sinv) {
            frappe.model.set_value(cdt, cdn, 'item_description', '');
            return;
        }

        frappe.db.get_doc('Sales Invoice', sinv)
            .then(doc => {
                let names = Array.isArray(doc.items) ? doc.items
                    .map(it => it && it.item_name)
                    .filter(Boolean) : [];
                frappe.model.set_value(cdt, cdn, 'item_description', names.join(', '));
            })
            .catch(() => {
                frappe.model.set_value(cdt, cdn, 'item_description', '');
            });

        // also recompute finished material weight (in case quantities are pre-fetched)
        recompute_finished_material_weight(frm);
    },
    total_quantity: function (frm, cdt, cdn) {
        recompute_finished_material_weight(frm);
    }
});

function calculate_weights(frm) {
    // Get the input values
    let packing_weight = parseFloat(frm.doc.weight_of_packing_material) || 0;
    let finished_weight = parseFloat(frm.doc.weight_of_finished_material) || 0;
    let kata_weight = parseFloat(frm.doc.actual_kata_weight) || 0;

    // Calculate total weight
    let total_weight = packing_weight + finished_weight;

    // Calculate difference in weights only if kata weight is provided
    let difference_in_weights = 0;
    if (frm.doc.actual_kata_weight && kata_weight > 0) {
        difference_in_weights = total_weight - kata_weight;
    }

    // Set the calculated values
    frm.set_value('total_weight', total_weight);
    frm.set_value('difference_in_weights', difference_in_weights);
}

function recompute_finished_material_weight(frm) {
    // Sum quantities across both child tables
    let sum = 0;

    if (Array.isArray(frm.doc.purchase_invoice_details)) {
        frm.doc.purchase_invoice_details.forEach(r => {
            let q = parseFloat(r.total_quantity) || 0;
            sum += q;
        });
    }

    if (Array.isArray(frm.doc.sales_invoice_details)) {
        frm.doc.sales_invoice_details.forEach(r => {
            let q = parseFloat(r.total_quantity) || 0;
            sum += q;
        });
    }

    frm.set_value('weight_of_finished_material', sum);
    // Recalculate total and differences
    calculate_weights(frm);
}
