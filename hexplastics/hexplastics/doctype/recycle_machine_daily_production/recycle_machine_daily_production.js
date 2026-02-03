// Copyright (c) 2026, beetashoke chakraborty and contributors
// For license information, please see license.txt

frappe.ui.form.on("Recycle Machine Daily Production", {
	refresh(frm) {
		// Refresh handler if needed in future
	},
});

// Child table: Recycle Machine Production Table
frappe.ui.form.on("Recycle Machine Production Table", {
	// When item_code is selected, fetch and populate grinding_mip_inhand_stock from Bin
	item_code: function(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (!row || !row.item_code) {
			// Clear grinding_mip_inhand_stock if item_code is cleared
			frappe.model.set_value(cdt, cdn, "grinding_mip_inhand_stock", 0);
			return;
		}

		// Fetch current in-hand stock from Bin using actual_qty
		// Filter by item_code and grinding_mip_source_warehouse
		fetch_grinding_mip_stock(frm, cdt, cdn, row);
	},

	// When warehouse changes, update the stock
	grinding_mip_source_warehouse: function(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (row && row.item_code) {
			// Re-fetch stock when warehouse changes
			fetch_grinding_mip_stock(frm, cdt, cdn, row);
		}
	},

	// When grinding_mip_inhand_stock changes, recalculate stock balance
	grinding_mip_inhand_stock: function(frm, cdt, cdn) {
		calculate_grinding_mip_stock_balance(frm, cdt, cdn);
	},

	// When material_consumed changes, recalculate stock balance
	material_consumed: function(frm, cdt, cdn) {
		calculate_grinding_mip_stock_balance(frm, cdt, cdn);
	},

	// When pp_mip_item is selected, fetch and populate pp_mip_inhand_stock from Bin
	pp_mip_item: function(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (!row || !row.pp_mip_item) {
			// Clear pp_mip_inhand_stock if pp_mip_item is cleared
			frappe.model.set_value(cdt, cdn, "pp_mip_inhand_stock", 0);
			return;
		}

		// Fetch current in-hand stock from Bin using actual_qty
		// Filter by pp_mip_item and pp_mip_target_warehouse
		fetch_pp_mip_stock(frm, cdt, cdn, row);
	},

	// When PP MIP warehouse changes, update the stock
	pp_mip_target_warehouse: function(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (row && row.pp_mip_item) {
			// Re-fetch stock when warehouse changes
			fetch_pp_mip_stock(frm, cdt, cdn, row);
		}
	},

	// When pp_mip_inhand_stock changes, recalculate stock balance
	pp_mip_inhand_stock: function(frm, cdt, cdn) {
		calculate_pp_mip_stock_balance(frm, cdt, cdn);
	},

	// When pp_mip_production changes, recalculate stock balance
	pp_mip_production: function(frm, cdt, cdn) {
		calculate_pp_mip_stock_balance(frm, cdt, cdn);
	}
});

// Helper function to fetch grinding MIP stock from Bin
function fetch_grinding_mip_stock(frm, cdt, cdn, row) {
	if (!row || !row.item_code) {
		frappe.model.set_value(cdt, cdn, "grinding_mip_inhand_stock", 0);
		return;
	}

	// Check if warehouse is specified
	if (!row.grinding_mip_source_warehouse) {
		// If no warehouse specified, set to 0
		frappe.model.set_value(cdt, cdn, "grinding_mip_inhand_stock", 0);
		return;
	}

	// Fetch current stock from Bin using actual_qty
	// Filtered by item_code and grinding_mip_source_warehouse
	frappe.call({
		method: "hexplastics.api.stock_monitoring.get_item_stock",
		args: {
			item_code: row.item_code,
			warehouse: row.grinding_mip_source_warehouse
		},
		callback: function(r) {
			if (r && r.message && r.message.success && r.message.data && r.message.data.actual_qty !== undefined) {
				// Populate with actual_qty from Bin (real-time stock balance)
				frappe.model.set_value(cdt, cdn, "grinding_mip_inhand_stock", flt(r.message.data.actual_qty || 0), function() {
					// After setting stock, recalculate balance
					calculate_grinding_mip_stock_balance(frm, cdt, cdn);
				});
			} else {
				// If error or no data, set to 0
				frappe.model.set_value(cdt, cdn, "grinding_mip_inhand_stock", 0, function() {
					// After setting stock, recalculate balance
					calculate_grinding_mip_stock_balance(frm, cdt, cdn);
				});
			}
		},
		error: function(r) {
			console.error("Error fetching stock from Bin:", r);
			frappe.model.set_value(cdt, cdn, "grinding_mip_inhand_stock", 0, function() {
				// After setting stock, recalculate balance
				calculate_grinding_mip_stock_balance(frm, cdt, cdn);
			});
		}
	});
}

// Helper function to calculate grinding_mip_stock_balance
// Formula: grinding_mip_stock_balance = grinding_mip_inhand_stock - material_consumed
function calculate_grinding_mip_stock_balance(frm, cdt, cdn) {
	const row = locals[cdt][cdn];
	if (!row) {
		return;
	}

	// Get values, defaulting to 0 if not set
	const inhand_stock = flt(row.grinding_mip_inhand_stock || 0);
	const material_consumed = flt(row.material_consumed || 0);

	// Calculate balance: inhand_stock - material_consumed
	const stock_balance = inhand_stock - material_consumed;

	// Set the calculated value
	frappe.model.set_value(cdt, cdn, "grinding_mip_stock_balance", stock_balance);
}

// Helper function to fetch PP MIP stock from Bin
function fetch_pp_mip_stock(frm, cdt, cdn, row) {
	if (!row || !row.pp_mip_item) {
		frappe.model.set_value(cdt, cdn, "pp_mip_inhand_stock", 0);
		return;
	}

	// Check if warehouse is specified
	if (!row.pp_mip_target_warehouse) {
		// If no warehouse specified, set to 0
		frappe.model.set_value(cdt, cdn, "pp_mip_inhand_stock", 0);
		return;
	}

	// Fetch current stock from Bin using actual_qty
	// Filtered by pp_mip_item and pp_mip_target_warehouse
	frappe.call({
		method: "hexplastics.api.stock_monitoring.get_item_stock",
		args: {
			item_code: row.pp_mip_item,
			warehouse: row.pp_mip_target_warehouse
		},
		callback: function(r) {
			if (r && r.message && r.message.success && r.message.data && r.message.data.actual_qty !== undefined) {
				// Populate with actual_qty from Bin (real-time stock balance)
				frappe.model.set_value(cdt, cdn, "pp_mip_inhand_stock", flt(r.message.data.actual_qty || 0), function() {
					// After setting stock, recalculate balance
					calculate_pp_mip_stock_balance(frm, cdt, cdn);
				});
			} else {
				// If error or no data, set to 0
				frappe.model.set_value(cdt, cdn, "pp_mip_inhand_stock", 0, function() {
					// After setting stock, recalculate balance
					calculate_pp_mip_stock_balance(frm, cdt, cdn);
				});
			}
		},
		error: function(r) {
			console.error("Error fetching PP MIP stock from Bin:", r);
			frappe.model.set_value(cdt, cdn, "pp_mip_inhand_stock", 0, function() {
				// After setting stock, recalculate balance
				calculate_pp_mip_stock_balance(frm, cdt, cdn);
			});
		}
	});
}

// Helper function to calculate pp_mip_stock_balance
// Formula: pp_mip_stock_balance = pp_mip_inhand_stock + pp_mip_production
function calculate_pp_mip_stock_balance(frm, cdt, cdn) {
	const row = locals[cdt][cdn];
	if (!row) {
		return;
	}

	// Get values, defaulting to 0 if not set
	const inhand_stock = flt(row.pp_mip_inhand_stock || 0);
	const production = flt(row.pp_mip_production || 0);

	// Calculate balance: inhand_stock + production
	const stock_balance = inhand_stock + production;

	// Set the calculated value
	frappe.model.set_value(cdt, cdn, "pp_mip_stock_balance", stock_balance);
}
