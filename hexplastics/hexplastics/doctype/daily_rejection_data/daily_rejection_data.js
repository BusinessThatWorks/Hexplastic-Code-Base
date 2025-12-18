// Copyright (c) 2025, beetashoke chakraborty and contributors
// For license information, please see license.txt

// Parent Doctype: Daily Rejection Data
frappe.ui.form.on("Daily Rejection Data", {
	refresh(frm) {
		// Do not touch values on refresh.
		// Totals are kept in sync by field events (client) and validate (server).
	},

	// Parent-level rejection fields
	box_rejected_by_die_punching(frm) {
		if (frm.doc.docstatus === 1) return;
		recalculate_rejection_totals(frm);
	},

	box_rejected_by_printing(frm) {
		if (frm.doc.docstatus === 1) return;
		recalculate_rejection_totals(frm);
	},

	box_rejected_by_bending(frm) {
		if (frm.doc.docstatus === 1) return;
		recalculate_rejection_totals(frm);
	},

	box_rejected_by_stepling(frm) {
		if (frm.doc.docstatus === 1) return;
		recalculate_rejection_totals(frm);
	},

	box_rejected_by_dry_problem(frm) {
		if (frm.doc.docstatus === 1) return;
		recalculate_rejection_totals(frm);
	},

	// Total box checked on parent
	total_box_checked(frm) {
		if (frm.doc.docstatus === 1) return;
		recalculate_rejection_totals(frm);
	},

	// Optional parent-level shift_type (if present on this doctype)
	shift_type(frm) {
		if (frm.doc.docstatus === 1) return;
		recalculate_rejection_totals(frm);
	},
});

// Child table: Daily Rejection Data Table (actual child doctype)
// Linked via child table fieldname `table_zsze` on the parent.
frappe.ui.form.on("Daily Rejection Data Table", {
	// Any of the 5 rejection fields on a row
	box_rejected_by_die_punching(frm, cdt, cdn) {
		if (frm.doc.docstatus === 1) return;
		recalculate_rejection_totals(frm);
	},

	box_rejected_by_printing(frm, cdt, cdn) {
		if (frm.doc.docstatus === 1) return;
		recalculate_rejection_totals(frm);
	},

	box_rejected_by_bending(frm, cdt, cdn) {
		if (frm.doc.docstatus === 1) return;
		recalculate_rejection_totals(frm);
	},

	box_rejected_by_stepling(frm, cdt, cdn) {
		if (frm.doc.docstatus === 1) return;
		recalculate_rejection_totals(frm);
	},

	box_rejected_by_dry_problem(frm, cdt, cdn) {
		if (frm.doc.docstatus === 1) return;
		recalculate_rejection_totals(frm);
	},

	// Row-level shift type (Day / Night)
	shift_type(frm, cdt, cdn) {
		if (frm.doc.docstatus === 1) return;
		recalculate_rejection_totals(frm);
	},

	// Row add/remove hooks – work in both grid and row dialog
	table_zsze_add(frm) {
		if (frm.doc.docstatus === 1) return;
		recalculate_rejection_totals(frm);
	},

	table_zsze_remove(frm) {
		if (frm.doc.docstatus === 1) return;
		recalculate_rejection_totals(frm);
	},
});

/**
 * Central calculation function.
 *
 * Responsibilities:
 *  - Loop through child rows (if any)
 *  - Calculate row-level total
 *  - Calculate day shift total
 *  - Calculate night shift total
 *  - Calculate overall total
 *  - Fallback to parent-only fields if no child table exists
 *
 * Rules:
 *  - Treat empty / null as 0
 *  - Parent total fields are auto-calculated
 *  - Do NOT run when docstatus === 1 (submitted)
 */
function recalculate_rejection_totals(frm) {
	// Safety: never recalc on submitted docs to avoid "Not Saved" status
	if (frm.doc.docstatus === 1) {
		return;
	}

	// ---- Helper to coerce values to number, treating empty as 0 ----
	const num = (value) => {
		const v = typeof flt === "function" ? flt(value) : parseFloat(value);
		return isNaN(v) ? 0 : v;
	};

	let day_total = 0;
	let night_total = 0;
	let overall_total = 0;

	// ----------------------------------------------------------------
	// 1) Child-table based calculation (preferred, if child rows exist)
	// ----------------------------------------------------------------
	// Actual child table fieldname on parent: "table_zsze"
	// Assumed child doctype fields:
	//   - shift_type (Day / Night)
	//   - box_rejected_by_die_punching
	//   - box_rejected_by_printing
	//   - box_rejected_by_bending
	//   - box_rejected_by_stepling
	//   - box_rejected_by_dry_problem
	//   - row_total_rejection (computed)
	const rows = frm.doc.table_zsze || [];

	if (Array.isArray(rows) && rows.length > 0) {
		rows.forEach((row) => {
			const die_punch = num(row.box_rejected_by_die_punching);
			const printing = num(row.box_rejected_by_printing);
			const bending = num(row.box_rejected_by_bending);
			const stepling = num(row.box_rejected_by_stepling);
			const dry_problem = num(row.box_rejected_by_dry_problem);

			const row_total = die_punch + printing + bending + stepling + dry_problem;

			// Set row-level total (no handler bound on this field → no loop)
			if (row.doctype && row.name) {
				frappe.model.set_value(row.doctype, row.name, "row_total_rejection", row_total);
			}

			// Accumulate shift-wise totals
			if (row.shift_type === "Day") {
				day_total += row_total;
			} else if (row.shift_type === "Night") {
				night_total += row_total;
			}

			overall_total += row_total;
		});
	} else {
		// ----------------------------------------------------------------
		// 2) Fallback: parent-only fields (current structure)
		// ----------------------------------------------------------------
		const die_punch = num(frm.doc.box_rejected_by_die_punching);
		const printing = num(frm.doc.box_rejected_by_printing);
		const bending = num(frm.doc.box_rejected_by_bending);
		const stepling = num(frm.doc.box_rejected_by_stepling);
		const dry_problem = num(frm.doc.box_rejected_by_dry_problem);

		overall_total = die_punch + printing + bending + stepling + dry_problem;

		// If there is a parent-level shift_type, allocate to that shift
		if (frm.doc.shift_type === "Day") {
			day_total = overall_total;
		} else if (frm.doc.shift_type === "Night") {
			night_total = overall_total;
		}
	}

	// --------------------------------------------------------------
	// 3) Push totals back to parent (auto-calculated / read-only)
	// --------------------------------------------------------------
	// These fieldnames are assumptions; adjust to match your DocType:
	//  - total_rejected_in_day_shift
	//  - total_rejected_in_night_shift
	//  - total_rejection (overall)

	frm.set_value("total_rejected_in_day_shift", day_total);
	frm.set_value("total_rejected_in_night_shift", night_total);
	frm.set_value("total_rejection", overall_total);

	// --------------------------------------------------------------
	// 4) Rejection percentage based on total_box_checked
	// --------------------------------------------------------------
	const total_box_checked = num(frm.doc.total_box_checked);
	let rejection_percentage = 0;
	if (total_box_checked > 0) {
		rejection_percentage = (overall_total / total_box_checked) * 100;
	}

	frm.set_value("rejection_in_", rejection_percentage);
}
