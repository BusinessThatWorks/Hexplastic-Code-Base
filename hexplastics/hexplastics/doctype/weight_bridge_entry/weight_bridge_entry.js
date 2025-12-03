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

        // Set up invoice filters early
        setup_invoice_filters(frm);
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


    weight_of_packing_material: function (frm) {
        // Round to 2 decimal places if value exists
        if (frm.doc.weight_of_packing_material != null) {
            let value = parseFloat(frm.doc.weight_of_packing_material) || 0;
            value = Math.round(value * 100) / 100;
            if (value !== frm.doc.weight_of_packing_material) {
                frm.set_value('weight_of_packing_material', value);
            }
        }
        calculate_weights(frm);
    },

    weight_of_finished_material: function (frm) {
        // Round to 2 decimal places if value exists
        if (frm.doc.weight_of_finished_material != null) {
            let value = parseFloat(frm.doc.weight_of_finished_material) || 0;
            value = Math.round(value * 100) / 100;
            if (value !== frm.doc.weight_of_finished_material) {
                frm.set_value('weight_of_finished_material', value);
            }
        }
        calculate_weights(frm);
    },

    actual_kata_weight: function (frm) {
        // Round to 2 decimal places if value exists
        if (frm.doc.actual_kata_weight != null) {
            let value = parseFloat(frm.doc.actual_kata_weight) || 0;
            value = Math.round(value * 100) / 100;
            if (value !== frm.doc.actual_kata_weight) {
                frm.set_value('actual_kata_weight', value);
            }
        }
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
    },

    difference_in_weights: function (frm) {
        calculate_loss_profit(frm);
    },
    total_weight: function (frm) {
        calculate_loss_profit(frm);
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

        // Set query filters to exclude already used invoices
        setup_invoice_filters(frm);

        // Calculate values on form load
        calculate_weights(frm);

        // Update loss/profit visibility and values
        calculate_loss_profit(frm);
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

    // Round input values to 2 decimal places
    packing_weight = Math.round(packing_weight * 100) / 100;
    finished_weight = Math.round(finished_weight * 100) / 100;
    kata_weight = Math.round(kata_weight * 100) / 100;

    // Calculate total weight
    let total_weight = packing_weight + finished_weight;
    total_weight = Math.round(total_weight * 100) / 100;

    // Calculate difference in weights only if kata weight is provided
    let difference_in_weights = 0;
    if (frm.doc.actual_kata_weight && kata_weight > 0) {
        difference_in_weights = kata_weight - total_weight;
        difference_in_weights = Math.round(difference_in_weights * 100) / 100;
    }

    // Set the calculated values (rounded to 2 decimal places)
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

    // Round to 2 decimal places
    sum = Math.round(sum * 100) / 100;
    frm.set_value('weight_of_finished_material', sum);
    // Recalculate total and differences
    calculate_weights(frm);
}

function setup_invoice_filters(frm) {
    // Get current document's invoices to exclude from filter
    let current_purchase_invoices = [];
    let current_sales_invoices = [];

    if (Array.isArray(frm.doc.purchase_invoice_details)) {
        current_purchase_invoices = frm.doc.purchase_invoice_details
            .map(r => r.purchase_invoice)
            .filter(Boolean);
    }

    if (Array.isArray(frm.doc.sales_invoice_details)) {
        current_sales_invoices = frm.doc.sales_invoice_details
            .map(r => r.sales_invoice)
            .filter(Boolean);
    }

    // Fetch used invoices and then set up the query filters
    fetch_used_invoices(frm.doc.name, current_purchase_invoices, current_sales_invoices, function (used_purchase, used_sales) {
        // Filter for Purchase Invoice field in child table
        // Second parameter should be the parent fieldname, not the child doctype name
        frm.set_query('purchase_invoice', 'purchase_invoice_details', function () {
            // Only apply filter if there are used invoices
            if (used_purchase.length > 0) {
                return {
                    filters: [
                        ['name', 'not in', used_purchase]
                    ]
                };
            }
            // If no used invoices, return empty filters (show all)
            return {};
        });

        // Filter for Sales Invoice field in child table
        // Second parameter should be the parent fieldname, not the child doctype name
        frm.set_query('sales_invoice', 'sales_invoice_details', function () {
            // Only apply filter if there are used invoices
            if (used_sales.length > 0) {
                return {
                    filters: [
                        ['name', 'not in', used_sales]
                    ]
                };
            }
            // If no used invoices, return empty filters (show all)
            return {};
        });
    });
}

function fetch_used_invoices(current_doc_name, current_purchase_invoices, current_sales_invoices, callback) {
    // Use server-side method to get used invoices (avoids permission issues with child tables)
    frappe.call({
        method: 'hexplastics.hexplastics.doctype.weight_bridge_entry.weight_bridge_entry.get_used_invoices',
        args: {
            current_doc_name: current_doc_name || null
        },
        callback: function (r) {
            let used_purchase = [];
            let used_sales = [];

            if (r && r.message) {
                used_purchase = r.message.purchase_invoices || [];
                used_sales = r.message.sales_invoices || [];
            } else if (r && r.exc) {
                console.warn('Error fetching used invoices:', r.exc);
                // If server method fails, continue with empty arrays (show all invoices)
            }

            // Also exclude invoices already in current form (for new rows)
            used_purchase = used_purchase.filter(inv => !current_purchase_invoices.includes(inv));
            used_sales = used_sales.filter(inv => !current_sales_invoices.includes(inv));

            // Call callback with the filtered lists
            callback(used_purchase, used_sales);
        },
        error: function (r) {
            console.warn('Error calling get_used_invoices:', r);
            // On error, continue with empty arrays (show all invoices)
            callback([], []);
        }
    });
}

function calculate_loss_profit(frm) {
    let diff = Number(frm.doc.difference_in_weights) || 0;
    let total = Number(frm.doc.total_weight) || 0;

    // Calculate new values
    let new_per_of_loss = 0;
    let new_per_of_profit = 0;
    let show_loss = false;
    let show_profit = false;

    if (total > 0) {
        if (diff > 0) {
            new_per_of_loss = (diff / total) * 100;
            show_loss = true;
            show_profit = false;
        } else if (diff < 0) {
            new_per_of_profit = (Math.abs(diff) / total) * 100;
            show_loss = false;
            show_profit = true;
        } else {
            show_loss = false;
            show_profit = false;
        }
    }

    // Round to avoid floating point comparison issues
    new_per_of_loss = Math.round(new_per_of_loss * 100) / 100;
    new_per_of_profit = Math.round(new_per_of_profit * 100) / 100;

    // Get current values for comparison
    let current_loss = Math.round((Number(frm.doc.per_of_loss) || 0) * 100) / 100;
    let current_profit = Math.round((Number(frm.doc.per_of_profit) || 0) * 100) / 100;

    // Only set values if they're different (prevents marking document as dirty unnecessarily)
    if (current_loss !== new_per_of_loss) {
        frm.set_value("per_of_loss", new_per_of_loss);
    }
    if (current_profit !== new_per_of_profit) {
        frm.set_value("per_of_profit", new_per_of_profit);
    }

    // Update visibility (this doesn't mark document as dirty)
    frm.toggle_display("per_of_loss", show_loss);
    frm.toggle_display("per_of_profit", show_profit);

    // Refresh fields to update display
    frm.refresh_field("per_of_loss");
    frm.refresh_field("per_of_profit");
}
