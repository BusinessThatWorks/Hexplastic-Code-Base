// Copyright (c) 2026, beetashoke chakraborty and contributors
// For license information, please see license.txt

function cint(value) {
	const n = parseInt(value, 10);
	return Number.isFinite(n) ? n : 0;
}

function set_totals_from_items(frm) {
	let totalRejected = 0;
	let totalDispatched = 0;

	(frm.doc.table_azko || []).forEach((row) => {
		const stickerApplied = cint(row.sticker_applied_qty);
		const rejected = cint(row.rejected_qty);
		const dispatched = stickerApplied - rejected;

		frappe.model.set_value(row.doctype, row.name, "dispatched_qty", dispatched);
		totalRejected += rejected;
		totalDispatched += dispatched;
	});

	frm.set_value("total_rejected_qty", totalRejected);
	frm.set_value("total_dispatched_qty", totalDispatched);
}

frappe.ui.form.on("Box Dispatch", {
	refresh(frm) {
		set_totals_from_items(frm);
	},
});

frappe.ui.form.on("Box Dispatch Table", {
	sticker_applied_qty(frm) {
		set_totals_from_items(frm);
	},

	rejected_qty(frm) {
		set_totals_from_items(frm);
	},

	table_azko_add(frm) {
		set_totals_from_items(frm);
	},

	table_azko_remove(frm) {
		set_totals_from_items(frm);
	},
});
