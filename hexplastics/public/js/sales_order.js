// Copyright (c) 2026, beetashoke chakraborty and contributors
// For license information, please see license.txt

function calculate_rate_per_kg(cdt, cdn, weight_per_unit) {
    const row = locals[cdt][cdn];
    const qty = flt(row.qty);
    const amount = flt(row.amount);
    const weight = flt(weight_per_unit);

    if (!amount || !qty || !weight) {
        frappe.model.set_value(cdt, cdn, "custom_rate_per_kg", 0);
        return;
    }

    const rate_per_kg = amount / (qty * weight);
    frappe.model.set_value(cdt, cdn, "custom_rate_per_kg", rate_per_kg);
}

function update_rate_per_kg(frm, cdt, cdn) {
    const row = locals[cdt][cdn];

    if (!row.item_code) {
        frappe.model.set_value(cdt, cdn, "custom_rate_per_kg", 0);
        return;
    }

    // Prefer the already-populated value on the SO Item row; this matches what users see in the grid.
    const row_weight = flt(row.weight_per_unit || 0);
    if (row_weight) {
        frappe.model.set_value(cdt, cdn, "per_kg_weight", row_weight);
        calculate_rate_per_kg(cdt, cdn, row_weight);
        return;
    }

    // Fallback: fetch from Item master (in case row field isn't populated yet).
    frappe.db.get_value("Item", row.item_code, "weight_per_unit").then((r) => {
        const weight_per_unit = r && r.message ? r.message.weight_per_unit : 0;
        frappe.model.set_value(cdt, cdn, "per_kg_weight", weight_per_unit);
        calculate_rate_per_kg(cdt, cdn, weight_per_unit);
    });
}

frappe.ui.form.on("Sales Order", {
    validate(frm) {
        (frm.doc.items || []).forEach((row) => {
            update_rate_per_kg(frm, row.doctype, row.name);
        });
    }
});

frappe.ui.form.on("Sales Order Item", {
    item_code(frm, cdt, cdn) {
        update_rate_per_kg(frm, cdt, cdn);
    },

    qty(frm, cdt, cdn) {
        update_rate_per_kg(frm, cdt, cdn);
    },

    amount(frm, cdt, cdn) {
        update_rate_per_kg(frm, cdt, cdn);
    }
});

