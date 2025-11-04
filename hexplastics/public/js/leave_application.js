frappe.ui.form.on("Leave Application", {
    employee: async function(frm) {
        await check_probation_realtime(frm);
    },
    from_date: async function(frm) {
        await check_probation_realtime(frm);
    }
});
async function check_probation_realtime(frm) {
    if (!frm.doc.employee) {
        return;
    }
    let emp = await frappe.db.get_doc("Employee", frm.doc.employee);
    if (!emp.date_of_joining) {
        return;
    }
    let doj = new Date(emp.date_of_joining);
    let probationEnd = new Date(doj);
    probationEnd.setMonth(probationEnd.getMonth() + 6);
    if (!frm.doc.from_date) {
        return;
    }
    let fromDate = new Date(frm.doc.from_date);
    if (fromDate < probationEnd) {
        frappe.msgprint({
            title: "Leave Blocked",
            message: `You are under probation until <b>${probationEnd.toISOString().split("T")[0]}</b>. Leave not allowed.`,
            indicator: "red"
        });
        frm.set_value("from_date", "");
        frm.set_value("to_date", "");
        return;
    }

}

