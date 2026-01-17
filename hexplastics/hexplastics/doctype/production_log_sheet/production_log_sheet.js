// Copyright (c) 2026, beetashoke chakraborty and contributors
// For license information, please see license.txt

frappe.ui.form.on("Production Log Sheet", {
	refresh(frm) {
		// Set up BOM filter based on Production Plan
		setup_bom_filter(frm);
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
	},

	weight_of_fabric_packing(frm) {
		// Recalculate net_weight when weight_of_fabric_packing changes
		calculate_net_weight(frm);
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
		}
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
	}
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
							
							// Note: manufactured_qty is left blank for manual entry by user
							
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
