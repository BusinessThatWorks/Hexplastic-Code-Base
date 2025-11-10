frappe.ui.form.on('Employee', {
    date_of_joining: function(frm) {
        if (frm.doc.date_of_joining) {
            let doj = frappe.datetime.str_to_obj(frm.doc.date_of_joining);
            // Add 6 months
            let confirmation_date = frappe.datetime.add_months(doj, 6);
            frm.set_value("final_confirmation_date", frappe.datetime.obj_to_str(confirmation_date));
        }
    }
});
