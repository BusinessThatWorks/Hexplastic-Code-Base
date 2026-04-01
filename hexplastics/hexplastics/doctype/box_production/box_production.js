// Copyright (c) 2026, beetashoke chakraborty and contributors
// For license information, please see license.txt

// Mirrors apply_derived_quantities in box_production.py

const PLANT_BALANCE_FIELDS = [
	"print_available_in_plant",
	"die_available_in_plant",
	"trim_available_in_plant",
	"staple_available_in_plant",
	"tape_available_in_plant",
	"sticker_available_in_plant",
];

const CARRY_FORWARD_METHOD =
	"hexplastics.hexplastics.doctype.box_production.box_production.get_plant_balance_carry_forward";

function cint(value) {
	const n = parseInt(value, 10);
	return Number.isFinite(n) ? n : 0;
}

function cint_nonneg(value) {
	return Math.max(0, cint(value));
}

function apply_derived_box_production_quantities(frm) {
	const d = frm.doc;
	const in_area = cint_nonneg(d.in_area_checked);
	const front = cint_nonneg(d.front_printed);
	const back = cint_nonneg(d.back_printed);
	const printing_rejects =
		in_area +
		cint_nonneg(d.rejected_for_dry_problem) +
		cint_nonneg(d.rejected_for_printing) +
		cint_nonneg(d.rejected_for_broken);
	const recv_printing = Math.max(0, front + back - printing_rejects);

	const die_done = cint_nonneg(d.die_checked);
	const die_rej = cint_nonneg(d.die_rejected);
	const recv_die = Math.max(0, die_done - die_rej);

	const trim_done = cint_nonneg(d.trim_checked);

	const staple_done = cint_nonneg(d.staple_checked);
	const staple_rej = cint_nonneg(d.staple_rejected);
	const box_produced = Math.max(0, staple_done - staple_rej) / 2;

	const tape_done = cint_nonneg(d.tape_checked);
	const tape_rej = cint_nonneg(d.tape_rejected);
	const recv_tape = Math.max(0, tape_done - tape_rej);

	const sticker_done = cint_nonneg(d.sticker_checked);
	const sticker_rej = cint_nonneg(d.sticker_rejected);
	const total_fg = Math.max(0, sticker_done - sticker_rej);

	Object.assign(d, {
		transfer_to_clean_sheet: in_area,
		sheet_cleaning_qty: in_area,
		received_from_printing_dept: recv_printing,
		received_from_die_punching_dept: recv_die,
		received_from_trimming_dept: trim_done,
		box_produced: Math.floor(box_produced),
		received_from_stapling_dept: Math.floor(box_produced),
		received_from_taping_dept: recv_tape,
		total_box_produced: total_fg,
	});

	frm.refresh_fields([
		"transfer_to_clean_sheet",
		"sheet_cleaning_qty",
		"received_from_printing_dept",
		"received_from_die_punching_dept",
		"received_from_trimming_dept",
		"received_from_stapling_dept",
		"box_produced",
		"received_from_taping_dept",
		"total_box_produced",
	]);
}

function plant_carry_forward_cache_key(frm) {
	const d = frm.doc;
	return `${d.production_date || ""}:${d.shift_type || ""}`;
}

function load_plant_balance_carry_forward(frm) {
	if (!frm.is_new() || frm.doc.amended_from) {
		return;
	}
	const d = frm.doc;
	if (!d.production_date || !d.shift_type) {
		return;
	}
	const key = plant_carry_forward_cache_key(frm);
	if (frm._plant_carry_forward_key === key) {
		return;
	}
	frm._plant_carry_forward_key = key;

	frappe.call({
		method: CARRY_FORWARD_METHOD,
		args: {
			production_date: d.production_date,
			shift_type: d.shift_type,
		},
		callback(r) {
			if (!r.message) {
				return;
			}
			Object.assign(frm.doc, r.message);
			frm.refresh_fields(PLANT_BALANCE_FIELDS);
			apply_derived_box_production_quantities(frm);
		},
	});
}

const DERIVATION_SOURCE_FIELDS = [
	"in_area_checked",
	"front_printed",
	"back_printed",
	"rejected_for_dry_problem",
	"rejected_for_printing",
	"rejected_for_broken",
	"die_checked",
	"die_rejected",
	"trim_checked",
	"staple_checked",
	"staple_rejected",
	"tape_checked",
	"tape_rejected",
	"sticker_checked",
	"sticker_rejected",
];

frappe.ui.form.on("Box Production", {
	refresh(frm) {
		load_plant_balance_carry_forward(frm);
		apply_derived_box_production_quantities(frm);
	},
	production_date(frm) {
		frm._plant_carry_forward_key = null;
		load_plant_balance_carry_forward(frm);
		apply_derived_box_production_quantities(frm);
	},
	shift_type(frm) {
		frm._plant_carry_forward_key = null;
		load_plant_balance_carry_forward(frm);
		apply_derived_box_production_quantities(frm);
	},
});

DERIVATION_SOURCE_FIELDS.forEach((fieldname) => {
	frappe.ui.form.on("Box Production", fieldname, (frm) => {
		apply_derived_box_production_quantities(frm);
	});
});
