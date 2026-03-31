// Copyright (c) 2026, beetashoke chakraborty and contributors
// For license information, please see license.txt

frappe.ui.form.on("Production log sheet solver", {
	pls_solver(_frm) {
		frappe.confirm(
			"This will migrate BOM data from old parent fields into the child table for all affected Production Log Sheets. Continue?",
			() => {
				frappe.call({
					method: "hexplastics.hexplastics.doctype.production_log_sheet_solver.production_log_sheet_solver.solve_production_log_sheets",
					freeze: true,
					freeze_message: "Migrating data...",
					callback(r) {
						frappe.msgprint(r.message);
					}
				});
			}
		);
	}
});
