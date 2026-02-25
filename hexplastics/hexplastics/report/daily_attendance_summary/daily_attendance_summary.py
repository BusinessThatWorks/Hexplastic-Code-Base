# Copyright (c) 2026, beetashoke chakraborty and contributors
# For license information, please see license.txt

import frappe
from datetime import datetime, timedelta


def execute(filters=None):
	filters = filters or {}
	date_str = filters.get("date") or (datetime.today() - timedelta(days=1)).strftime("%Y-%m-%d")
	employee = filters.get("employee")

	columns = [
		{"label": "Employee ID", "fieldname": "employee_id", "fieldtype": "Data", "width": 140},
		{"label": "Employee Name", "fieldname": "employee_name", "fieldtype": "Data", "width": 200},
		{"label": "Status", "fieldname": "status", "fieldtype": "Data", "width": 110},
		{"label": "First In", "fieldname": "first_in", "fieldtype": "Datetime", "width": 160},
		{"label": "Last Out", "fieldname": "last_out", "fieldtype": "Datetime", "width": 160},
		{"label": "Hours", "fieldname": "hours", "fieldtype": "Float", "width": 100, "precision": 1},
	]

	params = [date_str]
	where = "attendance_date = %s"
	if employee:
		where += " and employee = %s"
		params.append(employee)

	# Build SQL query safely
	query = """
		select
			employee as employee_id,
			employee_name,
			status,
			custom_attendance_in_time as first_in,
			custom_attendance_out_time as last_out
		from `tabAttendance`
		where """ + where + """
		order by employee
	"""
	
	rows = frappe.db.sql(query, params, as_dict=True)

	data = []
	for r in rows:
		hours = 0.0
		first_in = r.get("first_in")
		last_out = r.get("last_out")
		
		# Calculate hours from datetime fields
		if first_in and last_out:
			try:
				# Convert to datetime objects if they're strings
				if isinstance(first_in, str):
					# Try parsing as string
					try:
						first_in_dt = datetime.strptime(first_in.split('.')[0], "%Y-%m-%d %H:%M:%S")
					except:
						first_in_dt = None
				else:
					first_in_dt = first_in
				
				if isinstance(last_out, str):
					try:
						last_out_dt = datetime.strptime(last_out.split('.')[0], "%Y-%m-%d %H:%M:%S")
					except:
						last_out_dt = None
				else:
					last_out_dt = last_out
				
				# Calculate difference
				if first_in_dt and last_out_dt:
					if isinstance(first_in_dt, datetime) and isinstance(last_out_dt, datetime):
						diff = (last_out_dt - first_in_dt).total_seconds()
						hours = round(diff / 3600.0, 1)
			except Exception:
				# If calculation fails, hours remain 0.0
				pass
		
		status = r.get("status") or ("Absent" if hours == 0.0 else "Present")
		data.append(
			{
				"employee_id": r.get("employee_id") or "",
				"employee_name": r.get("employee_name") or "",
				"status": status,
				"first_in": first_in,
				"last_out": last_out,
				"hours": hours,
			}
		)

	return columns, data
