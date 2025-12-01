// Copyright (c) 2025, beetashoke chakraborty and contributors
// For license information, please see license.txt

frappe.ui.form.on("Production Log Book", {
	bom: function (frm) {
		// When BOM field changes, fetch and populate BOM items
		if (frm.doc.bom) {
			// Clear existing rows in material_consumption table
			frm.clear_table("material_consumption");

			// Fetch BOM items from server
			frappe.call({
				method: "hexplastics.api.production_log_book.get_bom_items",
				args: {
					bom_name: frm.doc.bom,
				},
				callback: function (r) {
					if (r.message && r.message.length > 0) {
						// Track added item codes to prevent duplicates
						const added_items = new Set();

						// Add each BOM item to the child table
						r.message.forEach(function (item) {
							// Skip if item_code is already added (prevent duplicates)
							if (item.item_code && !added_items.has(item.item_code)) {
								let row = frm.add_child("material_consumption");

								// Set item_code using frappe.model.set_value to trigger auto-fetch
								// This will auto-fetch item_name, stock_uom, item_description from Item master
								frappe.model.set_value(
									row.doctype,
									row.name,
									"item_code",
									item.item_code
								);

								// Do NOT set 'issued' from BOM qty directly.
								// 'issued' will be computed based on qty_to_manufacture and BOM ratios.
								frappe.model.set_value(row.doctype, row.name, "issued", 0);

								// Set UOM from BOM if provided (will override auto-fetched value)
								if (item.uom) {
									frappe.model.set_value(
										row.doctype,
										row.name,
										"stock_uom",
										item.uom
									);
								}

								// Set description from BOM if provided (will override auto-fetched value)
								if (item.description) {
									frappe.model.set_value(
										row.doctype,
										row.name,
										"item_description",
										item.description
									);
								}

								// Mark item as added
								added_items.add(item.item_code);
							}
						});

						// Refresh the child table to show new rows
						frm.refresh_field("material_consumption");

						// After BOM items are loaded, recalculate issued if qty_to_manufacture is present
						recalculate_issued_for_material_consumption(frm);

						// Show success message
						frappe.show_alert(
							{
								message: __("{0} items added from BOM", [r.message.length]),
								indicator: "green",
							},
							3
						);
					} else {
						// No items found in BOM
						frm.refresh_field("material_consumption");
						frappe.show_alert(
							{
								message: __("No items found in selected BOM"),
								indicator: "orange",
							},
							3
						);
					}
				},
				error: function (r) {
					// Handle error
					frappe.msgprint({
						title: __("Error"),
						message: __("Failed to fetch BOM items. Please try again."),
						indicator: "red",
					});
					console.error("Error fetching BOM items:", r);
				},
			});
		} else {
			// If BOM is cleared, clear the child table and reset issued
			frm.clear_table("material_consumption");
			frm.refresh_field("material_consumption");
		}
	},

	// Trigger recalculation when qty_to_manufacture changes
	qty_to_manufacture: function (frm) {
		recalculate_issued_for_material_consumption(frm);
	},

	// On form refresh, re-run calculation for safety (e.g., when loading an existing doc)
	refresh: function (frm) {
		if (frm.doc.bom && frm.doc.qty_to_manufacture) {
			recalculate_issued_for_material_consumption(frm);
		}
	},
});

// Child table: Production Log Book Table
frappe.ui.form.on("Production Log Book Table", {
	// When item_code is changed manually, recompute issued
	item_code: function (frm, cdt, cdn) {
		recalculate_issued_for_material_consumption(frm);
	},
});

/**
 * Recalculate 'issued' for all rows in material_consumption child table.
 *
 * Logic:
 *   base = item_quantity_from_BOM_items / BOM_main_quantity
 *   issued = base * qty_to_manufacture
 *
 * If any required value is missing or invalid, issued is set to 0.
 * Division by zero is prevented by checking BOM_main_quantity > 0.
 */
function recalculate_issued_for_material_consumption(frm) {
	const bom = frm.doc.bom;
	const qty_to_manufacture = flt(frm.doc.qty_to_manufacture);

	// If essential inputs are missing, set issued = 0 for all rows and exit
	if (!bom || !qty_to_manufacture) {
		(frm.doc.material_consumption || []).forEach((row) => {
			frappe.model.set_value(row.doctype, row.name, "issued", 0);
		});
		return;
	}

	const rows = frm.doc.material_consumption || [];
	if (!rows.length) {
		return;
	}

	// Collect item codes in the child table
	const item_codes = rows.map((row) => row.item_code).filter((c) => !!c);

	if (!item_codes.length) {
		// No valid item codes; set issued = 0
		rows.forEach((row) => {
			frappe.model.set_value(row.doctype, row.name, "issued", 0);
		});
		return;
	}

	// Fetch BOM main quantity and BOM item quantities for the listed item codes
	frappe.call({
		method: "hexplastics.api.production_log_book.get_bom_item_quantities",
		args: {
			bom_name: bom,
			item_codes: item_codes,
		},
		freeze: false,
		callback: function (r) {
			const data = r.message || {};
			const bom_qty = flt(data.bom_qty);

			// Prepare a quick lookup for item quantities from BOM
			const qty_by_item = {};
			(data.items || []).forEach((item) => {
				if (item.item_code) {
					qty_by_item[item.item_code] = flt(item.qty);
				}
			});

			rows.forEach((row) => {
				const item_code = row.item_code;
				const bom_item_qty = qty_by_item[item_code] || 0;
				let issued = 0;

				// Compute only if both BOM main quantity and item quantity are valid
				if (bom_qty > 0 && bom_item_qty > 0 && qty_to_manufacture > 0) {
					const base = bom_item_qty / bom_qty; // safe: bom_qty > 0
					issued = base * qty_to_manufacture;
				}

				// If anything is missing or invalid, issued remains 0 as per requirement
				frappe.model.set_value(row.doctype, row.name, "issued", issued || 0);
			});

			frm.refresh_field("material_consumption");
		},
	});
}
