// Copyright (c) 2026, beetashoke chakraborty and contributors
// For license information, please see license.txt

frappe.ui.form.on("Production Log Sheet", {
	refresh(frm) {
		// Set up BOM filter based on Production Plan
		setup_bom_filter(frm);

		// Avoid mutating already-saved docs on refresh; it can incorrectly keep form dirty.
		// Recalculations/autofill still run during field change events and explicit user actions.
		const can_mutate_on_refresh = frm.is_new() || !!frm.doc.__unsaved;
		if (can_mutate_on_refresh) {
			// Calculate total RM consumption on refresh
			calculate_total_rm_consumption(frm);

			// Calculate closing qty for MIP on refresh
			calculate_closing_qty_for_mip(frm);

			// Calculate total production weight after form fully renders
			setTimeout(function() {
				calculate_total_production_weight(frm);
			}, 500);

			// Auto-fill avl_in_plant on refresh if date and shift are set
			if (frm.doc.production_date && frm.doc.shift_type) {
				fill_avl_in_plant_for_items(frm);
			}
		}

		// Initialize manual edit tracking for opening_qty_for_mip.
		// If the document already has a value, treat it as user-provided and do not auto-override.
		if (frm.doc.docstatus !== 1) {
			frm._opening_mip_manually_edited = !!frm.doc.opening_qty_for_mip;
		}
	},

	production_plan(frm) {
		// Initialize cached BOMs list
		if (!frm._production_plan_boms) {
			frm._production_plan_boms = [];
		}
		
		// Update BOM filter when Production Plan changes
		if (frm.doc.production_plan) {
			// Fetch BOMs from Production Plan and cache them
			fetch_and_cache_production_plan_boms(frm);
		} else {
			// Clear cached BOMs when Production Plan is cleared
			frm._production_plan_boms = [];
			setup_bom_filter(frm);

			// Clear BOM selection inside Finished Good Details when Production Plan is cleared.
			// The old logic cleared header `bom`, now moved to child `table_foun`.
			(frm.doc.table_foun || []).forEach(function(row) {
				frappe.model.set_value(row.doctype, row.name, "bom", "");
			});
			frm.refresh_field("table_foun");
		}
	},

	production_date(frm) {
		// Auto-fill avl_in_plant when production date changes
		if (frm.doc.production_date && frm.doc.shift_type) {
			fill_avl_in_plant_for_items(frm);
		}

		// Auto-fill opening_qty_for_mip when production date changes
		maybe_set_opening_qty_for_mip(frm);
	},

	shift_type(frm) {
		// Auto-fill avl_in_plant when shift type changes
		if (frm.doc.production_date && frm.doc.shift_type) {
			fill_avl_in_plant_for_items(frm);
		}

		// Auto-fill opening_qty_for_mip when shift type changes
		maybe_set_opening_qty_for_mip(frm);
	},

	gross_weight(frm) {
		// Recalculate net_weight when gross_weight changes
		calculate_net_weight(frm);
		// Recalculate closing_qty_for_mip since net_weight changes
		calculate_closing_qty_for_mip(frm);
		// Recalculate total_production_weight since net_weight changes
		calculate_total_production_weight(frm);
	},

	weight_of_fabric_packing(frm) {
		// Recalculate net_weight when weight_of_fabric_packing changes
		calculate_net_weight(frm);
		// Recalculate closing_qty_for_mip since net_weight changes
		calculate_closing_qty_for_mip(frm);
		// Recalculate total_production_weight since net_weight changes
		calculate_total_production_weight(frm);
	},

	manufactured_qty(frm) {
		// Update manufactured_qty in Production Details table when main form manufactured_qty changes
		update_production_details_manufactured_qty(frm);
	},

	bom(frm) {
		// When BOM is selected, fetch and populate raw material items and manufacturing item
		if (frm.doc.bom) {
			// Clear existing rows in raw_material_consumption table
			frm.clear_table("raw_material_consumption");
			
			// Clear only BOM-generated rows in production_details table, preserve manually added items (like MIP items)
			// Identify rows that were NOT manually added (they have no manual_entry flag)
			const rows_to_keep = [];
			(frm.doc.production_details || []).forEach(function(row) {
				// Keep rows that were manually added (marked with manual_entry = 1)
				if (row.manual_entry === 1 || row.manual_entry === "1" || row.manual_entry === true) {
					rows_to_keep.push({
						item_code: row.item_code,
						item_name: row.item_name,
						target_warehouse: row.target_warehouse,
						manufactured_qty: row.manufactured_qty,
						stock_uom: row.stock_uom,
						manual_entry: 1
					});
				}
			});
			
			// Clear production_details table
			frm.clear_table("production_details");
			
			// Restore manually added rows
			rows_to_keep.forEach(function(row_data) {
				let new_row = frm.add_child("production_details");
				new_row.item_code = row_data.item_code;
				new_row.item_name = row_data.item_name;
				new_row.target_warehouse = row_data.target_warehouse;
				new_row.manufactured_qty = row_data.manufactured_qty;
				new_row.stock_uom = row_data.stock_uom;
				new_row.manual_entry = 1;
			});
			
			// Fetch BOM items from server
			frappe.call({
				method: "hexplastics.api.production_log_book.get_bom_items_only",
				args: {
					bom_name: frm.doc.bom
				},
				callback: function(r) {
					if (r.message && r.message.length > 0) {
						// Add BOM items to the child table
						add_bom_items_to_table(frm, r.message);
						
						// Refresh the child table to show new rows
						frm.refresh_field("raw_material_consumption");
						
						// Recalculate total RM consumption after adding rows
						calculate_total_rm_consumption(frm);
						
						// Auto-fill avl_in_plant after adding BOM items
						if (frm.doc.production_date && frm.doc.shift_type) {
							fill_avl_in_plant_for_items(frm);
						}
					}
				}
			});
			
			// Fetch manufacturing item (main item) from BOM
			fetch_and_add_manufacturing_item(frm);
		} else {
			// Clear raw_material_consumption table if BOM is cleared
			frm.clear_table("raw_material_consumption");
			frm.refresh_field("raw_material_consumption");
			
			// For production_details, preserve manually added items (like MIP items)
			const manual_rows_to_keep = [];
			(frm.doc.production_details || []).forEach(function(row) {
				// Keep rows that were manually added (marked with manual_entry = 1)
				if (row.manual_entry === 1 || row.manual_entry === "1" || row.manual_entry === true) {
					manual_rows_to_keep.push({
						item_code: row.item_code,
						item_name: row.item_name,
						target_warehouse: row.target_warehouse,
						manufactured_qty: row.manufactured_qty,
						stock_uom: row.stock_uom,
						manual_entry: 1
					});
				}
			});
			
			// Clear production_details table
			frm.clear_table("production_details");
			
			// Restore manually added rows
			manual_rows_to_keep.forEach(function(row_data) {
				let new_row = frm.add_child("production_details");
				new_row.item_code = row_data.item_code;
				new_row.item_name = row_data.item_name;
				new_row.target_warehouse = row_data.target_warehouse;
				new_row.manufactured_qty = row_data.manufactured_qty;
				new_row.stock_uom = row_data.stock_uom;
				new_row.manual_entry = 1;
			});
			
			frm.refresh_field("production_details");
			
			// Recalculate total RM consumption (should be 0 after clearing)
			calculate_total_rm_consumption(frm);
		}
	},

	// When a row is added to raw_material_consumption table
	raw_material_consumption_add(frm) {
		// Recalculate total RM consumption
		// Note: calculate_total_rm_consumption will also trigger calculate_closing_qty_for_mip
		calculate_total_rm_consumption(frm);
		
		// Auto-fill avl_in_plant for the newly added row
		if (frm.doc.production_date && frm.doc.shift_type) {
			// Use a small delay to ensure the row is fully added
			setTimeout(function() {
				fill_avl_in_plant_for_items(frm);
			}, 100);
		}
	},

	// When a row is removed from raw_material_consumption table
	raw_material_consumption_remove(frm) {
		// Recalculate total RM consumption
		calculate_total_rm_consumption(frm);
		// Recalculate closing_qty_for_mip since total_rm_consumption changes
		calculate_closing_qty_for_mip(frm);
	},

	// When total_rm_consumption changes (manually or via calculation)
	total_rm_consumption(frm) {
		// Recalculate closing_qty_for_mip
		calculate_closing_qty_for_mip(frm);
	},

	// When process_loss_weight changes
	process_loss_weight(frm) {
		// Recalculate closing_qty_for_mip
		calculate_closing_qty_for_mip(frm);
	},

	// Track manual edits for opening_qty_for_mip so auto-logic does not override user input
	opening_qty_for_mip(frm) {
		if (frm.doc.docstatus !== 1) {
			frm._opening_mip_manually_edited = true;
		}
	},

	// When operator_id is selected, fetch and populate ONLY operator_name
	operator_id(frm) {
		if (frm.doc.operator_id) {
			// Fetch employee name from Employee doctype
			frappe.db.get_value("Employee", { name: frm.doc.operator_id }, "employee_name", function(r) {
				if (r && r.employee_name) {
					// Update ONLY operator_name, do NOT touch supervisor_name
					frm.set_value("operator_name", r.employee_name);
				} else {
					// Clear operator_name if employee not found
					frm.set_value("operator_name", "");
				}
			});
		} else {
			// Clear operator_name when operator_id is cleared
			frm.set_value("operator_name", "");
		}
	},

	// When supervisor_id is selected, fetch and populate ONLY supervisor_name
	supervisor_id(frm) {
		if (frm.doc.supervisor_id) {
			// Fetch employee name from Employee doctype
			frappe.db.get_value("Employee", { name: frm.doc.supervisor_id }, "employee_name", function(r) {
				if (r && r.employee_name) {
					// Update ONLY supervisor_name, do NOT touch operator_name
					frm.set_value("supervisor_name", r.employee_name);
				} else {
					// Clear supervisor_name if employee not found
					frm.set_value("supervisor_name", "");
				}
			});
		} else {
			// Clear supervisor_name when supervisor_id is cleared
			frm.set_value("supervisor_name", "");
		}
	}
});

/**
 * Setup set_query filter on BOM field based on selected Production Plan
 * @param {Object} frm - The form object
 */
function setup_bom_filter(frm) {
	// The `bom` field is now inside the child table `table_foun`.
	frm.set_query("bom", "table_foun", function() {
		// If Production Plan is selected and we have cached BOMs, filter to only those BOMs
		if (frm.doc.production_plan && frm._production_plan_boms && frm._production_plan_boms.length > 0) {
			return {
				filters: {
					name: ["in", frm._production_plan_boms]
				}
			};
		}
		
		// If Production Plan is not selected, return empty filters (show all BOMs)
		return {};
	});
}

/**
 * Fetch BOMs from Production Plan Item child table and cache them
 * @param {Object} frm - The form object
 */
function fetch_and_cache_production_plan_boms(frm) {
	if (!frm.doc.production_plan) {
		frm._production_plan_boms = [];
		return;
	}
	
	// Fetch BOMs from Production Plan using API endpoint
	frappe.call({
		method: "hexplastics.api.production_log_book.get_boms_from_production_plan",
		args: {
			production_plan: frm.doc.production_plan
		},
		callback: function(r) {
			if (r.message && Array.isArray(r.message)) {
				// Cache the BOM list
				frm._production_plan_boms = r.message;
				
				// Update the BOM filter after caching
				setup_bom_filter(frm);
			} else {
				// If no BOMs found, clear the cache
				frm._production_plan_boms = [];
				setup_bom_filter(frm);
			}
		}
	});
}

/**
 * Calculate net_weight from gross_weight and weight_of_fabric_packing
 * Formula: net_weight = gross_weight - weight_of_fabric_packing
 * Safely handles empty, null, undefined, or invalid values
 * @param {Object} frm - The form object
 */
function calculate_net_weight(frm) {
	// Safely parse values, treating null/undefined/empty string as 0
	let gross_weight = flt(frm.doc.gross_weight) || 0;
	let weight_of_fabric_packing = flt(frm.doc.weight_of_fabric_packing) || 0;
	
	// Calculate net_weight
	let net_weight = gross_weight - weight_of_fabric_packing;
	
	// Ensure non-negative result (or set to 0 if calculation results in negative)
	net_weight = Math.max(0, net_weight);
	
	// Round to 4 decimal places to match field precision and prevent floating-point drift
	net_weight = Math.round(net_weight * 10000) / 10000;
	
	// Update the field value (only if it's different to avoid unnecessary triggers)
	if (flt(frm.doc.net_weight) !== net_weight) {
		frm.set_value("net_weight", net_weight);
		// Note: closing_qty_for_mip will be recalculated by the gross_weight/weight_of_fabric_packing handlers
	}
}

/**
 * Update manufactured_qty in production_details table from Finished Good Details.
 *
 * Multi-row aware: builds a map of manufacturing_item → SUM(manufactured_qty)
 * from all FG rows, then applies matching quantities to non-manual
 * production_details rows.
 *
 * @param {Object} frm - The form object
 */
function update_production_details_manufactured_qty(frm) {
	if (!frm.doc.production_details || frm.doc.production_details.length === 0) {
		return;
	}

	const fg_details = frm.doc.table_foun || [];

	if (fg_details.length === 0) {
		// Legacy fallback: no FG rows → use parent field (if it exists)
		const manufactured_qty = flt(frm.doc.manufactured_qty) || 0;
		frm.doc.production_details.forEach(function(row) {
			if (row.item_code) {
				frappe.model.set_value(row.doctype, row.name, "manufactured_qty", manufactured_qty);
			}
		});
		frm.refresh_field("production_details");
		return;
	}

	// Build map: manufacturing_item → total manufactured_qty from FG rows
	const item_qty_map = {};
	fg_details.forEach(function(fg_row) {
		if (fg_row.manufacturing_item) {
			const item = fg_row.manufacturing_item;
			item_qty_map[item] = (item_qty_map[item] || 0) + (flt(fg_row.manufactured_qty) || 0);
		}
	});

	// Update non-manual production_details rows
	let changed = false;
	frm.doc.production_details.forEach(function(pd_row) {
		// Skip manual rows
		if (pd_row.manual_entry === 1 || pd_row.manual_entry === "1" || pd_row.manual_entry === true) {
			return;
		}
		if (pd_row.item_code && item_qty_map.hasOwnProperty(pd_row.item_code)) {
			const new_qty = item_qty_map[pd_row.item_code];
			if (flt(pd_row.manufactured_qty) !== new_qty) {
				frappe.model.set_value(pd_row.doctype, pd_row.name, "manufactured_qty", new_qty);
				changed = true;
			}
		}
	});

	if (changed) {
		frm.refresh_field("production_details");
	}
}

/**
 * Fetch manufacturing item from BOM and add it to production_details table
 * @param {Object} frm - The form object
 */
function fetch_and_add_manufacturing_item(frm, bom_name) {
	const bom_to_use =
		bom_name ||
		frm.doc.bom ||
		(frm.doc.table_foun && frm.doc.table_foun[0] && frm.doc.table_foun[0].bom) ||
		null;
	if (!bom_to_use) return;

	// `manufactured_qty` was moved to Finished Good Details (table_foun).
	const fg_details = frm.doc.table_foun || [];
	const manufactured_qty_val =
		(fg_details.length > 0 ? flt(fg_details[0].manufactured_qty) : 0) ||
		flt(frm.doc.manufactured_qty) ||
		0;
	
	// Fetch BOM document to get manufacturing item
	frappe.call({
		method: "frappe.client.get",
		args: {
			doctype: "BOM",
			name: bom_to_use
		},
		callback: function(r) {
			if (r.message && r.message.item) {
				const manufacturing_item_code = r.message.item;
				
				// Populate the moved `manufacturing_item` field in Finished Good Details.
				(frm.doc.table_foun || []).forEach(function(fg_row) {
					// Field is read_only, but programmatic set should still work for defaults.
					frappe.model.set_value(
						fg_row.doctype,
						fg_row.name,
						"manufacturing_item",
						manufacturing_item_code
					);
				});

				// Get item details
				frappe.call({
					method: "frappe.client.get",
					args: {
						doctype: "Item",
						name: manufacturing_item_code
					},
					callback: function(item_r) {
						if (item_r.message) {
							// Add manufacturing item to production_details table
							let row = frm.add_child("production_details");
							
							// Set item_code - this will auto-fetch item_name and stock_uom via fetch_from
							frappe.model.set_value(row.doctype, row.name, "item_code", manufacturing_item_code);
							
							// Explicitly set item_name if available
							if (item_r.message.item_name) {
								frappe.model.set_value(row.doctype, row.name, "item_name", item_r.message.item_name);
							}
							
							// Set default target_warehouse if not already set
							if (!row.target_warehouse) {
								frappe.model.set_value(row.doctype, row.name, "target_warehouse", "Finished Goods - HEX");
							}
							
							// Set manufactured_qty from moved field.
							frappe.model.set_value(
								row.doctype,
								row.name,
								"manufactured_qty",
								manufactured_qty_val
							);
							
							// Refresh the child table to show new row
							frm.refresh_field("production_details");

							// Recalculate total_production_weight after new row is added
							calculate_total_production_weight(frm);
						}
					}
				});
			}
		}
	});
}

/**
 * Add BOM items to the raw_material_consumption child table
 * @param {Object} frm - The form object
 * @param {Array} items - Array of BOM items from API (item_code, qty, uom, description, item_name)
 */
function add_bom_items_to_table(frm, items) {
	if (!items || items.length === 0) {
		return;
	}
	
	// Track existing item codes to avoid duplicates
	const existing_item_codes = new Set();
	(frm.doc.raw_material_consumption || []).forEach((row) => {
		if (row.item_code) {
			existing_item_codes.add(row.item_code);
		}
	});
	
	// Add each BOM item to the child table
	items.forEach(function(item) {
		// Skip if item_code is missing or already exists
		if (!item.item_code || existing_item_codes.has(item.item_code)) {
			return;
		}
		
		let row = frm.add_child("raw_material_consumption");
		
		// Set item_code - this will auto-fetch item_name and stock_uom via fetch_from
		frappe.model.set_value(row.doctype, row.name, "item_code", item.item_code);
		
		// Explicitly set item_name if available from BOM item data
		if (item.item_name) {
			frappe.model.set_value(row.doctype, row.name, "item_name", item.item_name);
		}
		
		// Set UOM from BOM if provided (will override auto-fetched value)
		if (item.uom) {
			frappe.model.set_value(row.doctype, row.name, "stock_uom", item.uom);
		}
		
		// Note: issued column is left blank for manual entry by user
		
		// Set default source_warehouse if not already set
		if (!row.source_warehouse) {
			frappe.model.set_value(row.doctype, row.name, "source_warehouse", "Production - Hex");
		}
		
		// Mark item as added to prevent duplicates
		existing_item_codes.add(item.item_code);
	});
}

/**
 * Calculate total_rm_consumption as the sum of consumption values from raw_material_consumption table
 * Updates the field in real time
 * @param {Object} frm - The form object
 */
function calculate_total_rm_consumption(frm) {
	if (!frm.doc.raw_material_consumption || frm.doc.raw_material_consumption.length === 0) {
		// If table is empty, set total to 0
		set_form_value_if_changed(frm, "total_rm_consumption", 0);
		// Trigger recalculation of closing_qty_for_mip
		calculate_closing_qty_for_mip(frm);
		return;
	}
	
	// Sum all consumption values from the child table
	let total = 0;
	frm.doc.raw_material_consumption.forEach(function(row) {
		// Safely parse consumption value, treating null/undefined/empty as 0
		const consumption = flt(row.consumption) || 0;
		total += consumption;
	});
	
	// Round to 4 decimal places to match field precision and prevent floating-point drift
	total = Math.round(total * 10000) / 10000;
	
	// Update the total_rm_consumption field
	set_form_value_if_changed(frm, "total_rm_consumption", total);
	// Trigger recalculation of closing_qty_for_mip
	calculate_closing_qty_for_mip(frm);
}

/**
 * Calculate closing_qty_for_mip using the formula:
 * closing_qty_for_mip = total_rm_consumption - net_weight - process_loss_weight
 * Updates the field in real time
 * @param {Object} frm - The form object
 */
function calculate_closing_qty_for_mip(frm) {
	// Safely parse all values, treating null/undefined/empty as 0
	const total_rm_consumption = flt(frm.doc.total_rm_consumption) || 0;
	// `net_weight` was moved to `Finished Good Details` (child table: table_foun).
	// Use summed child net_weight when present, otherwise fallback to legacy parent field.
	const fg_details = frm.doc.table_foun || [];
	const net_weight =
		fg_details.length > 0
			? fg_details.reduce(function (acc, row) {
					return acc + (flt(row.net_weight) || 0);
				}, 0)
			: flt(frm.doc.net_weight) || 0;
	const process_loss_weight = flt(frm.doc.process_loss_weight) || 0;
	
	// Calculate closing_qty_for_mip
	// Formula: total_rm_consumption - net_weight - process_loss_weight
	let closing_qty = total_rm_consumption - net_weight - process_loss_weight;
	
	// Round to 4 decimal places to match field precision and prevent floating-point drift
	closing_qty = Math.round(closing_qty * 10000) / 10000;
	
	// Update the closing_qty_for_mip field
	set_form_value_if_changed(frm, "closing_qty_for_mip", closing_qty);
}

/**
 * Decide whether the system is allowed to auto-set opening_qty_for_mip.
 *
 * Rules:
 * - Never auto-set on submitted documents.
 * - Never auto-override if the user has manually edited opening_qty_for_mip.
 * - Only auto-set when the current value is empty/null/undefined.
 *
 * @param {Object} frm - The form object
 * @returns {boolean}
 */
function should_auto_set_opening_mip(frm) {
	// Do not touch submitted records
	if (frm.doc.docstatus === 1) {
		return false;
	}

	// Respect manual edits
	if (frm._opening_mip_manually_edited) {
		return false;
	}

	// Allow auto-set only when value is effectively empty
	const current = frm.doc.opening_qty_for_mip;
	return current === null || current === undefined || current === "" ;
}

/**
 * Auto-populate opening_qty_for_mip using previous Production Log Sheet
 * closing_qty_for_mip based on shift/date continuity logic.
 *
 * This mirrors the avl_in_plant shift logic:
 * - For Night shift: same date Day → previous dates (Night then Day)
 * - For Day shift: previous dates (Night then Day)
 *
 * It:
 * - Runs when date/shift are selected.
 * - Does NOT override if user manually edited opening_qty_for_mip.
 * - Never modifies submitted records.
 *
 * @param {Object} frm - The form object
 */
function maybe_set_opening_qty_for_mip(frm) {
	// Require date and shift
	if (!frm.doc.production_date || !frm.doc.shift_type) {
		return;
	}

	if (!should_auto_set_opening_mip(frm)) {
		return;
	}

	frappe.call({
		method: "hexplastics.api.production_log_book.get_previous_mip_opening_qty_production_log_sheet",
		args: {
			current_date: frm.doc.production_date,
			current_shift: frm.doc.shift_type,
			exclude_docname: frm.doc.name || null,
		},
		callback: function (r) {
			// Re-check conditions to avoid race conditions or late overrides
			if (!should_auto_set_opening_mip(frm)) {
				return;
			}

			if (r && typeof r.message !== "undefined" && r.message !== null) {
				const opening_qty = flt(r.message) || 0;
				set_form_value_if_changed(frm, "opening_qty_for_mip", opening_qty);
			}
		},
		error: function (err) {
			// Log but don't interrupt user flow
			console.error("Error fetching MIP opening quantity for Production Log Sheet:", err);
		},
	});
}

// Handle child table field changes for Production Log Sheet Table
// Note: In Frappe, when handling child table events, 'frm' refers to the parent form
frappe.ui.form.on("Production Log Sheet Table", {
	// When avl_in_plant value changes in any row
	avl_in_plant(frm, cdt, cdn) {
		// Recalculate closing_stock for this row
		calculate_closing_stock(frm, cdt, cdn);
	},
	
	// When issued value changes in any row
	issued(frm, cdt, cdn) {
		// Recalculate closing_stock for this row
		calculate_closing_stock(frm, cdt, cdn);
	},
	
	// When consumption value changes in any row
	consumption(frm, cdt, cdn) {
		// Recalculate total RM consumption
		// frm here is the parent form (Production Log Sheet)
		calculate_total_rm_consumption(frm);
		
		// Recalculate closing_stock for this row
		calculate_closing_stock(frm, cdt, cdn);
	},

	// When item_code is set in a row, auto-fill avl_in_plant if date and shift are available
	item_code(frm, cdt, cdn) {
		// Auto-fill avl_in_plant when item_code is set
		if (frm.doc.production_date && frm.doc.shift_type) {
			// Use a small delay to ensure item_code is fully set
			setTimeout(function() {
				fill_avl_in_plant_for_items(frm);
			}, 100);
		}
	}
});

// Handle child table field changes for Production Log Sheet FG Table (Production Details)
// This enables manual item addition including MIP items
frappe.ui.form.on("Production Log Sheet FG Table", {
	// When a row is manually added, mark it as manual entry
	production_details_add(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (row) {
			// Mark this row as manually added so it won't be cleared when BOM changes
			frappe.model.set_value(cdt, cdn, "manual_entry", 1);
		}
	},

	// When item_code is set in a row, auto-fetch item details
	item_code(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (!row || !row.item_code) {
			return;
		}

		// Fetch item details from Item master
		frappe.db.get_value("Item", { name: row.item_code }, ["item_name", "stock_uom"], function(r) {
			if (r) {
				// Set item_name if not already set
				if (r.item_name && !row.item_name) {
					frappe.model.set_value(cdt, cdn, "item_name", r.item_name);
				}
				// Set stock_uom if not already set
				if (r.stock_uom && !row.stock_uom) {
					frappe.model.set_value(cdt, cdn, "stock_uom", r.stock_uom);
				}
			}
		});

		// Set default target_warehouse if not already set
		if (!row.target_warehouse) {
			frappe.model.set_value(cdt, cdn, "target_warehouse", "Finished Goods - HEX");
		}
	},

	// When manufactured_qty changes in any row - recalculate total production weight
	manufactured_qty(frm, cdt, cdn) {
		calculate_total_production_weight(frm);
		frm.refresh_field("production_details");
	},

	// When stock_uom changes in any row - recalculate total production weight
	stock_uom(frm, cdt, cdn) {
		calculate_total_production_weight(frm);
	},

	// When a row is deleted - recalculate total production weight
	production_details_remove(frm, cdt, cdn) {
		calculate_total_production_weight(frm);
	}
});

/**
 * Remove all non-manual rows from production_details, preserving manual entries
 * (e.g. MIP items added by the user).
 *
 * @param {Object} frm - The form object
 */
function _clear_non_manual_production_details(frm) {
	const manual_rows = [];
	(frm.doc.production_details || []).forEach(function(row) {
		if (row.manual_entry === 1 || row.manual_entry === "1" || row.manual_entry === true) {
			manual_rows.push({
				item_code: row.item_code,
				item_name: row.item_name,
				target_warehouse: row.target_warehouse,
				manufactured_qty: row.manufactured_qty,
				stock_uom: row.stock_uom,
				manual_entry: 1,
			});
		}
	});

	frm.clear_table("production_details");

	manual_rows.forEach(function(row_data) {
		let new_row = frm.add_child("production_details");
		new_row.item_code = row_data.item_code;
		new_row.item_name = row_data.item_name;
		new_row.target_warehouse = row_data.target_warehouse;
		new_row.manufactured_qty = row_data.manufactured_qty;
		new_row.stock_uom = row_data.stock_uom;
		new_row.manual_entry = 1;
	});
}

/**
 * Rebuild raw_material_consumption and production_details tables from ALL
 * Finished Good Details (table_foun) rows.
 *
 * This is the central function for multi-row FG support.  It:
 *  1. Collects every BOM referenced in table_foun.
 *  2. Fetches combined raw-material + manufacturing-item data in ONE server
 *     call (get_combined_bom_data).
 *  3. Clears and rebuilds raw_material_consumption (deduped by item_code),
 *     preserving user-entered consumption / source_warehouse values.
 *  4. Clears non-manual production_details rows and rebuilds with one row per
 *     unique manufacturing item, whose manufactured_qty is the SUM of matching
 *     FG rows.
 *  5. Sets manufacturing_item on each FG row.
 *  6. Refreshes all dependent calculations without redundant refresh calls.
 *
 * @param {Object} frm - The form object
 */
function rebuild_tables_from_fg_details(frm) {
	const fg_details = frm.doc.table_foun || [];

	// ── Collect unique BOMs ──────────────────────────────────────────
	const boms = [];
	fg_details.forEach(function(row) {
		if (row.bom && boms.indexOf(row.bom) === -1) {
			boms.push(row.bom);
		}
	});

	if (boms.length === 0) {
		// No BOMs selected — clear dependent tables
		frm.clear_table("raw_material_consumption");
		frm.refresh_field("raw_material_consumption");

		_clear_non_manual_production_details(frm);
		frm.refresh_field("production_details");

		// Clear manufacturing_item on any FG rows without BOM
		fg_details.forEach(function(fg_row) {
			if (!fg_row.bom && fg_row.manufacturing_item) {
				frappe.model.set_value(fg_row.doctype, fg_row.name, "manufacturing_item", "");
			}
		});
		frm.refresh_field("table_foun");

		calculate_total_rm_consumption(frm);
		calculate_total_production_weight(frm);
		calculate_closing_qty_for_mip(frm);
		return;
	}

	// ── Save current user-entered RM values before clearing ──────────
	const saved_rm_values = {};
	(frm.doc.raw_material_consumption || []).forEach(function(row) {
		if (row.item_code) {
			saved_rm_values[row.item_code] = {
				consumption: row.consumption,
				source_warehouse: row.source_warehouse,
			};
			// Preserve optional custom fields if they exist
			if (row.avl_in_plant !== undefined) {
				saved_rm_values[row.item_code].avl_in_plant = row.avl_in_plant;
			}
			if (row.issued !== undefined) {
				saved_rm_values[row.item_code].issued = row.issued;
			}
			if (row.closing_stock !== undefined) {
				saved_rm_values[row.item_code].closing_stock = row.closing_stock;
			}
		}
	});

	// ── Fetch combined data from server (ONE call) ───────────────────
	frappe.call({
		method: "hexplastics.api.production_log_book.get_combined_bom_data",
		args: { bom_names: boms },
		callback: function(r) {
			if (!r.message) return;

			const data = r.message;
			const raw_materials = data.raw_materials || [];
			// { bom_name: {item_code, item_name, stock_uom}, … }
			const manufacturing_items = data.manufacturing_items || {};

			// ── Rebuild raw_material_consumption ─────────────────────
			frm.clear_table("raw_material_consumption");

			raw_materials.forEach(function(item) {
				if (!item.item_code) return;

				let row = frm.add_child("raw_material_consumption");
				row.item_code = item.item_code;
				if (item.item_name) row.item_name = item.item_name;
				if (item.uom) row.stock_uom = item.uom;

				// Restore saved user-entered values
				const saved = saved_rm_values[item.item_code];
				if (saved) {
					if (saved.consumption) row.consumption = saved.consumption;
					if (saved.source_warehouse) row.source_warehouse = saved.source_warehouse;
					if (saved.avl_in_plant !== undefined) row.avl_in_plant = saved.avl_in_plant;
					if (saved.issued !== undefined) row.issued = saved.issued;
					if (saved.closing_stock !== undefined) row.closing_stock = saved.closing_stock;
				} else {
					// Set default source warehouse for new items
					row.source_warehouse = "Production - Hex";
				}
			});

			frm.refresh_field("raw_material_consumption");

			// ── Set manufacturing_item on each FG row & build qty map ─
			const item_qty_map = {};     // item_code → total manufactured_qty
			const item_details_map = {}; // item_code → {item_name, stock_uom}

			fg_details.forEach(function(fg_row) {
				if (!fg_row.bom) {
					// Clear manufacturing_item for rows without BOM
					if (fg_row.manufacturing_item) {
						frappe.model.set_value(
							fg_row.doctype, fg_row.name,
							"manufacturing_item", ""
						);
					}
					return;
				}

				const mfg_data = manufacturing_items[fg_row.bom];
				if (!mfg_data) return;

				// Set manufacturing_item on FG row
				if (fg_row.manufacturing_item !== mfg_data.item_code) {
					frappe.model.set_value(
						fg_row.doctype, fg_row.name,
						"manufacturing_item", mfg_data.item_code
					);
				}

				// Accumulate qty per unique manufacturing item
				const ic = mfg_data.item_code;
				item_qty_map[ic] = (item_qty_map[ic] || 0) + (flt(fg_row.manufactured_qty) || 0);
				item_details_map[ic] = mfg_data;
			});

			// ── Rebuild production_details (non-manual rows) ─────────
			_clear_non_manual_production_details(frm);

			// Add one production_details row per unique manufacturing item
			Object.keys(item_qty_map).forEach(function(item_code) {
				const details = item_details_map[item_code];
				let pd_row = frm.add_child("production_details");
				pd_row.item_code = item_code;
				if (details.item_name) pd_row.item_name = details.item_name;
				pd_row.manufactured_qty = item_qty_map[item_code];
				if (details.stock_uom) pd_row.stock_uom = details.stock_uom;
				pd_row.target_warehouse = "Finished Goods - HEX";
			});

			frm.refresh_field("production_details");
			frm.refresh_field("table_foun");

			// ── Recalculate all totals ───────────────────────────────
			calculate_total_rm_consumption(frm);
			calculate_total_production_weight(frm);
			calculate_closing_qty_for_mip(frm);

			// Auto-fill avl_in_plant if date and shift are available
			if (frm.doc.production_date && frm.doc.shift_type) {
				fill_avl_in_plant_for_items(frm);
			}
		},
	});
}

// Handle child table field changes for Finished Good Details
// This mirrors the old header logic for gross_weight/weight_of_fabric_packing → net_weight.
frappe.ui.form.on("Production Log Sheet FG Details Table", {
	bom(frm, cdt, cdn) {
		// Multi-row aware: rebuild both raw_material_consumption and
		// production_details from ALL FG Detail rows in one go.
		rebuild_tables_from_fg_details(frm);
	},
	gross_weight(frm, cdt, cdn) {
		calculate_finished_good_details_net_weight(frm, cdt, cdn);
	},
	weight_of_fabric_packing(frm, cdt, cdn) {
		calculate_finished_good_details_net_weight(frm, cdt, cdn);
	},

	// When manufactured_qty changes in Finished Good Details, keep Production Details in sync.
	manufactured_qty(frm, cdt, cdn) {
		update_production_details_manufactured_qty(frm);
		calculate_total_production_weight(frm);
		calculate_closing_qty_for_mip(frm);
		frm.refresh_field("production_details");
	},

	table_foun_add(frm, cdt, cdn) {
		calculate_finished_good_details_net_weight(frm, cdt, cdn);
		// Keep legacy Production Details manufactured_qty in sync with moved field.
		update_production_details_manufactured_qty(frm);
		calculate_total_production_weight(frm);
		calculate_closing_qty_for_mip(frm);
		frm.refresh_field("production_details");
	},
	table_foun_remove(frm, cdt, cdn) {
		// When a FG row is removed its BOM items must also be removed.
		// Rebuild everything from the remaining FG rows.
		rebuild_tables_from_fg_details(frm);
	}
});

function calculate_finished_good_details_net_weight(frm, cdt, cdn) {
	const row = locals[cdt] && locals[cdt][cdn];
	if (!row) return;

	let gross_weight = flt(row.gross_weight) || 0;
	let weight_of_fabric_packing = flt(row.weight_of_fabric_packing) || 0;

	// Formula: net_weight = gross_weight - weight_of_fabric_packing
	let net_weight = gross_weight - weight_of_fabric_packing;
	net_weight = Math.max(0, net_weight);

	// Round to 4 decimal places to match field precision.
	net_weight = Math.round(net_weight * 10000) / 10000;

	if (flt(row.net_weight) !== net_weight) {
		frappe.model.set_value(cdt, cdn, "net_weight", net_weight);
	}

	// Optional: keep legacy header fields in sync (dashboards/APIs may still read them).
	const fg_details = frm.doc.table_foun || [];
	const total_net_weight = fg_details.reduce(function (acc, r) {
		return acc + (flt(r.net_weight) || 0);
	}, 0);
	const total_gross_weight = fg_details.reduce(function (acc, r) {
		return acc + (flt(r.gross_weight) || 0);
	}, 0);
	const total_fabric_packing_weight = fg_details.reduce(function (acc, r) {
		return acc + (flt(r.weight_of_fabric_packing) || 0);
	}, 0);

	if (frm.fields_dict && frm.fields_dict.net_weight) {
		set_form_value_if_changed(frm, "net_weight", Math.round(total_net_weight * 10000) / 10000);
	}
	if (frm.fields_dict && frm.fields_dict.gross_weight) {
		set_form_value_if_changed(frm, "gross_weight", Math.round(total_gross_weight * 10000) / 10000);
	}
	if (frm.fields_dict && frm.fields_dict.weight_of_fabric_packing) {
		set_form_value_if_changed(
			frm,
			"weight_of_fabric_packing",
			Math.round(total_fabric_packing_weight * 10000) / 10000
		);
	}

	// Totals that depend on net_weight
	calculate_closing_qty_for_mip(frm);
	calculate_total_production_weight(frm);
}

/**
 * Calculate closing_stock for a specific row in Raw Material Consumption table
 * Formula: closing_stock = (avl_in_plant + issued) - consumption
 * @param {Object} frm - The parent form object (Production Log Sheet)
 * @param {String} cdt - Child doctype name (Production Log Sheet Table)
 * @param {String} cdn - Child document name (row name)
 */
function calculate_closing_stock(frm, cdt, cdn) {
	// Get the child row
	let row = locals[cdt][cdn];
	
	if (!row) {
		return;
	}
	
	// Safely parse values, treating null/undefined/empty string as 0
	let avl_in_plant = flt(row.avl_in_plant) || 0;
	let issued = flt(row.issued) || 0;
	let consumption = flt(row.consumption) || 0;
	
	// Calculate closing_stock: (avl_in_plant + issued) - consumption
	let closing_stock = (avl_in_plant + issued) - consumption;
	
	// Round to 4 decimal places to match field precision and prevent floating-point drift
	closing_stock = Math.round(closing_stock * 10000) / 10000;
	
	// Update the closing_stock field in the same row
	frappe.model.set_value(cdt, cdn, "closing_stock", closing_stock);
}

/**
 * Auto-fill avl_in_plant field for all rows in raw_material_consumption table
 * based on previous shift closing stock.
 * 
 * Logic:
 * - If current entry is Night shift → use Day shift closing stock of the same date
 * - If Day shift data not found → fetch closest previous shift's closing stock
 * 
 * @param {Object} frm - The form object
 */
function fill_avl_in_plant_for_items(frm) {
	// Check if required fields are present
	if (!frm.doc.production_date || !frm.doc.shift_type) {
		return;
	}

	// Get all item codes from raw_material_consumption table
	const raw_material_consumption = frm.doc.raw_material_consumption || [];
	if (raw_material_consumption.length === 0) {
		return;
	}

	// Collect unique item codes
	const item_codes = [];
	raw_material_consumption.forEach(function(row) {
		if (row.item_code && !item_codes.includes(row.item_code)) {
			item_codes.push(row.item_code);
		}
	});

	if (item_codes.length === 0) {
		return;
	}

	// Call server-side API to get opening stock (previous closing stock) for all items at once
	frappe.call({
		method: "hexplastics.api.production_log_book.get_opening_stock_for_items_production_log_sheet",
		args: {
			item_codes: item_codes,
			current_date: frm.doc.production_date,
			current_shift: frm.doc.shift_type,
			exclude_docname: frm.doc.name || null, // Exclude current document if it exists
		},
		callback: function(r) {
			if (r.message && typeof r.message === "object") {
				const opening_stock_map = r.message;

				// Update avl_in_plant for each row
				raw_material_consumption.forEach(function(row) {
					if (row.item_code && opening_stock_map[row.item_code] !== undefined) {
						// Only set if value exists in the map
						const opening_stock = flt(opening_stock_map[row.item_code]) || 0;

						set_child_value_if_changed(
							row.doctype,
							row.name,
							"avl_in_plant",
							opening_stock
						);
					}
				});

				// Refresh the field to show updated values
				frm.refresh_field("raw_material_consumption");
			}
		},
		error: function(r) {
			// Log error but don't break the form
			console.error("Error fetching opening stock for Production Log Sheet:", r);
		},
	});
}

/**
 * Calculate total_production_weight
 * Formula: Sum of manufactured_qty for KGS rows in production_details + net_weight
 * Direct set - no setTimeout (setTimeout only used in refresh event)
 * @param {Object} frm - The form object
 */
function calculate_total_production_weight(frm) {
	let manufactured_qty_total = 0.0;

	(frm.doc.production_details || []).forEach(function(row) {
		const uom = (row.stock_uom || "").trim().toUpperCase();
		if (uom === "KGS"|| uom === "KG") {
			manufactured_qty_total += flt(row.manufactured_qty) || 0;
		}
	});

	// `net_weight` was moved to `Finished Good Details` (child table: table_foun).
	// Use summed child net_weight when present, otherwise fallback to legacy parent field.
	const fg_details = frm.doc.table_foun || [];
	const net_weight =
		fg_details.length > 0
			? fg_details.reduce(function (acc, row) {
					return acc + (flt(row.net_weight) || 0);
				}, 0)
			: flt(frm.doc.net_weight) || 0;
	let total = manufactured_qty_total + net_weight;

	// Round to 4 decimal places to prevent floating-point drift
	total = Math.round(total * 10000) / 10000;

	set_form_value_if_changed(frm, "total_production_weight", total);
}

/**
 * Set a parent form field only when the new value differs from current value.
 * Prevents unnecessary dirty-state toggles after refresh/save.
 *
 * @param {Object} frm - The form object
 * @param {string} fieldname - Parent fieldname
 * @param {number|string|null} value - New value
 */
function set_form_value_if_changed(frm, fieldname, value) {
	const current = frm.doc[fieldname];
	if (is_same_numeric_value(current, value)) {
		return;
	}
	frm.set_value(fieldname, value);
}

/**
 * Set a child row field only when the new value differs from current value.
 *
 * @param {string} cdt - Child doctype
 * @param {string} cdn - Child docname
 * @param {string} fieldname - Child fieldname
 * @param {number|string|null} value - New value
 */
function set_child_value_if_changed(cdt, cdn, fieldname, value) {
	const row = locals[cdt] && locals[cdt][cdn];
	if (!row) {
		return;
	}
	if (is_same_numeric_value(row[fieldname], value)) {
		return;
	}
	frappe.model.set_value(cdt, cdn, fieldname, value);
}

/**
 * Compare values after numeric normalization to precision 4.
 * This avoids false differences like 1 vs 1.0000.
 *
 * @param {*} current
 * @param {*} next
 * @returns {boolean}
 */
function is_same_numeric_value(current, next) {
	const normalized_current = Math.round((flt(current) || 0) * 10000) / 10000;
	const normalized_next = Math.round((flt(next) || 0) * 10000) / 10000;
	return normalized_current === normalized_next;
}