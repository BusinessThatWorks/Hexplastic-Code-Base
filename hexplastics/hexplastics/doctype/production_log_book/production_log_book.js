// Copyright (c) 2025, beetashoke chakraborty and contributors
// For license information, please see license.txt

frappe.ui.form.on("Production Log Book", {
	bom: function (frm) {
		// When BOM field changes, fetch and populate ONLY BOM Items
		// Clear cached main item code when BOM changes
		frm._bom_main_item_code = null;

		if (frm.doc.bom) {
			// Clear existing rows in material_consumption table
			frm.clear_table("material_consumption");

			// Fetch only BOM Items from server
			frappe.call({
				method: "hexplastics.api.production_log_book.get_bom_items_only",
				args: {
					bom_name: frm.doc.bom,
				},
				callback: function (r) {
					if (r.message && r.message.length > 0) {
						// Add BOM items to the child table
						add_items_to_table(frm, r.message);

						// Refresh the child table to show new rows
						frm.refresh_field("material_consumption");

						// After BOM items are loaded, recalculate issued if qty_to_manufacture is present
						recalculate_issued_for_material_consumption(frm);

						// Also recalculate consumption if manufactured_qty is present
						recalculate_consumption_for_material_consumption(frm);

						// Recalculate closing_stock for raw materials
						recalculate_closing_stock_for_raw_materials(frm);

						// If manufactured_qty is already filled, also fetch main item and scrap items
						if (frm.doc.manufactured_qty) {
							fetch_and_append_main_and_scrap_items(frm);
						}

						// Show success message
						frappe.show_alert(
							{
								message: __("{0} BOM items added", [r.message.length]),
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
			// If BOM is cleared, clear the child table and cached main item code
			frm.clear_table("material_consumption");
			frm.refresh_field("material_consumption");
			frm._bom_main_item_code = null;
		}
	},

	// Trigger recalculation when qty_to_manufacture changes
	qty_to_manufacture: function (frm) {
		recalculate_issued_for_material_consumption(frm);
		// closing_stock will be recalculated automatically via issued event handler
	},

	// Trigger recalculation when manufactured_qty changes
	manufactured_qty: function (frm) {
		// Recalculate consumption
		recalculate_consumption_for_material_consumption(frm);
		// closing_stock will be recalculated automatically via consumption event handler

		// If manufactured_qty is filled and BOM exists
		if (frm.doc.manufactured_qty && frm.doc.bom) {
			// Check if main item already exists in the table
			const rows = frm.doc.material_consumption || [];
			let main_item_exists = false;

			// Try to get main item code from cached value or check if any row might be main item
			if (frm._bom_main_item_code) {
				main_item_exists = rows.some((row) => row.item_code === frm._bom_main_item_code);
			}

			if (main_item_exists) {
				// Main item exists, just update its in_qty
				update_main_item_in_qty(frm);
			} else {
				// Main item doesn't exist, fetch and add it (along with scrap items)
				fetch_and_append_main_and_scrap_items(frm);
			}
		} else {
			// If manufactured_qty is cleared, update main item in_qty to 0 (if exists)
			update_main_item_in_qty(frm);
		}
	},

	// On form refresh, re-run calculation for safety (e.g., when loading an existing doc)
	refresh: function (frm) {
		if (frm.doc.bom && frm.doc.qty_to_manufacture) {
			recalculate_issued_for_material_consumption(frm);
		}

		if (frm.doc.bom && frm.doc.manufactured_qty) {
			recalculate_consumption_for_material_consumption(frm);
			// Ensure main item in_qty is updated if manufactured_qty exists
			update_main_item_in_qty(frm);
		}

		// Recalculate closing_stock for raw materials on form refresh
		recalculate_closing_stock_for_raw_materials(frm);
	},
});

// Child table: Production Log Book Table
frappe.ui.form.on("Production Log Book Table", {
	// When item_code is changed manually, recompute issued
	item_code: function (frm, cdt, cdn) {
		recalculate_issued_for_material_consumption(frm);
		recalculate_consumption_for_material_consumption(frm);
		// Recalculate closing_stock after item_code change
		recalculate_closing_stock_for_raw_materials(frm);
	},

	// When opp_in_plant changes, recalculate closing_stock for raw materials
	opp_in_plant: function (frm, cdt, cdn) {
		// Calculate closing_stock for the specific row if it's a raw material
		calculate_closing_stock_for_row(frm, cdt, cdn);
	},

	// When issued changes (auto-calculated), recalculate closing_stock for raw materials
	issued: function (frm, cdt, cdn) {
		// Calculate closing_stock for the specific row if it's a raw material
		calculate_closing_stock_for_row(frm, cdt, cdn);
	},

	// When consumption changes (auto-calculated or manual), recalculate closing_stock for raw materials
	consumption: function (frm, cdt, cdn) {
		// Calculate closing_stock for the specific row if it's a raw material
		calculate_closing_stock_for_row(frm, cdt, cdn);
	},
});

/**
 * Helper function to add items to the material_consumption child table.
 * Prevents duplicate entries based on item_code.
 * Auto-fills in_qty for main item with manufactured_qty value.
 *
 * @param {Object} frm - The form object
 * @param {Array} items - Array of item objects to add
 * @param {string} main_item_code - The main item code from BOM (optional)
 * @returns {number} - Number of items actually added (excluding duplicates)
 */
function add_items_to_table(frm, items, main_item_code = null) {
	if (!items || items.length === 0) {
		return 0;
	}

	// Get existing item codes in the table to prevent duplicates
	const existing_item_codes = new Set();
	(frm.doc.material_consumption || []).forEach((row) => {
		if (row.item_code) {
			existing_item_codes.add(row.item_code);
		}
	});

	let added_count = 0;
	const manufactured_qty = flt(frm.doc.manufactured_qty) || 0;

	// Add each item to the child table
	items.forEach(function (item) {
		// Skip if item_code is missing or already exists
		if (!item.item_code || existing_item_codes.has(item.item_code)) {
			return;
		}

		let row = frm.add_child("material_consumption");

		// Set item_code using frappe.model.set_value to trigger auto-fetch
		// This will auto-fetch item_name, stock_uom, item_description from Item master
		frappe.model.set_value(row.doctype, row.name, "item_code", item.item_code);

		// Do NOT set 'issued' from BOM qty directly.
		// 'issued' will be computed based on qty_to_manufacture and BOM ratios.
		frappe.model.set_value(row.doctype, row.name, "issued", 0);

		// Set UOM from BOM if provided (will override auto-fetched value)
		if (item.uom) {
			frappe.model.set_value(row.doctype, row.name, "stock_uom", item.uom);
		}

		// Set description from BOM if provided (will override auto-fetched value)
		if (item.description) {
			frappe.model.set_value(row.doctype, row.name, "item_description", item.description);
		}

		// Set item_type to distinguish BOM Item, Main Item, or Scrap Item
		if (item.item_type) {
			frappe.model.set_value(row.doctype, row.name, "item_type", item.item_type);
		}

		// Auto-fill in_qty for main item only with manufactured_qty
		// Check if this is the main item by comparing item_code
		if (main_item_code && item.item_code === main_item_code && manufactured_qty > 0) {
			frappe.model.set_value(row.doctype, row.name, "in_qty", manufactured_qty);
		}

		// Mark item as added
		existing_item_codes.add(item.item_code);
		added_count++;
	});

	return added_count;
}

/**
 * Fetch BOM main item and scrap items, then append them to the material_consumption table.
 * This is called when manufactured_qty is filled.
 * Auto-fills in_qty for main item with manufactured_qty value.
 *
 * @param {Object} frm - The form object
 */
function fetch_and_append_main_and_scrap_items(frm) {
	if (!frm.doc.bom) {
		return;
	}

	// Fetch main item and scrap items from server
	frappe.call({
		method: "hexplastics.api.production_log_book.get_bom_main_and_scrap_items",
		args: {
			bom_name: frm.doc.bom,
		},
		callback: function (r) {
			if (r.message && r.message.items && r.message.items.length > 0) {
				const main_item_code = r.message.main_item_code;
				const items = r.message.items;

				// Store main_item_code in form for later reference
				frm._bom_main_item_code = main_item_code;

				// Append items to the table (without removing existing BOM Items)
				// Pass main_item_code to auto-fill in_qty for main item
				const added_count = add_items_to_table(frm, items, main_item_code);

				// Refresh the child table to show new rows
				frm.refresh_field("material_consumption");

				// Recalculate consumption after adding new items
				recalculate_consumption_for_material_consumption(frm);

				// Recalculate closing_stock for raw materials
				recalculate_closing_stock_for_raw_materials(frm);

				// Show success message if items were added
				if (added_count > 0) {
					frappe.show_alert(
						{
							message: __("{0} item(s) added (main item and scrap items)", [
								added_count,
							]),
							indicator: "green",
						},
						3
					);
				}
			}
		},
		error: function (r) {
			// Handle error silently or show a message
			console.error("Error fetching BOM main and scrap items:", r);
		},
	});
}

/**
 * Update the in_qty field for the main item in Material Consumption Table
 * when manufactured_qty changes. Only updates the main item, not BOM items or scrap items.
 *
 * @param {Object} frm - The form object
 */
function update_main_item_in_qty(frm) {
	if (!frm.doc.bom) {
		return;
	}

	// Get the main item code from BOM
	// First try to get it from cached value, otherwise fetch from BOM
	if (!frm._bom_main_item_code) {
		frappe.call({
			method: "hexplastics.api.production_log_book.get_bom_main_and_scrap_items",
			args: {
				bom_name: frm.doc.bom,
			},
			callback: function (r) {
				if (r.message && r.message.main_item_code) {
					frm._bom_main_item_code = r.message.main_item_code;
					update_main_item_in_qty_in_table(frm, r.message.main_item_code);
				}
			},
		});
	} else {
		update_main_item_in_qty_in_table(frm, frm._bom_main_item_code);
	}
}

/**
 * Helper function to update in_qty for main item in the material_consumption table.
 *
 * @param {Object} frm - The form object
 * @param {string} main_item_code - The main item code from BOM
 */
function update_main_item_in_qty_in_table(frm, main_item_code) {
	if (!main_item_code) {
		return;
	}

	const manufactured_qty = flt(frm.doc.manufactured_qty) || 0;
	const rows = frm.doc.material_consumption || [];

	// Find the row with the main item code and update its in_qty
	let main_item_found = false;
	rows.forEach((row) => {
		if (row.item_code === main_item_code) {
			frappe.model.set_value(row.doctype, row.name, "in_qty", manufactured_qty);
			main_item_found = true;
		}
	});

	// If main item not found in table but manufactured_qty exists, fetch and add it
	if (!main_item_found && manufactured_qty > 0) {
		fetch_and_append_main_and_scrap_items(frm);
	} else if (main_item_found) {
		// Refresh the field to show updated in_qty
		frm.refresh_field("material_consumption");
	}
}

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

			// Recalculate closing_stock for raw materials after issued is updated
			recalculate_closing_stock_for_raw_materials(frm);
		},
	});
}

/**
 * Recalculate 'consumption' for all rows in material_consumption child table.
 *
 * Logic:
 *   base = item_quantity_from_BOM_items / BOM_main_quantity
 *   consumption = base * manufactured_qty
 *
 * If any required value is missing or invalid, consumption is set to 0.
 * Division by zero is prevented by checking BOM_main_quantity > 0.
 */
function recalculate_consumption_for_material_consumption(frm) {
	const bom = frm.doc.bom;
	const manufactured_qty = flt(frm.doc.manufactured_qty);

	// If essential inputs are missing, set consumption = 0 for all rows and exit
	if (!bom || !manufactured_qty) {
		(frm.doc.material_consumption || []).forEach((row) => {
			frappe.model.set_value(row.doctype, row.name, "consumption", 0);
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
		// No valid item codes; set consumption = 0
		rows.forEach((row) => {
			frappe.model.set_value(row.doctype, row.name, "consumption", 0);
		});
		return;
	}

	// Reuse the same server method that provides BOM main quantity and item quantities
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
				let consumption = 0;

				// Compute only if both BOM main quantity and item quantity are valid
				if (bom_qty > 0 && bom_item_qty > 0 && manufactured_qty > 0) {
					const base = bom_item_qty / bom_qty; // safe: bom_qty > 0
					consumption = base * manufactured_qty;
				}

				// If anything is missing or invalid, consumption remains 0 as per requirement
				frappe.model.set_value(row.doctype, row.name, "consumption", consumption || 0);
			});

			frm.refresh_field("material_consumption");

			// Recalculate closing_stock for raw materials after consumption is updated
			recalculate_closing_stock_for_raw_materials(frm);
		},
	});
}

/**
 * Check if a row represents a raw material.
 * A row is considered a raw material if item_type === "BOM Item".
 *
 * @param {Object} row - The child table row object
 * @returns {boolean} - True if the row is a raw material, false otherwise
 */
function is_raw_material(row) {
	return row && row.item_type === "BOM Item";
}

/**
 * Calculate closing_stock for a specific row if it's a raw material.
 * Formula: closing_stock = opp_in_plant + issued - consumption
 *
 * @param {Object} frm - The form object
 * @param {string} cdt - Child doctype name
 * @param {string} cdn - Child document name
 */
function calculate_closing_stock_for_row(frm, cdt, cdn) {
	const row = locals[cdt][cdn];
	if (!row) {
		return;
	}

	// Only calculate closing_stock for raw materials (BOM Items)
	if (!is_raw_material(row)) {
		// For non-raw materials, set closing_stock to 0 or leave it as is
		// You may want to clear it, but we'll leave it unchanged for now
		return;
	}

	// Get values, defaulting to 0 if undefined or null
	const opp_in_plant = flt(row.opp_in_plant) || 0;
	const issued = flt(row.issued) || 0;
	const consumption = flt(row.consumption) || 0;

	// Calculate closing_stock: opening_in_plant + issued - consumption
	const closing_stock = opp_in_plant + issued - consumption;

	// Update the closing_stock field
	frappe.model.set_value(cdt, cdn, "closing_stock", closing_stock);
}

/**
 * Recalculate closing_stock for all raw material rows in the material_consumption table.
 * Only applies to rows where item_type === "BOM Item".
 * Formula: closing_stock = opp_in_plant + issued - consumption
 *
 * @param {Object} frm - The form object
 */
function recalculate_closing_stock_for_raw_materials(frm) {
	const rows = frm.doc.material_consumption || [];
	if (!rows.length) {
		return;
	}

	// Calculate closing_stock for each raw material row
	rows.forEach((row) => {
		if (is_raw_material(row)) {
			// Get values, defaulting to 0 if undefined or null
			const opp_in_plant = flt(row.opp_in_plant) || 0;
			const issued = flt(row.issued) || 0;
			const consumption = flt(row.consumption) || 0;

			// Calculate closing_stock: opening_in_plant + issued - consumption
			const closing_stock = opp_in_plant + issued - consumption;

			// Update the closing_stock field
			frappe.model.set_value(row.doctype, row.name, "closing_stock", closing_stock);
		}
	});

	// Refresh the field to show updated values
	frm.refresh_field("material_consumption");
}
