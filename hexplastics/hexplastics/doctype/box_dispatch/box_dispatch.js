// Copyright (c) 2026, beetashoke chakraborty and contributors
// For license information, please see license.txt

function cint(value) {
	const n = parseInt(value, 10);
	return Number.isFinite(n) ? n : 0;
}

function set_dispatched_qty(frm) {
	const checked = cint(frm.doc.no_of_boxes_checked);
	const rejected = cint(frm.doc.no_of_boxes_rejected);
	frm.set_value("dispatched_qty", Math.max(0, checked - rejected));
}

frappe.ui.form.on("Box Dispatch", {
	box_production_id(frm) {
		if (!frm.doc.box_production_id) {
			return;
		}
		frappe.db.get_doc("Box Production", frm.doc.box_production_id).then((bp) => {
			frm.set_value("date", bp.production_date);
			frm.set_value("shift_type", bp.shift_type);
			const received = cint(bp.tape_checked) - cint(bp.tape_rejected);
			frm.set_value("received_from_taping_dept", Math.max(0, received));
		});
	},

	no_of_boxes_checked(frm) {
		set_dispatched_qty(frm);
	},

	no_of_boxes_rejected(frm) {
		set_dispatched_qty(frm);
	},
});
