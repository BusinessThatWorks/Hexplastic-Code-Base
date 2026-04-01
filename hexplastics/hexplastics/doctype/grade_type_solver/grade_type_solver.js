// Copyright (c) 2026, beetashoke chakraborty and contributors
// For license information, please see license.txt

frappe.ui.form.on("grade type solver", {
	bomgrade_solver(_frm) {
		frappe.confirm(
			"This will fill bom_name from BOM's custom_bom_name for all child table rows missing the grade. Continue?",
			() => {
				frappe.call({
					method: "hexplastics.hexplastics.doctype.grade_type_solver.grade_type_solver.solve_bom_grade",
					freeze: true,
					freeze_message: "Updating BOM grades...",
					callback(r) {
						frappe.msgprint(r.message);
					}
				});
			}
		);
	}
});
