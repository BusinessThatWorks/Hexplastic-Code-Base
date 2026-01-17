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
