// frappe.pages['attendance-dashboard'].on_page_load = function(wrapper) {
// 	var page = frappe.ui.make_app_page({
// 		parent: wrapper,
// 		title: 'Attendance Dashboard',
// 		single_column: true
// 	});
// }


frappe.pages['attendance-dashboard'].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Attendance Dashboard',
		single_column: true
	});

	const $container = $(wrapper).find('.layout-main-section');

	const today = frappe.datetime.get_today();
	const yesterday = frappe.datetime.add_days(today, -1);

	const controls = $(
		'<div class="form-inline" style="gap: 12px; margin-bottom: 12px; display: flex; align-items: center;">\
            <input type="date" class="form-control" id="att-date" value="' + yesterday + '" style="margin-right: 12px;"/>\
            <div id="att-emp-wrapper" style="margin-right: 12px;"></div>\
            <button class="btn btn-primary" id="att-refresh" style="margin-right: 12px;">Refresh</button>\
            <button class="btn btn-secondary" id="att-backfill">Backfill…</button>\
        </div>'
	);

	const table = $(
		'<div class="table-responsive">\
            <table class="table table-bordered table-sm">\
                <thead>\
                    <tr>\
                        <th>Employee ID</th>\
                        <th>Employee Name</th>\
                        <th>Status</th>\
                        <th>First In</th>\
                        <th>Last Out</th>\
                        <th>Hours</th>\
                    </tr>\
                </thead>\
                <tbody></tbody>\
            </table>\
        </div>'
	);

	$container.append(controls);
	$container.append(table);

	// Add Employee filter field
	let employee_field = null;
	const $emp_wrapper = $('#att-emp-wrapper');
	employee_field = frappe.ui.form.make_control({
		df: {
			fieldtype: 'Link',
			fieldname: 'employee',
			options: 'Employee',
			label: '',
			placeholder: 'Select Employee (Optional)'
		},
		parent: $emp_wrapper,
		render_input: true
	});
	employee_field.$wrapper.css({'margin': '0'});
	// Hide the label if it exists
	employee_field.$wrapper.find('label').hide();

	function fetch_data() {
		const date = $('#att-date').val();
		const employee = employee_field ? employee_field.get_value() : null;
		frappe.call({
			method: 'frappe.desk.query_report.run',
			args: {
				report_name: 'Daily Attendance Summary',
				filters: JSON.stringify({ date, employee: employee || null }),
				ignore_prepared_report: 1
			},
			callback: function (r) {
				const payload = r.message || {};
				const data = payload.result || payload[1] || [];
				const $tbody = table.find('tbody');
				$tbody.empty();
				data.forEach(row => {
					const tr = $('<tr>');
					tr.append($('<td>').text(row.employee_id || ''));
					tr.append($('<td>').text(row.employee_name || ''));
					const statusCell = $('<td>').text(row.status || '');
					if ((row.status || '').toLowerCase() === 'present') {
						statusCell.addClass('text-success fw-bold');
					} else if ((row.status || '').toLowerCase() === 'absent') {
						statusCell.addClass('text-danger fw-bold');
					}
					tr.append(statusCell);
					tr.append($('<td>').text(row.first_in || ''));
					tr.append($('<td>').text(row.last_out || ''));
					tr.append($('<td>').text(row.hours != null ? row.hours : ''));
					$tbody.append(tr);
				});
			}
		});
	}

	controls.on('click', '#att-refresh', fetch_data);
	controls.on('click', '#att-backfill', function () {
		const dlg = new frappe.ui.Dialog({
			title: 'Backfill Attendance',
			fields: [
				{ fieldtype: 'Date', fieldname: 'start_date', label: 'From Date', reqd: 1, default: frappe.datetime.month_start() },
				{ fieldtype: 'Date', fieldname: 'end_date', label: 'To Date', reqd: 1, default: frappe.datetime.get_today() },
				{
					fieldtype: 'Link',
					fieldname: 'employee',
					label: 'Employee (Optional)',
					options: 'Employee',
					description: 'Leave empty to backfill for all employees'
				},
				{ fieldtype: 'HTML', fieldname: 'help', options: '<div class="text-muted">Fetches and stores attendance for the selected range. If employee is selected, only that employee\'s data will be fetched.</div>' }
			],
			primary_action_label: 'Start Backfill',
			primary_action(values) {
				if (!values.start_date || !values.end_date) return;
				dlg.set_message('Starting…');
				dlg.disable_primary_action();
				frappe.call({
					method: 'hexplastics.utils.timewatch_api.sync_attendance_range',
					args: {
						start_date: values.start_date,
						end_date: values.end_date,
						employee: values.employee || null
					},
					callback() {
						frappe.show_alert({ message: 'Backfill triggered. Check console/logs for progress.', indicator: 'green' });
						dlg.hide();
						fetch_data();
					},
					error() {
						frappe.msgprint('Failed to trigger backfill');
						dlg.enable_primary_action();
					}
				});
			}
		});
		dlg.show();
	});

	fetch_data();
};