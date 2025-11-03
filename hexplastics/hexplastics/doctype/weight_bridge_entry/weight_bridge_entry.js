// Copyright (c) 2025, beetashoke chakraborty and contributors
// For license information, please see license.txt

frappe.ui.form.on('Weight Bridge Entry', {
    sales_invoice: function (frm) {
        let sales_invoice = frm.doc.sales_invoice;
        console.log("Triggered sales_invoice event. Value entered:", sales_invoice);

        if (!sales_invoice) {
            console.log("No Sales Invoice entered. Clearing transporter and vehicle fields.");
            frm.set_value('transporter_name', '');
            frm.set_value('veichle_field', '');
            frm.set_value('item_description', '');
            return;
        }

        // Fetch Sales Invoice Document for transporter and vehicle
        console.log("Fetching Sales Invoice document:", sales_invoice);
        frappe.db.get_doc('Sales Invoice', sales_invoice)
            .then(invoice => {
                console.log("✅ Sales Invoice fetched successfully:", invoice.name);
                console.log("Transporter Name from Sales Invoice:", invoice.transporter_name);
                console.log("Vehicle No from Sales Invoice:", invoice.vehicle_no || invoice.veichle_field);

                // Set transporter and vehicle values
                let transporter = invoice.transporter_name || '';
                let vehicle = invoice.vehicle_no || invoice.veichle_field || '';

                console.log("Setting values in Weight Bridge Entry → Transporter:", transporter, ", Vehicle No:", vehicle);
                frm.set_value('transporter_name', transporter);
                frm.set_value('veichle_field', vehicle);
            })
            .catch(err => {
                console.error("❌ Error fetching Sales Invoice:", err);
                frm.set_value('transporter_name', '');
                frm.set_value('veichle_field', '');
            });
        
        // Fetch item descriptions using frappe.call
        if (frm.doc.sales_invoice) {
            frm.set_value('item_description', '');
            
            frappe.call({
                method: 'frappe.client.get',
                args: {
                    doctype: 'Sales Invoice',
                    name: frm.doc.sales_invoice
                },
                callback: function(r) {
                    if (r.message && r.message.items) {
                        let item_names = [];
                        
                        r.message.items.forEach(function(item) {
                            if (item.item_name) {
                                item_names.push(item.item_name);
                            }
                        });
                        
                        frm.set_value('item_description', item_names.join(', '));
                    }
                }
            });
        } else {
            frm.set_value('item_description', '');
        }
    },

    refresh: function(frm) {
        if (frm.doc.sales_invoice && (!frm.doc.transporter_name || !frm.doc.veichle_field)) {
            console.log("Form refreshed with Sales Invoice present but missing transporter/vehicle. Triggering auto-fetch...");
            frm.trigger('sales_invoice');
        } else {
            console.log("Form refreshed. No action needed.");
        }
        
        // Calculate values on form load
        calculate_weights(frm);
    },
    
    weight_of_packing_material: function(frm) {
        calculate_weights(frm);
    },
    
    weight_of_finished_material: function(frm) {
        calculate_weights(frm);
    },
    
    actual_kata_weight: function(frm) {
        calculate_weights(frm);
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
