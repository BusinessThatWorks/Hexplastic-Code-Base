// Copyright (c) 2025, beetashoke chakraborty and contributors
// For license information, please see license.txt

frappe.ui.form.on("Purchase Order Item", {
    item_code(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        console.log("🔄 item_code Triggered for Row:", row);

        if (!row.item_code) {
            console.warn("⚠️ No item_code found in row.");
            return;
        }

        console.log("📡 Calling Server Method get_last_5_avg_rate for:", row.item_code);

        frappe.call({
            method: "hexplastics.api.purchase_order.get_last_5_avg_rate",
            args: { item_code: row.item_code },

            callback(r) {
                console.log("🟢 Server Response Received:", r);

                let val = r && r.message ? r.message : 0;

                console.log("🧮 Final Avg Rate Returned:", val);

                frappe.model.set_value(cdt, cdn, "custom_last_5_avg_purchase_rate", val);

                console.log(
                    `✔️ Updated custom_last_5_avg_purchase_rate for row ${cdn} to:`,
                    val
                );
            },

            error(err) {
                console.error("❌ API Error:", err);
            }
        });
    }
});


