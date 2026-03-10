// // Copyright (c) 2026, beetashoke chakraborty and contributors
// // For license information, please see license.txt

frappe.ui.form.on("Recycle Machine Daily Production", {
    refresh(frm) {
        // Refresh handler if needed in future
    },
});

// Child table: Recycle Machine Production Table (Grinding MIP Consumption)
frappe.ui.form.on("Recycle Machine Production Table", {
    // When item_code is selected, fetch and populate grinding_mip_inhand_stock from Bin
    item_code: function (frm, cdt, cdn) {
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
    grinding_mip_source_warehouse: function (frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        if (row && row.item_code) {
            // Re-fetch stock when warehouse changes
            fetch_grinding_mip_stock(frm, cdt, cdn, row);
        }
    },

    // When grinding_mip_inhand_stock changes, recalculate stock balance
    grinding_mip_inhand_stock: function (frm, cdt, cdn) {
        calculate_grinding_mip_stock_balance(frm, cdt, cdn);
    },

    // When material_consumed changes, recalculate stock balance
    material_consumed: function (frm, cdt, cdn) {
        const row = locals[cdt][cdn];

        // Safely get numeric values
        const inhand_stock = flt(row.grinding_mip_inhand_stock || 0);
        const material_consumed = flt(row.material_consumed || 0);

        // Validation: material_consumed cannot be greater than in-hand stock
        if (material_consumed > inhand_stock) {
            frappe.msgprint({
                title: __("Invalid Consumption Quantity"),
                indicator: "red",
                message: __(
                    "Material Consumed ({0}) cannot be greater than Grinding MIP In-hand Stock ({1}).",
                    [material_consumed, inhand_stock]
                ),
            });

            // Reset to max allowed (in-hand stock)
            frappe.model.set_value(cdt, cdn, "material_consumed", inhand_stock);
        }

        // Always recalculate the stock balance after any change/adjustment
        calculate_grinding_mip_stock_balance(frm, cdt, cdn);

        // Recalculate closing balance using PP MIP production from table_eraa
        calculate_closing_balance_for_all_rows(frm);
    }
});

// Child table: Recycle Machine PP MIP Table (Dana Production Details)
frappe.ui.form.on("Recycle Machine PP MIP Table", {
    // When pp_mip_item is selected, fetch and populate pp_mip_in_hand_stock from Bin
    pp_mip_item: function (frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        if (!row || !row.pp_mip_item) {
            // Clear pp_mip_in_hand_stock if pp_mip_item is cleared
            frappe.model.set_value(cdt, cdn, "pp_mip_in_hand_stock", 0);
            // Recalculate balance and bags
            calculate_pp_mip_stock_and_bags(frm, cdt, cdn);
            return;
        }

        // Fetch current in-hand stock from Bin using actual_qty
        // Filter by pp_mip_item and pp_mip_target_warehouse
        fetch_pp_mip_stock_for_pp_table(frm, cdt, cdn, row);
    },

    // When PP MIP warehouse changes, update the stock
    pp_mip_target_warehouse: function (frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        if (row && row.pp_mip_item) {
            // Re-fetch stock when warehouse changes
            fetch_pp_mip_stock_for_pp_table(frm, cdt, cdn, row);
        }
    },

    // When pp_mip_in_hand_stock changes, recalculate stock balance and total bags
    pp_mip_in_hand_stock: function (frm, cdt, cdn) {
        calculate_pp_mip_stock_and_bags(frm, cdt, cdn);
    },

    // When pp_mip_production changes, recalculate stock balance and total bags
    pp_mip_production: function (frm, cdt, cdn) {
        calculate_pp_mip_stock_and_bags(frm, cdt, cdn);

        // Also recalculate closing balance on Grinding MIP rows
        calculate_closing_balance_for_all_rows(frm);
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
        callback: function (r) {
            if (r && r.message && r.message.success && r.message.data && r.message.data.actual_qty !== undefined) {
                // Populate with actual_qty from Bin (real-time stock balance)
                frappe.model.set_value(cdt, cdn, "grinding_mip_inhand_stock", flt(r.message.data.actual_qty || 0), function () {
                    // After setting stock, recalculate balance
                    calculate_grinding_mip_stock_balance(frm, cdt, cdn);
                });
            } else {
                // If error or no data, set to 0
                frappe.model.set_value(cdt, cdn, "grinding_mip_inhand_stock", 0, function () {
                    // After setting stock, recalculate balance
                    calculate_grinding_mip_stock_balance(frm, cdt, cdn);
                });
            }
        },
        error: function (r) {
            console.error("Error fetching stock from Bin:", r);
            frappe.model.set_value(cdt, cdn, "grinding_mip_inhand_stock", 0, function () {
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

// Helper function to fetch PP MIP stock from Bin for PP MIP child table
function fetch_pp_mip_stock_for_pp_table(frm, cdt, cdn, row) {
    if (!row || !row.pp_mip_item) {
        frappe.model.set_value(cdt, cdn, "pp_mip_in_hand_stock", 0);
        return;
    }

    // Check if warehouse is specified
    if (!row.pp_mip_target_warehouse) {
        // If no warehouse specified, set to 0
        frappe.model.set_value(cdt, cdn, "pp_mip_in_hand_stock", 0);
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
        callback: function (r) {
            if (r && r.message && r.message.success && r.message.data && r.message.data.actual_qty !== undefined) {
                // Populate with actual_qty from Bin (real-time stock balance)
                frappe.model.set_value(
                    cdt,
                    cdn,
                    "pp_mip_in_hand_stock",
                    flt(r.message.data.actual_qty || 0),
                    function () {
                        // After setting stock, recalculate balance and bags
                        calculate_pp_mip_stock_and_bags(frm, cdt, cdn);
                    }
                );
            } else {
                // If error or no data, set to 0
                frappe.model.set_value(cdt, cdn, "pp_mip_in_hand_stock", 0, function () {
                    // After setting stock, recalculate balance and bags
                    calculate_pp_mip_stock_and_bags(frm, cdt, cdn);
                });
            }
        },
        error: function (r) {
            console.error("Error fetching PP MIP stock from Bin:", r);
            frappe.model.set_value(cdt, cdn, "pp_mip_in_hand_stock", 0, function () {
                // After setting stock, recalculate balance and bags
                calculate_pp_mip_stock_and_bags(frm, cdt, cdn);
            });
        }
    });
}

// Helper function to calculate pp_mip_stock_balance and total_bags
// Formula:
//   pp_mip_stock_balance = pp_mip_in_hand_stock + pp_mip_production
//   total_bags = floor(pp_mip_production / 25)
function calculate_pp_mip_stock_and_bags(frm, cdt, cdn) {
    const row = locals[cdt][cdn];
    if (!row) {
        return;
    }

    // Get values, defaulting to 0 if not set
    const inhand_stock = flt(row.pp_mip_in_hand_stock || 0);
    const production = flt(row.pp_mip_production || 0);

    // Calculate balance: inhand_stock + production
    const stock_balance = inhand_stock + production;

    // Calculate total bags (round down)
    const total_bags = Math.floor(production / 25);

    // Set the calculated values
    frappe.model.set_value(cdt, cdn, "pp_mip_stock_balance", stock_balance);
    frappe.model.set_value(cdt, cdn, "total_bags", total_bags);
}

// Helper: calculate closing_balance on all Grinding MIP rows
// Formula: closing_balance = material_consumed - total_pp_mip_production
function calculate_closing_balance_for_all_rows(frm) {
    const doc = frm.doc || {};

    // Sum PP MIP Production from table_eraa (Recycle Machine PP MIP Table)
    let total_pp_mip_production = 0;
    if (doc.table_eraa && Array.isArray(doc.table_eraa)) {
        doc.table_eraa.forEach(row => {
            total_pp_mip_production += flt(row.pp_mip_production || 0);
        });
    }

    // Update closing_balance in each production_details row
    if (doc.production_details && Array.isArray(doc.production_details)) {
        doc.production_details.forEach(row => {
            const material_consumed = flt(row.material_consumed || 0);
            const closing_balance = material_consumed - total_pp_mip_production;
            frappe.model.set_value(row.doctype, row.name, "closing_balance", closing_balance);
        });
    }
}
