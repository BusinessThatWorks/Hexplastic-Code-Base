frappe.pages['attandance-details-dashboard'].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Attandance Details Dashboard',
		single_column: true
	});

	const $container = $(wrapper).find('.layout-main-section');

	const today = frappe.datetime.get_today();
	const current_year = parseInt(today.split('-')[0], 10);
	const current_month = parseInt(today.split('-')[1], 10);

	const controls = $(
		'<div class="form-inline" style="gap: 12px; margin-bottom: 12px; display: flex; align-items: center;">\
            <label style="margin: 0;">Month</label>\
            <select class="form-control" id="att-month" style="margin-right: 12px;"></select>\
            <label style="margin: 0;">From</label>\
            <input type="date" class="form-control" id="att-from-date" required style="margin-right: 12px;"/>\
            <label style="margin: 0;">To</label>\
            <input type="date" class="form-control" id="att-to-date" required style="margin-right: 12px;"/>\
            <div id="att-emp-wrapper" style="margin-right: 12px;"></div>\
            <button class="btn btn-primary" id="att-refresh" style="margin-right: 12px;">Refresh</button>\
            <button class="btn btn-secondary" id="att-backfill">Backfill…</button>\
            <button class="btn btn-success" id="att-export-excel" style="margin-left: 12px;">Export</button>\
        </div>'
	);

	const table = $(
		'<div class="table-responsive">\
            <table class="table table-bordered table-sm att-details-table">\
                <thead></thead>\
                <tbody></tbody>\
            </table>\
        </div>'
	);
	const fixed_scrollbar = $(
		'<div class="att-fixed-scrollbar-wrap">\
            <div class="att-fixed-scrollbar-inner"></div>\
        </div>'
	);

	$container.append(controls);
	$container.append(fixed_scrollbar);
	$container.append(table);
	if (!$('#att-details-dashboard-style').length) {
		$('head').append(
			'<style id="att-details-dashboard-style">\
                .att-details-table th, .att-details-table td {\
                    white-space: nowrap;\
                    vertical-align: middle;\
                }\
                .att-details-table .att-sticky-col-1 {\
                    position: sticky;\
                    left: 0;\
                    background: #fff;\
                    z-index: 3;\
                    border-right: 1px solid #d1d8dd !important;\
                }\
                .att-details-table .att-sticky-col-2 {\
                    position: sticky;\
                    left: 160px;\
                    background: #fff;\
                    z-index: 3;\
                }\
                .att-details-table thead .att-sticky-col-1,\
                .att-details-table thead .att-sticky-col-2 {\
                    z-index: 4;\
                }\
                .att-details-table thead .att-sticky-col-1 {\
                    border-right: 1px solid #d1d8dd !important;\
                }\
                .att-details-table .att-sticky-col-1 {\
                    min-width: 160px;\
                }\
                .att-details-table .att-sticky-col-2 {\
                    min-width: 180px;\
                }\
                .att-fixed-scrollbar-wrap {\
                    overflow-x: auto;\
                    overflow-y: hidden;\
                    height: 16px;\
                    margin-bottom: 8px;\
                }\
                .att-fixed-scrollbar-inner {\
                    height: 1px;\
                }\
            </style>'
		);
	}

	const $table_wrap = table;
	const $fixed_scrollbar_wrap = fixed_scrollbar;
	const $fixed_scrollbar_inner = fixed_scrollbar.find('.att-fixed-scrollbar-inner');
	let is_syncing_scroll = false;

	function sync_fixed_scrollbar_width() {
		const table_el = table.find('table')[0];
		if (!table_el) return;
		$fixed_scrollbar_inner.width(table_el.scrollWidth);
	}

	$table_wrap.on('scroll', function () {
		if (is_syncing_scroll) return;
		is_syncing_scroll = true;
		$fixed_scrollbar_wrap.scrollLeft($table_wrap.scrollLeft());
		is_syncing_scroll = false;
	});

	$fixed_scrollbar_wrap.on('scroll', function () {
		if (is_syncing_scroll) return;
		is_syncing_scroll = true;
		$table_wrap.scrollLeft($fixed_scrollbar_wrap.scrollLeft());
		is_syncing_scroll = false;
	});

	function render_default_header() {
		const $thead = table.find('thead');
		$thead.empty();
		const default_row = $('<tr>');
		default_row.append($('<th class="att-sticky-col-1">').text('Employee ID'));
		default_row.append($('<th class="att-sticky-col-2">').text('Employee Name'));
		default_row.append($('<th>').text('Status'));
		default_row.append($('<th>').text('First In'));
		default_row.append($('<th>').text('Last Out'));
		default_row.append($('<th>').text('Hours'));
		$thead.append(default_row);
	}

	const month_options = [
		{ value: '01', label: 'January' },
		{ value: '02', label: 'February' },
		{ value: '03', label: 'March' },
		{ value: '04', label: 'April' },
		{ value: '05', label: 'May' },
		{ value: '06', label: 'June' },
		{ value: '07', label: 'July' },
		{ value: '08', label: 'August' },
		{ value: '09', label: 'September' },
		{ value: '10', label: 'October' },
		{ value: '11', label: 'November' },
		{ value: '12', label: 'December' }
	];

	const $month_filter = controls.find('#att-month');
	month_options.forEach(month => {
		$month_filter.append($('<option>').val(month.value).text(month.label));
	});
	$month_filter.val(String(current_month).padStart(2, '0'));

	function get_month_bounds(month_value) {
		const month_int = parseInt(month_value, 10);
		const start = `${current_year}-${String(month_int).padStart(2, '0')}-01`;
		const end_date_obj = new Date(current_year, month_int, 0);
		const end = `${current_year}-${String(month_int).padStart(2, '0')}-${String(end_date_obj.getDate()).padStart(2, '0')}`;
		return { start, end };
	}

	function apply_selected_month_defaults() {
		const selected_month = $('#att-month').val();
		const bounds = get_month_bounds(selected_month);
		const $from = $('#att-from-date');
		const $to = $('#att-to-date');
		$from.attr('min', bounds.start).attr('max', bounds.end).val(bounds.start);
		$to.attr('min', bounds.start).attr('max', bounds.end).val(bounds.end);
	}

	function validate_date_selection(from_date, to_date) {
		if (!from_date || !to_date) {
			frappe.msgprint('Please select both From and To dates.');
			return false;
		}
		if (from_date > to_date) {
			frappe.msgprint('From date cannot be greater than To date.');
			return false;
		}
		const selected_month = $('#att-month').val();
		const bounds = get_month_bounds(selected_month);
		if (from_date < bounds.start || to_date > bounds.end) {
			frappe.msgprint(`Please select dates within ${month_options[parseInt(selected_month, 10) - 1].label} (${bounds.start} to ${bounds.end}).`);
			return false;
		}
		return true;
	}

	function format_display_date(date_str) {
		if (!date_str || date_str.indexOf('-') === -1) return date_str || '';
		const parts = date_str.split('-');
		if (parts.length !== 3) return date_str;
		return `${parts[2]}-${parts[1]}-${parts[0]}`;
	}

	function get_export_table_html() {
		const table_html = table.find('table')[0].outerHTML;
		return `
			<html>
				<head>
					<meta charset="utf-8" />
					<title>Attendance Details Dashboard</title>
					<style>
						table { border-collapse: collapse; width: 100%; }
						th, td { border: 1px solid #ddd; padding: 6px; white-space: nowrap; }
						th { background: #f5f5f5; }
					</style>
				</head>
				<body>
					<h3>Attendance Details Dashboard</h3>
					${table_html}
				</body>
			</html>
		`;
	}

	function export_excel() {
		const html = get_export_table_html();
		const blob = new Blob([`\ufeff${html}`], {
			type: 'application/vnd.ms-excel;charset=utf-8;'
		});
		const link = document.createElement('a');
		const from_date = $('#att-from-date').val() || 'from';
		const to_date = $('#att-to-date').val() || 'to';
		link.href = URL.createObjectURL(blob);
		link.download = `attendance_details_${from_date}_to_${to_date}.xls`;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(link.href);
	}


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
	employee_field.$wrapper.css({ 'margin': '0' });
	employee_field.$wrapper.find('label').hide();

	function fetch_data() {
		const from_date = $('#att-from-date').val();
		const to_date = $('#att-to-date').val();
		const employee = employee_field ? employee_field.get_value() : null;
		const $thead = table.find('thead');
		const $tbody = table.find('tbody');
		if (!validate_date_selection(from_date, to_date)) {
			return;
		}
		const date_list = [];
		const current_date_obj = new Date(`${from_date}T00:00:00`);
		const to_date_obj = new Date(`${to_date}T00:00:00`);
		while (current_date_obj <= to_date_obj) {
			const y = current_date_obj.getFullYear();
			const m = String(current_date_obj.getMonth() + 1).padStart(2, '0');
			const d = String(current_date_obj.getDate()).padStart(2, '0');
			date_list.push(`${y}-${m}-${d}`);
			current_date_obj.setDate(current_date_obj.getDate() + 1);
		}

		const render_header = () => {
			$thead.empty();
			const date_row = $('<tr>');
			const metric_row = $('<tr>');
			date_row.append($('<th rowspan="2" class="att-sticky-col-1">').text('Employee ID'));
			date_row.append($('<th rowspan="2" class="att-sticky-col-2">').text('Employee Name'));

			date_list.forEach(date => {
				date_row.append($('<th colspan="4" class="text-center">').text(format_display_date(date)));
				metric_row.append($('<th>').text('Status'));
				metric_row.append($('<th>').text('First In'));
				metric_row.append($('<th>').text('Last Out'));
				metric_row.append($('<th>').text('Hours'));
			});

			$thead.append(date_row);
			$thead.append(metric_row);
		};

		const render_rows = rows => {
			$tbody.empty();
			const employee_map = {};

			rows.forEach(row => {
				const emp_id = row.employee_id || '';
				const key = emp_id || (row.employee_name || '');
				if (!employee_map[key]) {
					employee_map[key] = {
						employee_id: emp_id,
						employee_name: row.employee_name || '',
						by_date: {}
					};
				}
				employee_map[key].by_date[row.attendance_date] = row;
			});

			Object.values(employee_map)
				.sort((a, b) => (a.employee_id || '').localeCompare(b.employee_id || ''))
				.forEach(emp_row => {
					const tr = $('<tr>');
					tr.append($('<td class="att-sticky-col-1">').text(emp_row.employee_id));
					tr.append($('<td class="att-sticky-col-2">').text(emp_row.employee_name));

					date_list.forEach(date => {
						const day = emp_row.by_date[date] || {};
						const statusCell = $('<td>').text(day.status || '');
						if ((day.status || '').toLowerCase() === 'present') {
							statusCell.addClass('text-success fw-bold');
						} else if ((day.status || '').toLowerCase() === 'absent') {
							statusCell.addClass('text-danger fw-bold');
						}
						tr.append(statusCell);
						tr.append($('<td>').text(day.first_in || ''));
						tr.append($('<td>').text(day.last_out || ''));
						tr.append($('<td>').text(day.hours !== '' && day.hours !== undefined ? day.hours : ''));
					});

					$tbody.append(tr);
				});
			sync_fixed_scrollbar_width();
		};

		render_header();
		$tbody.empty();
		const page_size = 500;
		let start = 0;
		let all_rows = [];

		const calculate_hours = (first_in, last_out) => {
			if (!first_in || !last_out) return '';
			const first = new Date(first_in);
			const last = new Date(last_out);
			if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return '';
			const diff_hours = (last - first) / (1000 * 60 * 60);
			return Math.round(diff_hours * 10) / 10;
		};

		const fetch_next_batch = () => {
			const filters = {
				attendance_date: ['between', [from_date, to_date]]
			};
			if (employee) {
				filters.employee = employee;
			}

			frappe.call({
				method: 'frappe.client.get_list',
				args: {
					doctype: 'Attendance',
					fields: [
						'attendance_date',
						'employee',
						'employee_name',
						'status',
						'custom_attendance_in_time',
						'custom_attendance_out_time'
					],
					filters: filters,
					order_by: 'attendance_date asc, employee asc',
					limit_start: start,
					limit_page_length: page_size
				},
				callback: function (r) {
					const data = r.message || [];
					const mapped_rows = data.map(row => ({
						attendance_date: row.attendance_date || '',
						employee_id: row.employee || '',
						employee_name: row.employee_name || '',
						status: row.status || '',
						first_in: row.custom_attendance_in_time || '',
						last_out: row.custom_attendance_out_time || '',
						hours: calculate_hours(row.custom_attendance_in_time, row.custom_attendance_out_time)
					}));

					all_rows = all_rows.concat(mapped_rows);

					if (data.length === page_size) {
						start += page_size;
						fetch_next_batch();
					} else {
						render_rows(all_rows);
					}
				},
				error: function () {
					frappe.msgprint('Failed to fetch attendance data from Attendance doctype.');
				}
			});
		};

		fetch_next_batch();
	}

	controls.on('click', '#att-refresh', fetch_data);
	controls.on('click', '#att-export-excel', function (e) {
		e.preventDefault();
		export_excel();
	});
	controls.on('change', '#att-month', function () {
		apply_selected_month_defaults();
		const $tbody = table.find('tbody');
		$tbody.empty();
		render_default_header();
	});
	controls.on('change', '#att-from-date, #att-to-date', function () {
		const from_date = $('#att-from-date').val();
		const to_date = $('#att-to-date').val();
		if (from_date && to_date) {
			validate_date_selection(from_date, to_date);
		}
	});
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

	apply_selected_month_defaults();
	render_default_header();
	sync_fixed_scrollbar_width();
	$(window).on('resize.att-details-dashboard', function () {
		sync_fixed_scrollbar_width();
	});
};
