// Copyright (c) 2026, beetashoke chakraborty and contributors
// For license information, please see license.txt

// Mirrors apply_derived_quantities in box_production.py

const PLANT_BALANCE_FIELDS = [
	"print_available_in_plant",
	"die_available_in_plant",
	"die_back_available_in_plant",
	"trim_available_in_plant",
	"trim_back_available_in_plant",
	"staple_available_in_plant",
	"staple_back_available_in_plant",
	"tape_available_in_plant",
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
	const front_in_area = cint_nonneg(d.in_area_checked);
	const front_rejected_for_dry = cint_nonneg(d.rejected_for_dry_problem);
	const front_rejected_for_printing = cint_nonneg(d.rejected_for_printing);
	const front_rejected_for_broken = cint_nonneg(d.rejected_for_broken);
	const back_in_area = cint_nonneg(d.back_rejected_by_in_area);
	const back_rejected_for_dry = cint_nonneg(d.back_rejected_for_dry_problem);
	const back_rejected_for_printing = cint_nonneg(d.back_rejected_for_printing);
	const back_rejected_for_broken = cint_nonneg(d.back_rejected_for_broken);
	const front = cint_nonneg(d.front_printed);
	const back = cint_nonneg(d.back_printed);

	// Transfer to clean sheet excludes "Rejected for Broken".
	const transfer_to_clean_sheet =
		front_in_area +
		front_rejected_for_dry +
		front_rejected_for_printing +
		back_in_area +
		back_rejected_for_dry +
		back_rejected_for_printing;
	const recv_printing_front = Math.max(
		0,
		front -
			(front_in_area +
				front_rejected_for_dry +
				front_rejected_for_printing +
				front_rejected_for_broken)
	);
	const recv_printing_back = Math.max(
		0,
		back -
			(back_in_area +
				back_rejected_for_dry +
				back_rejected_for_printing +
				back_rejected_for_broken)
	);

	const die_done = cint_nonneg(d.die_checked);
	const die_rej = cint_nonneg(d.die_rejected);
	const die_back_done = cint_nonneg(d.die_back_completed);
	const die_back_rej = cint_nonneg(d.back_rejected);
	const recv_die_front = Math.max(0, die_done - die_rej);
	const recv_die_back = Math.max(0, die_back_done - die_back_rej);

	const trim_done_front = cint_nonneg(d.trim_checked);
	const trim_done_back = cint_nonneg(d.trim_back);

	const staple_done_front = cint_nonneg(d.staple_checked);
	const staple_rej_front = cint_nonneg(d.staple_rejected);
	const staple_done_back = cint_nonneg(d.staple_back_completed);
	const staple_rej_back = cint_nonneg(d.staple_back_rejected);
	const net_staple_front = Math.max(0, staple_done_front - staple_rej_front);
	const net_staple_back = Math.max(0, staple_done_back - staple_rej_back);
	const box_produced = Math.min(net_staple_front, net_staple_back);

	Object.assign(d, {
		transfer_to_clean_sheet: transfer_to_clean_sheet,
		sheet_cleaning_qty: transfer_to_clean_sheet,
		received_from_printing_dept: recv_printing_front,
		back_received_from_printing_dept: recv_printing_back,
		received_from_die_punching_dept: recv_die_front,
		back_received_from_die_punching_dept: recv_die_back,
		received_from_trimming_dept: trim_done_front,
		staple_back_received_from_trimming_dept: trim_done_back,
		box_produced: box_produced,
		received_from_stapling_dept: box_produced,
	});

	frm.refresh_fields([
		"transfer_to_clean_sheet",
		"sheet_cleaning_qty",
		"received_from_printing_dept",
		"back_received_from_printing_dept",
		"received_from_die_punching_dept",
		"back_received_from_die_punching_dept",
		"received_from_trimming_dept",
		"staple_back_received_from_trimming_dept",
		"received_from_stapling_dept",
		"box_produced",
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
	"back_rejected_by_in_area",
	"front_printed",
	"back_printed",
	"rejected_for_dry_problem",
	"rejected_for_printing",
	"rejected_for_broken",
	"back_rejected_for_dry_problem",
	"back_rejected_for_printing",
	"back_rejected_for_broken",
	"die_checked",
	"die_rejected",
	"die_back_completed",
	"back_rejected",
	"trim_checked",
	"trim_back",
	"staple_checked",
	"staple_rejected",
	"staple_back_completed",
	"staple_back_rejected",
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
