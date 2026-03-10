// // Copyright (c) 2026, beetashoke chakraborty and contributors
// // For license information, please see license.txt

frappe.ui.form.on("Recycle Machine Daily Production", {
    refresh(frm) {
        // Refresh handler if needed in future
        console.log("Recycle Machine Daily Production form refreshed", frm.doc);
    },

    // Whenever production_date changes, recompute Available in Tray from previous shift
    production_date(frm) {
        console.log(
            "production_date changed",
            frm.doc && frm.doc.production_date,
            "shift_type:",
            frm.doc && frm.doc.shift_type
        );
        set_parent_available_in_tray_from_previous_shift(frm);
        set_available_in_tray_for_all_rows(frm);
    },

    // Whenever shift_type changes, recompute Available in Tray from previous shift
    shift_type(frm) {
        console.log(
            "shift_type changed",
            frm.doc && frm.doc.shift_type,
            "production_date:",
            frm.doc && frm.doc.production_date
        );
        set_parent_available_in_tray_from_previous_shift(frm);
        set_available_in_tray_for_all_rows(frm);
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

        // Also fetch previous closing balance to set Available in Tray
        set_available_in_tray_from_previous_shift(frm, cdt, cdn, row);
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

// Helper: set Available in Tray from previous shift closing_balance
function set_available_in_tray_from_previous_shift(frm, cdt, cdn, row) {
    const doc = frm.doc || {};

    if (!doc.production_date || !doc.shift_type || !row.item_code) {
        // Missing required context, do nothing
        console.log(
            "Skipping set_available_in_tray_from_previous_shift due to missing context",
            {
                production_date: doc.production_date,
                shift_type: doc.shift_type,
                item_code: row.item_code,
            }
        );
        return;
    }

    console.log("Calling get_previous_closing_balance for", {
        production_date: doc.production_date,
        shift_type: doc.shift_type,
        item_code: row.item_code,
        row_name: row.name,
    });

    frappe.call({
        method: "hexplastics.hexplastics.doctype.recycle_machine_daily_production.recycle_machine_daily_production.get_previous_closing_balance",
        args: {
            production_date: doc.production_date,
            shift_type: doc.shift_type,
            item_code: row.item_code,
        },
        callback: function (r) {
            console.log(
                "get_previous_closing_balance response",
                r && r.message,
                "for row",
                row.name
            );
            const closing_balance = r && r.message ? flt(r.message) : 0;
            frappe.model.set_value(cdt, cdn, "available_in_tray", closing_balance);
        },
        error: function (err) {
            console.error(
                "Error calling get_previous_closing_balance",
                err,
                {
                    production_date: doc.production_date,
                    shift_type: doc.shift_type,
                    item_code: row.item_code,
                }
            );
        },
    });
}

// Helper: recompute Available in Tray for all existing Grinding MIP rows
// based only on current production_date and shift_type on the parent
function set_available_in_tray_for_all_rows(frm) {
    const doc = frm.doc || {};

    if (!doc.production_date || !doc.shift_type || !doc.production_details) {
        console.log("Skipping set_available_in_tray_for_all_rows, missing data", {
            production_date: doc.production_date,
            shift_type: doc.shift_type,
            has_production_details: !!doc.production_details,
        });
        return;
    }

    console.log(
        "Recomputing Available in Tray for all rows",
        "production_date:",
        doc.production_date,
        "shift_type:",
        doc.shift_type,
        "rows:",
        (doc.production_details || []).length
    );

    (doc.production_details || []).forEach(row => {
        if (row.item_code) {
            console.log(
                "Recomputing Available in Tray for row",
                row.name,
                "item_code:",
                row.item_code
            );
            set_available_in_tray_from_previous_shift(frm, row.doctype, row.name, row);
        }
    });
}

// Helper: set parent-level Available in Tray using total closing_balance
// from the immediate previous shift document
function set_parent_available_in_tray_from_previous_shift(frm) {
    const doc = frm.doc || {};

    if (!doc.production_date || !doc.shift_type) {
        console.log(
            "Skipping set_parent_available_in_tray_from_previous_shift due to missing context",
            { production_date: doc.production_date, shift_type: doc.shift_type }
        );
        return;
    }

    console.log("Calling get_previous_total_closing_balance for parent", {
        production_date: doc.production_date,
        shift_type: doc.shift_type,
    });

    frappe.call({
        method: "hexplastics.hexplastics.doctype.recycle_machine_daily_production.recycle_machine_daily_production.get_previous_total_closing_balance",
        args: {
            production_date: doc.production_date,
            shift_type: doc.shift_type,
        },
        callback: function (r) {
            console.log(
                "get_previous_total_closing_balance response",
                r && r.message
            );
            const total_closing_balance = r && r.message ? flt(r.message) : 0;
            frm.set_value("available_in_tray", total_closing_balance);
        },
        error: function (err) {
            console.error(
                "Error calling get_previous_total_closing_balance",
                err,
                {
                    production_date: doc.production_date,
                    shift_type: doc.shift_type,
                }
            );
        },
    });
}
