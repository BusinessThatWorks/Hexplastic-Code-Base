// Copyright (c) 2026, beetashoke chakraborty and contributors
// For license information, please see license.txt

frappe.ui.form.on("Production Log Sheet", {
	refresh(frm) {
		// Set up BOM filter based on Production Plan
		setup_bom_filter(frm);
		
		// Set up employee search for Operator ID and Supervisor ID
		setup_employee_search(frm);
		
		// Calculate total RM consumption on refresh
		calculate_total_rm_consumption(frm);
		
		// Calculate closing qty for MIP on refresh
		calculate_closing_qty_for_mip(frm);
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
			
			// Clear BOM field when Production Plan is cleared
			if (frm.doc.bom) {
				frm.set_value("bom", "");
			}
		}
	},

	gross_weight(frm) {
		// Recalculate net_weight when gross_weight changes
		calculate_net_weight(frm);
		// Recalculate closing_qty_for_mip since net_weight changes
		calculate_closing_qty_for_mip(frm);
	},

	weight_of_fabric_packing(frm) {
		// Recalculate net_weight when weight_of_fabric_packing changes
		calculate_net_weight(frm);
		// Recalculate closing_qty_for_mip since net_weight changes
		calculate_closing_qty_for_mip(frm);
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
			
			// Clear existing rows in production_details table
			frm.clear_table("production_details");
			
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
					}
				}
			});
			
			// Fetch manufacturing item (main item) from BOM
			fetch_and_add_manufacturing_item(frm);
		} else {
			// Clear tables if BOM is cleared
			frm.clear_table("raw_material_consumption");
			frm.refresh_field("raw_material_consumption");
			frm.clear_table("production_details");
			frm.refresh_field("production_details");
			
			// Recalculate total RM consumption (should be 0 after clearing)
			calculate_total_rm_consumption(frm);
		}
	},

	operator_id(frm) {
		// When Operator ID value changes, check if it's an employee ID and convert to name
		if (frm.doc.operator_id) {
			// Check if the value looks like an employee ID (alphanumeric, typically)
			// If it's a valid employee ID format, fetch the name
			// Employee IDs in Frappe are typically alphanumeric
			if (frm.doc.operator_id.match(/^[A-Z0-9-]+$/i) && frm.doc.operator_id.length < 50) {
				fetch_employee_name(frm, "operator_id");
			}
			// Otherwise, assume it's already a name and update the name field
			else {
				frm.set_value("operator_name", frm.doc.operator_id);
			}
		} else {
			frm.set_value("operator_name", "");
		}
	},

		supervisor_id(frm) {
		// When Supervisor ID value changes, check if it's an employee ID and convert to name
		if (frm.doc.supervisor_id) {
			// Check if the value looks like an employee ID (alphanumeric, typically)
			// If it's a valid employee ID format, fetch the name
			if (frm.doc.supervisor_id.match(/^[A-Z0-9-]+$/i) && frm.doc.supervisor_id.length < 50) {
				fetch_employee_name(frm, "supervisor_id");
			}
			// Otherwise, assume it's already a name and update the name field
			else {
				frm.set_value("supervisor_name", frm.doc.supervisor_id);
			}
		} else {
			frm.set_value("supervisor_name", "");
		}
	},

	// When a row is added to raw_material_consumption table
	raw_material_consumption_add(frm) {
		// Recalculate total RM consumption
		// Note: calculate_total_rm_consumption will also trigger calculate_closing_qty_for_mip
		calculate_total_rm_consumption(frm);
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

	// When mip_used changes
	mip_used(frm) {
		// Recalculate closing_qty_for_mip
		calculate_closing_qty_for_mip(frm);
	},

	// When process_loss_weight changes
	process_loss_weight(frm) {
		// Recalculate closing_qty_for_mip
		calculate_closing_qty_for_mip(frm);
	}
});

/**
 * Setup set_query filter on BOM field based on selected Production Plan
 * @param {Object} frm - The form object
 */
function setup_bom_filter(frm) {
	frm.set_query("bom", function() {
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
	
	// Update the field value (only if it's different to avoid unnecessary triggers)
	if (flt(frm.doc.net_weight) !== net_weight) {
		frm.set_value("net_weight", net_weight);
		// Note: closing_qty_for_mip will be recalculated by the gross_weight/weight_of_fabric_packing handlers
	}
}

/**
 * Update manufactured_qty in all rows of production_details table
 * @param {Object} frm - The form object
 */
function update_production_details_manufactured_qty(frm) {
	if (!frm.doc.production_details || frm.doc.production_details.length === 0) {
		return;
	}
	
	const manufactured_qty = flt(frm.doc.manufactured_qty) || 0;
	
	// Update manufactured_qty for all rows in production_details table
	frm.doc.production_details.forEach(function(row) {
		if (row.item_code) {
			frappe.model.set_value(row.doctype, row.name, "manufactured_qty", manufactured_qty);
		}
	});
	
	// Refresh the child table to show updated values
	frm.refresh_field("production_details");
}

/**
 * Fetch manufacturing item from BOM and add it to production_details table
 * @param {Object} frm - The form object
 */
function fetch_and_add_manufacturing_item(frm) {
	if (!frm.doc.bom) {
		return;
	}
	
	// Fetch BOM document to get manufacturing item
	frappe.call({
		method: "frappe.client.get",
		args: {
			doctype: "BOM",
			name: frm.doc.bom
		},
		callback: function(r) {
			if (r.message && r.message.item) {
				const manufacturing_item_code = r.message.item;
				
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
								frappe.model.set_value(row.doctype, row.name, "target_warehouse", "Finished Good - Hex");
							}
							
							// Set manufactured_qty from main form if available
							if (frm.doc.manufactured_qty) {
								frappe.model.set_value(row.doctype, row.name, "manufactured_qty", flt(frm.doc.manufactured_qty) || 0);
							}
							
							// Refresh the child table to show new row
							frm.refresh_field("production_details");
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
 * Setup searchable employee field for Operator ID and Supervisor ID
 * Creates a custom link-like interface for Data fields
 * @param {Object} frm - The form object
 */
function setup_employee_search(frm) {
	// Setup Operator ID field with employee link dialog
	if (frm.fields_dict.operator_id && frm.fields_dict.operator_id.$input) {
		// Make the field look and behave like a Link field
		frm.fields_dict.operator_id.$input.attr("data-fieldtype", "Link");
		frm.fields_dict.operator_id.$input.attr("data-options", "Employee");
		
		// Add link button if not already present
		if (!frm.fields_dict.operator_id.$input.siblings(".link-btn").length) {
			let $wrapper = frm.fields_dict.operator_id.$input.parent();
			let $link_btn = $('<span class="link-btn"><i class="fa fa-search"></i></span>');
			$link_btn.css({
				"cursor": "pointer",
				"padding": "4px 8px",
				"margin-left": "4px"
			});
			$link_btn.on("click", function() {
				open_employee_dialog(frm, "operator_id");
			});
			$wrapper.append($link_btn);
		}
		
	}
	
	// Setup Supervisor ID field with employee link dialog
	if (frm.fields_dict.supervisor_id && frm.fields_dict.supervisor_id.$input) {
		// Make the field look and behave like a Link field
		frm.fields_dict.supervisor_id.$input.attr("data-fieldtype", "Link");
		frm.fields_dict.supervisor_id.$input.attr("data-options", "Employee");
		
		// Add link button if not already present
		if (!frm.fields_dict.supervisor_id.$input.siblings(".link-btn").length) {
			let $wrapper = frm.fields_dict.supervisor_id.$input.parent();
			let $link_btn = $('<span class="link-btn"><i class="fa fa-search"></i></span>');
			$link_btn.css({
				"cursor": "pointer",
				"padding": "4px 8px",
				"margin-left": "4px"
			});
			$link_btn.on("click", function() {
				open_employee_dialog(frm, "supervisor_id");
			});
			$wrapper.append($link_btn);
		}
		
	}
}

/**
 * Open employee selection dialog
 * @param {Object} frm - The form object
 * @param {String} fieldname - The field name (operator_id or supervisor_id)
 */
function open_employee_dialog(frm, fieldname) {
	// Create a dialog with employee link field
	let dialog = new frappe.ui.Dialog({
		title: __("Select Employee"),
		fields: [
			{
				fieldtype: "Link",
				fieldname: "employee",
				label: __("Employee"),
				options: "Employee",
				get_query: function() {
					return {
						filters: {
							status: "Active"
						}
					};
				},
				reqd: 1
			}
		],
		primary_action_label: __("Select"),
		primary_action: function() {
			const employee_id = dialog.get_value("employee");
			if (employee_id) {
				// Fetch employee name and store it
				frappe.call({
					method: "frappe.client.get",
					args: {
						doctype: "Employee",
						name: employee_id
					},
					callback: function(r) {
						if (r.message && r.message.employee_name) {
							frm.set_value(fieldname, r.message.employee_name);
							// Also update the corresponding name field
							if (fieldname === "operator_id") {
								frm.set_value("operator_name", r.message.employee_name);
							} else if (fieldname === "supervisor_id") {
								frm.set_value("supervisor_name", r.message.employee_name);
							}
							dialog.hide();
						} else {
							frappe.msgprint(__("Employee Name not found for Employee: {0}", [employee_id]));
						}
					}
				});
			}
		}
	});
	dialog.show();
}

/**
 * Fetch employee name from Employee doctype and store it in the field
 * This function replaces the employee ID with the employee name in the same field
 * @param {Object} frm - The form object
 * @param {String} fieldname - The field name (operator_id or supervisor_id)
 */
function fetch_employee_name(frm, fieldname) {
	const employee_id = frm.doc[fieldname];
	
	if (!employee_id) {
		return;
	}
	
	// Fetch employee document to get employee_name
	frappe.call({
		method: "frappe.client.get",
		args: {
			doctype: "Employee",
			name: employee_id
		},
		callback: function(r) {
			if (r.message && r.message.employee_name) {
				// Store employee_name in the field instead of employee ID
				const employee_name = r.message.employee_name;
				
				// Update the field with the employee name
				frm.set_value(fieldname, employee_name);
				
				// Update the corresponding name field for display
				if (fieldname === "operator_id") {
					frm.set_value("operator_name", employee_name);
				} else if (fieldname === "supervisor_id") {
					frm.set_value("supervisor_name", employee_name);
				}
			} else if (r.message && !r.message.employee_name) {
				// If employee_name is not available, show a message
				frappe.msgprint(__("Employee Name not found for Employee: {0}", [employee_id]));
			}
		},
		error: function(r) {
			// If employee not found by ID, the value might already be a name
			// In that case, just update the name field
			if (fieldname === "operator_id") {
				frm.set_value("operator_name", frm.doc.operator_id);
			} else if (fieldname === "supervisor_id") {
				frm.set_value("supervisor_name", frm.doc.supervisor_id);
			}
		}
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
		frm.set_value("total_rm_consumption", 0);
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
	
	// Update the total_rm_consumption field
	frm.set_value("total_rm_consumption", total);
	// Trigger recalculation of closing_qty_for_mip
	calculate_closing_qty_for_mip(frm);
}

/**
 * Calculate closing_qty_for_mip using the formula:
 * closing_qty_for_mip = total_rm_consumption + mip_used - net_weight - process_loss_weight
 * Updates the field in real time
 * @param {Object} frm - The form object
 */
function calculate_closing_qty_for_mip(frm) {
	// Safely parse all values, treating null/undefined/empty as 0
	const total_rm_consumption = flt(frm.doc.total_rm_consumption) || 0;
	const mip_used = flt(frm.doc.mip_used) || 0;
	const net_weight = flt(frm.doc.net_weight) || 0;
	const process_loss_weight = flt(frm.doc.process_loss_weight) || 0;
	
	// Calculate closing_qty_for_mip
	// Formula: total_rm_consumption + mip_used - net_weight - process_loss_weight
	const closing_qty = total_rm_consumption + mip_used - net_weight - process_loss_weight;
	
	// Update the closing_qty_for_mip field
	frm.set_value("closing_qty_for_mip", closing_qty);
}

// Handle child table field changes for Production Log Sheet Table
// Note: In Frappe, when handling child table events, 'frm' refers to the parent form
frappe.ui.form.on("Production Log Sheet Table", {
	// When consumption value changes in any row
	consumption(frm, cdt, cdn) {
		// Recalculate total RM consumption
		// frm here is the parent form (Production Log Sheet)
		calculate_total_rm_consumption(frm);
	}
});
