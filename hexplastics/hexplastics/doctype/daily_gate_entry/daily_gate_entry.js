// Copyright (c) 2025, beetashoke chakraborty and contributors
// For license information, please see license.txt

// frappe.ui.form.on("Daily Gate Entry", {
// 	refresh(frm) {

// 	},
// });

frappe.ui.form.on('Daily Gate Entry', {
    sales_invoice: function (frm) {
        let sales_invoice = frm.doc.sales_invoice;
        console.log("Triggered sales_invoice event. Value entered:", sales_invoice);

        if (!sales_invoice) {
            console.log("No Sales Invoice entered. Clearing transporter and driver fields.");
            frm.set_value('transporter_name', '');
            frm.set_value('driver_name', '');
            return;
        }

        // Step 1: Fetch Sales Invoice document
        console.log("Fetching Sales Invoice document:", sales_invoice);
        frappe.db.get_doc('Sales Invoice', sales_invoice)
            .then(invoice => {
                console.log("✅ Sales Invoice fetched successfully:", invoice.name);
                console.log("Transporter Name from Sales Invoice:", invoice.transporter_name);
                console.log("Driver Name from Sales Invoice:", invoice.driver_name);

                // Step 2: Set values in Daily Gate Entry
                let transporter = invoice.transporter_name || '';
                let driver = invoice.driver_name || '';

                console.log("Setting values in Daily Gate Entry → Transporter:", transporter, ", Driver:", driver);
                frm.set_value('transporter_name', transporter);
                frm.set_value('driver_name', driver);
            })
            .catch(err => {
                console.error("❌ Error fetching Sales Invoice:", err);
                frm.set_value('transporter_name', '');
                frm.set_value('driver_name', '');
            });
    },

    refresh(frm) {
        if (frm.doc.sales_invoice && (!frm.doc.transporter_name || !frm.doc.driver_name)) {
            console.log("Form refreshed with Sales Invoice present but missing transporter/driver. Triggering auto-fetch...");
            frm.trigger('sales_invoice');
        } else {
            console.log("Form refreshed. No action needed.");
        }
    }
});
