// Copyright (c) 2025, beetashoke chakraborty and contributors
// For license information, please see license.txt

frappe.ui.form.on("Hourly Production", {
    work_order: function (frm) {
        // When work_order field changes, fetch item codes from Work Order's required_items
        if (frm.doc.work_order) {
            frappe.db.get_doc('Work Order', frm.doc.work_order)
                .then(work_order_doc => {
                    // Check if required_items child table exists and has data
                    if (work_order_doc.required_items && Array.isArray(work_order_doc.required_items) && work_order_doc.required_items.length > 0) {
                        // Clear existing rows in hourly_production_item table
                        frm.clear_table('hourly_production_item');

                        // Add rows for each item_code from required_items
                        work_order_doc.required_items.forEach(item => {
                            if (item.item_code) {
                                let row = frm.add_child('hourly_production_item');
                                frappe.model.set_value(row.doctype, row.name, 'item_code', item.item_code);
                            }
                        });

                        // Refresh the child table to show the new rows
                        frm.refresh_field('hourly_production_item');
                        // Recalculate total consumption qty
                        calculate_total_consumption_qty(frm);
                    } else {
                        // If no required_items found, clear the table
                        frm.clear_table('hourly_production_item');
                        frm.refresh_field('hourly_production_item');
                        // Recalculate total consumption qty (will be 0)
                        calculate_total_consumption_qty(frm);
                    }
                })
                .catch(err => {
                    console.error('Error fetching Work Order:', err);
                    frappe.msgprint({
                        title: __('Error'),
                        message: __('Failed to fetch Work Order details. Please try again.'),
                        indicator: 'red'
                    });
                });
        } else {
            // If work_order is cleared, clear the child table
            frm.clear_table('hourly_production_item');
            frm.refresh_field('hourly_production_item');
            // Recalculate total consumption qty (will be 0)
            calculate_total_consumption_qty(frm);
        }
    },

    refresh: function (frm) {
        // Calculate total consumption qty on form load/refresh
        calculate_total_consumption_qty(frm);
    }
});

// Event listeners for the child table (Hourly Production Item Table)
frappe.ui.form.on('Hourly Production Item Table', {
    consumption_qty: function (frm, cdt, cdn) {
        // When consumption_qty changes in any row, recalculate total
        calculate_total_consumption_qty(frm);
    },

    // When a row is added, recalculate total
    hourly_production_item_add: function (frm) {
        calculate_total_consumption_qty(frm);
    },

    // When a row is removed, recalculate total
    hourly_production_item_remove: function (frm) {
        calculate_total_consumption_qty(frm);
    }
});

// Function to calculate and set total consumption qty
function calculate_total_consumption_qty(frm) {
    let total = 0;

    // Sum all consumption_qty values from the child table
    if (Array.isArray(frm.doc.hourly_production_item)) {
        frm.doc.hourly_production_item.forEach(row => {
            let qty = parseFloat(row.consumption_qty) || 0;
            total += qty;
        });
    }

    // Round to 3 decimal places
    total = Math.round(total * 1000) / 1000;

    // Set the total in the parent doctype
    frm.set_value('total_consumption_qty', total);
}
