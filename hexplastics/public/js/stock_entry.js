// Custom Stock Entry client logic for Hexplastics
// ------------------------------------------------
// Requirement:
// When a Stock Entry is created and submitted from the Production Log Sheet,
// do not show any "Total Value Difference (Incoming - Outgoing)" on the UI.
//
// Backend logic in Production Log Sheet already clears `difference_amount`
// for such Stock Entries. This client script ensures that, regardless of the
// underlying numeric value, the field is hidden / visually neutralised
// whenever the Stock Entry is linked to a Production Log Sheet.

frappe.ui.form.on("Stock Entry", {
	refresh(frm) {
		// Only apply this behavior for Stock Entries that originate
		// from a Production Log Sheet (linked via custom field)
		if (!frm.doc.production_log_sheet) {
			return;
		}

		// Safety guard: if the difference_amount field is not present,
		// there is nothing to hide or clear.
		if (!frm.fields_dict.difference_amount) {
			return;
		}

		// Hide the difference_amount field so the "Total Value Difference
		// (Incoming - Outgoing)" is not displayed for these entries.
		frm.set_df_property("difference_amount", "hidden", 1);

		// Also clear the displayed value in the form widget so users do not
		// see a residual 0.00 or any other amount. This does not re-save
		// the document, because:
		// - the field is read-only in the standard Stock Entry
		// - we are only changing the client-side value/visibility here.
		try {
			frm.set_value("difference_amount", null);
		} catch (e) {
			// If for any reason set_value fails (e.g. field is strictly read-only),
			// just ignore; the field is already hidden.
			console && console.warn && console.warn(
				"Could not clear difference_amount on Stock Entry form:", e
			);
		}
	},
});

