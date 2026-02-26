frappe.ui.form.on('Frame Master', {
    frame_size: function(frm) {
        calculate_inner(frm);
    },
    section_size: function(frm) {
        calculate_inner(frm);
    }
});

function calculate_inner(frm) {

    // If any field blank → clear inner size
    if (!frm.doc.frame_size || !frm.doc.section_size) {
        frm.set_value("inner_size", "");
        return;
    }

    let frame = frm.doc.frame_size.split("/");
    let section = frm.doc.section_size.split("/");

    // Proper format check
    if (frame.length !== 2 || section.length !== 2) {
        frm.set_value("inner_size", "");
        return;
    }

    let inner_width = flt(frame[0]) - flt(section[0]);
    let inner_height = flt(frame[1]) - flt(section[1]);

    // Prevent negative value
    if (inner_width < 0 || inner_height < 0) {
        frm.set_value("inner_size", "");
        frappe.msgprint("Section Size cannot be greater than Frame Size");
        return;
    }

    frm.set_value("inner_size", inner_width + "/" + inner_height);
}