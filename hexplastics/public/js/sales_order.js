// Copyright (c) 2026, beetashoke chakraborty and contributors
// For license information, please see license.txt

function calculate_rate_per_kg(cdt, cdn, weight_per_unit) {
    const row = locals[cdt][cdn];
    const qty = flt(row.qty);
    const amount = flt(row.amount);
    const weight = flt(weight_per_unit);

    if (!amount || !qty || !weight) {
        set_child_value_if_changed(cdt, cdn, "custom_rate_per_kg", 0);
        return;
    }

    const denominator = weight * qty;
    const rate_per_kg = amount / denominator;
    set_child_value_if_changed(cdt, cdn, "custom_rate_per_kg", rate_per_kg);
}

function set_child_value_if_changed(cdt, cdn, fieldname, value) {
    const row = locals[cdt] && locals[cdt][cdn];
    if (!row) return;

    const current = flt(row[fieldname]);
    const next = flt(value);

    if (Math.abs(current - next) < 0.000001) return;
    frappe.model.set_value(cdt, cdn, fieldname, next);
}

function schedule_recalculation(frm, cdt, cdn, reason) {
    [0, 120, 300, 700].forEach((delay) => {
        setTimeout(() => {
            update_rate_per_kg(frm, cdt, cdn);
        }, delay);
    });
}

function populate_weight_per_unit(cdt, cdn) {
    const row = locals[cdt][cdn];

    if (!row.item_code) {
        frappe.model.set_value(cdt, cdn, "per_kg_weight", 0);
        return;
    }

    frappe.db.get_value("Item", row.item_code, "weight_per_unit").then((r) => {
        const weight_per_unit = flt(r && r.message ? r.message.weight_per_unit : 0);
        // Keep compatibility with earlier field usage.
        set_child_value_if_changed(cdt, cdn, "per_kg_weight", weight_per_unit);
        calculate_rate_per_kg(cdt, cdn, weight_per_unit);
    });
}

function update_rate_per_kg(frm, cdt, cdn) {
    const row = locals[cdt][cdn];

    if (!row.item_code) {
        set_child_value_if_changed(cdt, cdn, "custom_rate_per_kg", 0);
        return;
    }

    // Always fetch from Item master for formula:
    // custom_rate_per_kg = amount / (qty * Item.weight_per_unit)
    frappe.db.get_value("Item", row.item_code, "weight_per_unit").then((r) => {
        const weight_per_unit = flt(r && r.message ? r.message.weight_per_unit : 0);
        set_child_value_if_changed(cdt, cdn, "per_kg_weight", weight_per_unit);
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
        populate_weight_per_unit(cdt, cdn);
        // ERPNext fills row amounts shortly after item selection.
        schedule_recalculation(frm, cdt, cdn, "item_code");
    },

    qty(frm, cdt, cdn) {
        schedule_recalculation(frm, cdt, cdn, "qty");
    },

    amount(frm, cdt, cdn) {
        schedule_recalculation(frm, cdt, cdn, "amount");
    },

    rate(frm, cdt, cdn) {
        schedule_recalculation(frm, cdt, cdn, "rate");
    },

    net_rate(frm, cdt, cdn) {
        schedule_recalculation(frm, cdt, cdn, "net_rate");
    }
});

