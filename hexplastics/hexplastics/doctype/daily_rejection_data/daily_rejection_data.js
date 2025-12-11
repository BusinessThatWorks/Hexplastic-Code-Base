// Copyright (c) 2025, beetashoke chakraborty and contributors
// For license information, please see license.txt

frappe.ui.form.on("Daily Rejection Data", {
	refresh(frm) {
		// Calculate on form refresh to populate existing values
		frm.trigger("calculate_rejection");
	},

	calculate_rejection(frm) {
		// Calculate total_rejection
		const total_rejection =
			(flt(frm.doc.box_rejected_by_die_punching) || 0) +
			(flt(frm.doc.box_rejected_by_printing) || 0) +
			(flt(frm.doc.box_rejected_by_bending) || 0) +
			(flt(frm.doc.box_rejected_by_stepling) || 0);

		frm.set_value("total_rejection", total_rejection);

		// Calculate rejection_in_% = (total_rejection / total_box_checked) * 100
		const total_box_checked = flt(frm.doc.total_box_checked) || 0;
		if (total_box_checked > 0) {
			const rejection_percentage = (total_rejection / total_box_checked) * 100;
			frm.set_value("rejection_in_", rejection_percentage);
		} else {
			frm.set_value("rejection_in_", 0);
		}
	},

	box_rejected_by_die_punching(frm) {
		frm.trigger("calculate_rejection");
	},

	box_rejected_by_printing(frm) {
		frm.trigger("calculate_rejection");
	},

	box_rejected_by_bending(frm) {
		frm.trigger("calculate_rejection");
	},

	box_rejected_by_stepling(frm) {
		frm.trigger("calculate_rejection");
	},

	total_box_checked(frm) {
		frm.trigger("calculate_rejection");
	},
});
