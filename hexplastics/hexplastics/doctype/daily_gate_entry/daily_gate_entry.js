// Copyright (c) 2025, beetashoke chakraborty and contributors
// For license information, please see license.txt

frappe.ui.form.on('Daily Gate Entry', {
	onload: function (frm) {
		// Hide conditional sections by default
		frm.set_df_property('table_sxbw', 'hidden', 1);
		frm.set_df_property('sales_invoice_details', 'hidden', 1);
		frm.set_df_property('purpose', 'hidden', 1);

		// Not mandatory by default
		frm.set_df_property('table_sxbw', 'reqd', 0);
		frm.set_df_property('sales_invoice_details', 'reqd', 0);
		frm.set_df_property('purpose', 'reqd', 0);
	},

	purchase: function (frm) {
		if (frm.doc.purchase) {
			// Uncheck other checkboxes
			frm.set_value('sales', 0);
			frm.set_value('others', 0);

			// Show purchase child table and make it mandatory
			frm.set_df_property('table_sxbw', 'hidden', 0);
			frm.set_df_property('table_sxbw', 'reqd', 1);

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
			frm.set_df_property('table_sxbw', 'hidden', 1);
			frm.set_df_property('table_sxbw', 'reqd', 0);
			frm.clear_table('table_sxbw');
			frm.refresh_field('table_sxbw');
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
			frm.set_df_property('table_sxbw', 'hidden', 1);
			frm.set_df_property('table_sxbw', 'reqd', 0);
			frm.clear_table('table_sxbw');
			frm.refresh_field('table_sxbw');

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
			frm.set_df_property('table_sxbw', 'hidden', 1);
			frm.set_df_property('table_sxbw', 'reqd', 0);
			frm.clear_table('table_sxbw');
			frm.refresh_field('table_sxbw');
			frm.set_df_property('sales_invoice_details', 'hidden', 1);
			frm.set_df_property('sales_invoice_details', 'reqd', 0);
			frm.clear_table('sales_invoice_details');
			frm.refresh_field('sales_invoice_details');

			// Hide and clear other fields
			frm.set_df_property('purchase_invoice', 'hidden', 1);
			frm.set_df_property('purchase_invoice', 'reqd', 0);
			frm.set_value('purchase_invoice', '');

			frm.set_df_property('sales_invoice', 'hidden', 1);
			frm.set_df_property('sales_invoice', 'reqd', 0);
			frm.set_value('sales_invoice', '');
		} else {
			// Hide purpose if unchecked
			frm.set_df_property('purpose', 'hidden', 1);
			frm.set_df_property('purpose', 'reqd', 0);
			frm.set_value('purpose', '');
		}
	},

	purchase_invoice: function (frm) {
		let purchase_invoice = frm.doc.purchase_invoice;
		console.log("Triggered purchase_invoice event. Value entered:", purchase_invoice);

		if (!purchase_invoice) {
			console.log("No Purchase Invoice entered. Clearing mapped fields.");
			frm.set_value('transporter_name', '');
			frm.set_value('driver_name', '');
			frm.set_value('vehicle_no', '');
			frm.set_value('party_name', '');
			frm.set_value('invoice_date', '');
			return;
		}

		// Step 1: Fetch Purchase Invoice document
		console.log("Fetching Purchase Invoice document:", purchase_invoice);
		frappe.db.get_doc('Purchase Invoice', purchase_invoice)
			.then(invoice => {
				console.log("✅ Purchase Invoice fetched successfully:", invoice.name);
				console.log("Transporter Name from Purchase Invoice:", invoice.transporter_name);
				console.log("Driver Name from Purchase Invoice:", invoice.driver_name);

				// Step 2: Set values in Daily Gate Entry
				let transporter = invoice.transporter_name || '';
				let driver = invoice.driver_name || '';
				let vehicleNo = invoice.vehicle_no || '';
				let partyName = invoice.supplier || '';
				let invoiceDate = invoice.posting_date || '';

				console.log("Setting values in Daily Gate Entry → Transporter:", transporter, ", Driver:", driver, ", Vehicle:", vehicleNo, ", Party:", partyName, ", Date:", invoiceDate);
				frm.set_value('transporter_name', transporter);
				frm.set_value('driver_name', driver);
				frm.set_value('vehicle_no', vehicleNo);
				frm.set_value('party_name', partyName);
				frm.set_value('invoice_date', invoiceDate);
			})
			.catch(err => {
				console.error("❌ Error fetching Purchase Invoice:", err);
				frm.set_value('transporter_name', '');
				frm.set_value('driver_name', '');
				frm.set_value('vehicle_no', '');
				frm.set_value('party_name', '');
				frm.set_value('invoice_date', '');
			});
	},

	sales_invoice: function (frm) {
		let sales_invoice = frm.doc.sales_invoice;
		console.log("Triggered sales_invoice event. Value entered:", sales_invoice);

		if (!sales_invoice) {
			console.log("No Sales Invoice entered. Clearing mapped fields.");
			frm.set_value('transporter_name', '');
			frm.set_value('driver_name', '');
			frm.set_value('vehicle_no', '');
			frm.set_value('party_name', '');
			frm.set_value('invoice_date', '');
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
				let vehicleNo = invoice.vehicle_no || '';
				let partyName = invoice.customer || '';
				let invoiceDate = invoice.posting_date || '';

				console.log("Setting values in Daily Gate Entry → Transporter:", transporter, ", Driver:", driver, ", Vehicle:", vehicleNo, ", Party:", partyName, ", Date:", invoiceDate);
				frm.set_value('transporter_name', transporter);
				frm.set_value('driver_name', driver);
				frm.set_value('vehicle_no', vehicleNo);
				frm.set_value('party_name', partyName);
				frm.set_value('invoice_date', invoiceDate);
			})
			.catch(err => {
				console.error("❌ Error fetching Sales Invoice:", err);
				frm.set_value('transporter_name', '');
				frm.set_value('driver_name', '');
				frm.set_value('vehicle_no', '');
				frm.set_value('party_name', '');
				frm.set_value('invoice_date', '');
			});
	},

	refresh(frm) {
		// Handle field visibility based on checkbox states
		if (frm.doc.purchase) {
			frm.set_df_property('table_sxbw', 'hidden', 0);
			frm.set_df_property('table_sxbw', 'reqd', 1);
			frm.set_df_property('sales_invoice_details', 'hidden', 1);
			frm.set_df_property('sales_invoice_details', 'reqd', 0);
			frm.set_df_property('purpose', 'hidden', 1);
			frm.set_df_property('purpose', 'reqd', 0);
		} else if (frm.doc.sales) {
			frm.set_df_property('sales_invoice_details', 'hidden', 0);
			frm.set_df_property('sales_invoice_details', 'reqd', 1);
			frm.set_df_property('table_sxbw', 'hidden', 1);
			frm.set_df_property('table_sxbw', 'reqd', 0);
			frm.set_df_property('purpose', 'hidden', 1);
			frm.set_df_property('purpose', 'reqd', 0);
		} else if (frm.doc.others) {
			frm.set_df_property('purpose', 'hidden', 0);
			frm.set_df_property('purpose', 'reqd', 1);
			frm.set_df_property('table_sxbw', 'hidden', 1);
			frm.set_df_property('table_sxbw', 'reqd', 0);
			frm.set_df_property('sales_invoice_details', 'hidden', 1);
			frm.set_df_property('sales_invoice_details', 'reqd', 0);
		} else {
			// All checkboxes unchecked - hide all conditional sections
			frm.set_df_property('table_sxbw', 'hidden', 1);
			frm.set_df_property('sales_invoice_details', 'hidden', 1);
			frm.set_df_property('purpose', 'hidden', 1);
		}

		console.log("Form refreshed. Visibility updated.");
	}
});

// Child table handlers: react to first-row changes to populate parent fields
frappe.ui.form.on('Daily Gate Entry', {
	// Trigger when a row is added to purchase child table
	table_sxbw_add: function (frm) {
		frm.trigger('sync_first_row_info');
	},
	// Trigger when a row is added to sales child table
	sales_invoice_details_add: function (frm) {
		frm.trigger('sync_first_row_info');
	},
	// Shared helper to sync from first row of whichever section is active
	sync_first_row_info: function (frm) {
		let getFirst = () => {
			if (frm.doc.purchase && Array.isArray(frm.doc.table_sxbw) && frm.doc.table_sxbw.length > 0) {
				return { type: 'Purchase Invoice', name: frm.doc.table_sxbw[0].purchase_invoice };
			}
			if (frm.doc.sales && Array.isArray(frm.doc.sales_invoice_details) && frm.doc.sales_invoice_details.length > 0) {
				return { type: 'Sales Invoice', name: frm.doc.sales_invoice_details[0].sales_invoice };
			}
			return null;
		};

		let first = getFirst();
		if (!first || !first.name) {
			frm.set_value('transporter_name', '');
			frm.set_value('driver_name', '');
			frm.set_value('vehicle_no', '');
			return;
		}

		frappe.db.get_doc(first.type, first.name)
			.then(doc => {
				let transporter = doc.transporter_name || '';
				let driver = doc.driver_name || '';
				let vehicleNo = doc.vehicle_no || '';
				frm.set_value('transporter_name', transporter);
				frm.set_value('driver_name', driver);
				frm.set_value('vehicle_no', vehicleNo);
			})
			.catch(() => {
				frm.set_value('transporter_name', '');
				frm.set_value('driver_name', '');
				frm.set_value('vehicle_no', '');
			});
	}
});

// React when invoice link inside child rows changes
frappe.ui.form.on('Daily Gate Entry Purchase Invoice', {
	purchase_invoice: function (frm, cdt, cdn) {
		frm.trigger('sync_first_row_info');
	}
});

frappe.ui.form.on('Daily Gate Entry Sales Invoice', {
	sales_invoice: function (frm, cdt, cdn) {
		frm.trigger('sync_first_row_info');
	}
});
