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
            return;
        }

        // Step 1: Fetch Sales Invoice document
        console.log("Fetching Sales Invoice document:", sales_invoice);
        frappe.db.get_doc('Sales Invoice', sales_invoice)
            .then(invoice => {
                console.log("✅ Sales Invoice fetched successfully:", invoice.name);
                console.log("Transporter Name from Sales Invoice:", invoice.transporter_name);
                console.log("Vehicle No from Sales Invoice:", invoice.vehicle_no || invoice.veichle_field);

                // Step 2: Set values in Weight Bridge Entry
                let transporter = invoice.transporter_name || '';
                // Check for vehicle_no or veichle_field in Sales Invoice
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
    },

    refresh(frm) {
        if (frm.doc.sales_invoice && (!frm.doc.transporter_name || !frm.doc.veichle_field)) {
            console.log("Form refreshed with Sales Invoice present but missing transporter/vehicle. Triggering auto-fetch...");
            frm.trigger('sales_invoice');
        } else {
            console.log("Form refreshed. No action needed.");
        }
    }
});
