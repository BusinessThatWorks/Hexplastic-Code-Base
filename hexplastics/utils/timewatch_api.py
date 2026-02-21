# """
# TimeWatch API Test - Simple function to test and get response
# """

# import requests
# import json
# from datetime import datetime, timedelta

# # API Configuration
# API_URL = "http://45.123.111.150:9006/TimeWatchAPI/GetPunchData"
# API_KEY = "T!meW@tch#123@"


# def test_timewatch_api(from_date=None, to_date=None):
# 	"""Test TimeWatch API and get all data"""
# 	# Default to last 30 days if not provided
# 	if not from_date or not to_date:
# 		today = datetime.now()
# 		from_date_obj = today - timedelta(days=30)
# 		to_date_obj = today
# 		from_date = from_date_obj.strftime("%Y-%m-%d")
# 		to_date = to_date_obj.strftime("%Y-%m-%d")

# 	# Request body - Get ALL employees and ALL devices
# 	request_body = {
# 		"FromDate": from_date,
# 		"ToDate": to_date,
# 		"DeviceID": "",
# 		"UserID": "",
# 	}

# 	# Headers
# 	headers = {"X-Api-Key": API_KEY, "Content-Type": "application/json"}

# 	print("=" * 80)
# 	print("Testing TimeWatch API")
# 	print("=" * 80)
# 	print(f"\nURL: {API_URL}")
# 	print(f"Date Range: {request_body['FromDate']} to {request_body['ToDate']}")
# 	print("\nSending request...\n")

# 	try:
# 		response = requests.post(API_URL, headers=headers, json=request_body, timeout=30)

# 		print(f"Status Code: {response.status_code}\n")

# 		# Parse response regardless of status code
# 		try:
# 			data = response.json()
# 			print("Response:")
# 			print(json.dumps(data, indent=2))

# 			if response.status_code == 200:
# 				if isinstance(data, dict) and data.get("Success"):
# 					print(f"\n Success: {data.get('Message', 'N/A')}")
# 					if "Data" in data and isinstance(data["Data"], list):
# 						print(f" Total Records: {len(data['Data'])}")
# 				return data
# 			else:
# 				# Handle 400 or other error status codes
# 				if isinstance(data, dict):
# 					print(f"\n Error: {data.get('Message', 'No message')}")
# 					if data.get("Success") == False:
# 						print(" Note: No data found for this date range.")
# 						print(" Try a different date range that has data.")
# 				return data
# 		except json.JSONDecodeError:
# 			print(f"Response (not JSON): {response.text}")
# 			return None

# 	except requests.exceptions.ConnectionError as e:
# 		print(" Connection Error: Cannot reach the server")
# 		print(f"   {e!s}")
# 		print("\n  Server might be down or network issue")
# 		return None

# 	except requests.exceptions.Timeout:
# 		print(" Timeout: Server took too long to respond")
# 		return None

# 	except Exception as e:
# 		print(f" Error: {str(e)}")
# 		return None

# 	finally:
# 		print("\n" + "=" * 80)


# """
# TimeWatch API Test - Simple function to test and get response (yesterday only)
# """

# import requests
# import json
# from datetime import datetime, timedelta

# # API Configuration
# API_URL = "http://45.123.111.150:9006/TimeWatchAPI/GetPunchData"
# API_KEY = "T!meW@tch#123@"


# def test_timewatch_api():
# 	"""Test TimeWatch API and get ALL data for yesterday only"""

# 	# Yesterday's date
# 	yesterday = datetime.today() - timedelta(days=1)
# 	yesterday_str = yesterday.strftime("%Y-%m-%d")

# 	# Request body - Get ALL employees and ALL devices for yesterday
# 	request_body = {
# 		"FromDate": yesterday_str,
# 		"ToDate": yesterday_str,
# 		"DeviceID": "",
# 		"UserID": "",
# 	}

# 	# Headers
# 	headers = {"X-Api-Key": API_KEY, "Content-Type": "application/json"}

# 	print("=" * 80)
# 	print("Testing TimeWatch API")
# 	print("=" * 80)
# 	print(f"\nURL: {API_URL}")
# 	print(f"Date Range: {request_body['FromDate']} to {request_body['ToDate']}")
# 	print("\nSending request...\n")

# 	try:
# 		response = requests.post(API_URL, headers=headers, json=request_body, timeout=30)

# 		print(f"Status Code: {response.status_code}\n")

# 		# Parse response regardless of status code
# 		try:
# 			data = response.json()
# 			print("Response:")
# 			print(json.dumps(data, indent=2))

# 			if response.status_code == 200:
# 				if isinstance(data, dict) and data.get("Success"):
# 					print(f"\n Success: {data.get('Message', 'N/A')}")
# 					if "Data" in data and isinstance(data["Data"], list):
# 						print(f" Total Records: {len(data['Data'])}")
# 				return data
# 			else:
# 				# Handle 400 or other error status codes
# 				if isinstance(data, dict):
# 					print(f"\n Error: {data.get('Message', 'No message')}")
# 					if data.get("Success") is False:
# 						print(" Note: No data found for this date range.")
# 						print(" Try a different date range that has data.")
# 				return data

# 		except json.JSONDecodeError:
# 			print(f"Response (not JSON): {response.text}")
# 			return None

# 	except requests.exceptions.ConnectionError as e:
# 		print(" Connection Error: Cannot reach the server")
# 		print(f"   {e!s}")
# 		print("\n  Server might be down or network issue")
# 		return None

# 	except requests.exceptions.Timeout:
# 		print(" Timeout: Server took too long to respond")
# 		return None

# 	except Exception as e:
# 		print(f" Error: {str(e)}")
# 		return None

# 	finally:
# 		print("\n" + "=" * 80)


# if __name__ == "__main__":
# 	test_timewatch_api()

"""
TimeWatch Attendance Sync - Yesterday only

- test_timewatch_api() → just call API for yesterday and print data
- sync_yesterday_attendance() → create/update Attendance for yesterday
"""

import requests
import json
from datetime import datetime, timedelta

import frappe

# API Configuration
API_URL = "http://45.123.111.150:9006/TimeWatchAPI/GetPunchData"
API_KEY = "T!meW@tch#123@"


def _get_yesterday_str() -> str:
	"""Return yesterday's date as YYYY-MM-DD."""
	yesterday = datetime.today() - timedelta(days=1)
	return yesterday.strftime("%Y-%m-%d")


def _fetch_punches_for_date(date_str: str):
	"""Call TimeWatch API and return (punch_list, raw_response_dict)."""
	request_body = {
		"FromDate": date_str,
		"ToDate": date_str,
		"DeviceID": "",
		"UserID": "",
	}

	headers = {"X-Api-Key": API_KEY, "Content-Type": "application/json"}

	print("=" * 80)
	print("Fetching TimeWatch punches")
	print("=" * 80)
	print(f"\nURL: {API_URL}")
	print(f"Date Range: {request_body['FromDate']} to {request_body['ToDate']}")
	print("\nSending request...\n")

	try:
		resp = requests.post(API_URL, headers=headers, json=request_body, timeout=30)
		print(f"Status Code: {resp.status_code}\n")

		try:
			data = resp.json()
		except Exception:
			print("Response is not JSON:")
			print(resp.text)
			return [], None

		print("Response JSON:")
		print(json.dumps(data, indent=2))

		if resp.status_code != 200:
			print(f"\nError: HTTP {resp.status_code}")
			return [], data

		if not isinstance(data, dict) or not data.get("Success"):
			print(f"\nError from API: {data.get('Message', 'No message')}")
			return [], data

		punches = data.get("Data") or []
		print(f"\nTotal punches received: {len(punches)}")
		return punches, data

	except requests.exceptions.ConnectionError as e:
		print("Connection Error: Cannot reach the server")
		print(f"   {e!s}")
		print("\nServer might be down or network issue")
		return [], None
	except requests.exceptions.Timeout:
		print("Timeout: Server took too long to respond")
		return [], None
	except Exception as e:
		print(f"Error while calling TimeWatch API: {e!s}")
		return [], None


def test_timewatch_api():
	"""
	Simple test: call API for yesterday only and print full response.

	Run with:
	    bench --site hex.com execute hexplastics.utils.timewatch_api.test_timewatch_api
	"""
	date_str = _get_yesterday_str()
	_punches, data = _fetch_punches_for_date(date_str)
	# Just return raw JSON for inspection
	return data


# @frappe.whitelist()
# def sync_yesterday_attendance():
# 	"""
# 	Sync yesterday's attendance from TimeWatch into ERPNext Attendance doctype.

# 	Logic:
# 	- Group by UserID
# 	- Sort PunchTime ascending
# 	- in_time = first PunchTime, out_time = last PunchTime
# 	- If user has >= 2 punches → Present
# 	- If user has 0 or 1 punch → Absent
# 	- Map UserID -> Employee via Employee.custom_employee_id
# 	- Create/Update Attendance for that date
# 	"""

# 	att_date = _get_yesterday_str()
# 	punches, _ = _fetch_punches_for_date(att_date)

# 	if not punches:
# 		print(f"\nNo punches received for {att_date}. Nothing to sync.")
# 		return {"success": False, "message": f"No punches for {att_date}"}

# 	# Load Active employees and build map: custom_employee_id -> employee.name
# 	employees = frappe.get_all(
# 		"Employee",
# 		filters={"status": "Active"},
# 		fields=["name", "employee_name", "custom_employee_id"],
# 	)
# 	userid_to_emp = {emp.custom_employee_id: emp.name for emp in employees if emp.custom_employee_id}

# 	print(f"\nLoaded {len(employees)} active employees with custom_employee_id.")
# 	if not userid_to_emp:
# 		print("No employees have custom_employee_id set. Aborting.")
# 		return {"success": False, "message": "No employees with custom_employee_id"}

# 	from collections import defaultdict

# 	user_punch_times = defaultdict(list)  # {UserID: [datetime, ...]}

# 	for row in punches:
# 		userid = (row or {}).get("UserID")
# 		punch_time_str = (row or {}).get("PunchTime")
# 		if not userid or not punch_time_str:
# 			continue

# 		try:
# 			punch_dt = datetime.fromisoformat(punch_time_str)
# 		except Exception:
# 			continue

# 		if punch_dt.date().isoformat() != att_date:
# 			continue

# 		user_punch_times[userid].append(punch_dt)

# 	print(f"\nUsers with punches for {att_date}: {len(user_punch_times)}")

# 	created = 0
# 	updated = 0
# 	skipped_no_emp = 0
# 	present_count = 0
# 	absent_count = 0

# 	# Users with punches
# 	for userid, times in user_punch_times.items():
# 		emp_name = userid_to_emp.get(userid)
# 		if not emp_name:
# 			print(f"Skipping UserID {userid} - no matching Employee.custom_employee_id")
# 			skipped_no_emp += 1
# 			continue

# 		if not times:
# 			continue

# 		times.sort()
# 		in_time = times[0]
# 		out_time = times[-1] if len(times) > 1 else None

# 		if out_time:
# 			status = "Present"
# 			present_count += 1
# 		else:
# 			status = "Absent"
# 			absent_count += 1

# 		existing = frappe.db.exists("Attendance", {"employee": emp_name, "attendance_date": att_date})

# 		if existing:
# 			doc = frappe.get_doc("Attendance", existing)
# 			action = "Updated"
# 			updated += 1
# 		else:
# 			doc = frappe.new_doc("Attendance")
# 			doc.employee = emp_name
# 			doc.attendance_date = att_date
# 			action = "Created"
# 			created += 1

# 		doc.status = status
# 		# assumes these custom fields exist on Attendance
# 		doc.in_time = in_time
# 		doc.out_time = out_time

# 		doc.flags.ignore_permissions = True
# 		doc.save()
# 		print(
# 			f"{action} Attendance for {emp_name} ({userid}) on {att_date}: "
# 			f"status={status}, in={in_time}, out={out_time}"
# 		)

# 	# Users with no punches at all → Absent
# 	userids_with_punches = set(user_punch_times.keys())
# 	for emp in employees:
# 		userid = emp.custom_employee_id
# 		if not userid or userid in userids_with_punches:
# 			continue

# 		emp_name = emp.name

# 		if frappe.db.exists("Attendance", {"employee": emp_name, "attendance_date": att_date}):
# 			continue

# 		doc = frappe.new_doc("Attendance")
# 		doc.employee = emp_name
# 		doc.attendance_date = att_date
# 		doc.status = "Absent"
# 		doc.flags.ignore_permissions = True
# 		doc.save()

# 		absent_count += 1
# 		created += 1
# 		print(f"Created Absent Attendance for {emp_name} ({userid}) on {att_date}")

# 	frappe.db.commit()

# 	summary = {
# 		"success": True,
# 		"date": att_date,
# 		"present": present_count,
# 		"absent": absent_count,
# 		"created": created,
# 		"updated": updated,
# 		"skipped_no_employee": skipped_no_emp,
# 	}

# 	print("\n" + "=" * 80)
# 	print("SYNC SUMMARY")
# 	print("=" * 80)
# 	print(json.dumps(summary, indent=2))
# 	print("=" * 80 + "\n")

# 	return summary


@frappe.whitelist()
def sync_yesterday_attendance():
	"""
	Sync yesterday's attendance from TimeWatch into ERPNext Attendance doctype.
	"""

	att_date = _get_yesterday_str()
	print("\n" + "=" * 80)
	print(f"Starting sync_yesterday_attendance for date: {att_date}")
	print("=" * 80)

	punches, _ = _fetch_punches_for_date(att_date)

	print(f"\n[STEP] Total raw punches from API: {len(punches)}")

	if not punches:
		print(f"\n[STOP] No punches received for {att_date}. Nothing to sync.")
		return {"success": False, "message": f"No punches for {att_date}"}

	# Load Active employees and build map: custom_employee_id -> employee.name
	employees = frappe.get_all(
		"Employee",
		filters={"status": "Active"},
		fields=["name", "employee_name", "custom_employee_id"],
	)
	print(f"[STEP] Active employees found: {len(employees)}")

	userid_to_emp = {}
	for emp in employees:
		if emp.custom_employee_id:
			userid_to_emp[emp.custom_employee_id] = emp.name
		else:
			print(f"  [WARN] Employee {emp.name} has NO custom_employee_id")

	print(f"[STEP] Employees with custom_employee_id: {len(userid_to_emp)}")
	if not userid_to_emp:
		print("[STOP] No employees with custom_employee_id. Aborting sync.")
		return {"success": False, "message": "No employees with custom_employee_id"}

	from collections import defaultdict

	user_punch_times = defaultdict(list)  # {UserID: [datetime, ...]}
	skipped_other_dates = 0
	kept_punches = 0

	print(f"\n[STEP] Filtering punches - Only keeping punches for date: {att_date}")
	for row in punches:
		userid = (row or {}).get("UserID")
		punch_time_str = (row or {}).get("PunchTime")
		if not userid or not punch_time_str:
			print(f"  [SKIP] Missing UserID or PunchTime in row")
			continue

		try:
			punch_dt = datetime.fromisoformat(punch_time_str)
			punch_date_str = punch_dt.date().isoformat()
		except Exception:
			print(f"  [SKIP] Bad PunchTime format: {punch_time_str} for UserID {userid}")
			continue

		# STRICT FILTER: Only process punches that match exactly yesterday's date
		if punch_date_str != att_date:
			skipped_other_dates += 1
			if skipped_other_dates <= 5:  # Only print first 5 to avoid spam
				print(f"  [SKIP] Punch date {punch_date_str} != {att_date} for UserID {userid} (PunchTime: {punch_time_str})")
			continue

		# This punch is for the correct date
		user_punch_times[userid].append(punch_dt)
		kept_punches += 1

	if skipped_other_dates > 5:
		print(f"  ... and {skipped_other_dates - 5} more punches from other dates skipped")

	print(f"\n[STEP] Filtering Summary:")
	print(f"  - Total punches from API: {len(punches)}")
	print(f"  - Punches for {att_date}: {kept_punches}")
	print(f"  - Punches from other dates (skipped): {skipped_other_dates}")
	print(f"  - Users with punches for {att_date}: {len(user_punch_times)}")
	if not user_punch_times:
		print("[STOP] No valid punches after filtering by date.")
		return {"success": False, "message": "No valid punches after filtering"}

	created = 0
	updated = 0
	skipped_no_emp = 0
	present_count = 0
	absent_count = 0

	# Users with punches
	print("\n[STEP] Processing users with punches")
	for userid, times in user_punch_times.items():
		print(f"\n  -> UserID: {userid}, punch count: {len(times)}")

		emp_name = userid_to_emp.get(userid)
		if not emp_name:
			print(f"     [SKIP] No Employee.custom_employee_id = {userid}")
			skipped_no_emp += 1
			continue

		if not times:
			print("     [SKIP] No valid times after filtering")
			continue

		times.sort()
		in_time = times[0]
		out_time = times[-1] if len(times) > 1 else None

		# Double-check: Ensure in_time date matches att_date (yesterday)
		if in_time.date().isoformat() != att_date:
			print(f"     [SKIP] in_time date {in_time.date()} != {att_date} - skipping this user")
			continue

		print(f"     in_time:  {in_time} (date: {in_time.date()})")
		print(f"     out_time: {out_time} (date: {out_time.date() if out_time else 'N/A'})")
		print(f"     Creating Attendance for date: {att_date}")

		if out_time:
			status = "Present"
			present_count += 1
		else:
			status = "Absent"
			absent_count += 1
			print("     [INFO] Only 1 punch → marking Absent as per rule")

		existing = frappe.db.exists("Attendance", {"employee": emp_name, "attendance_date": att_date})

		if existing:
			doc = frappe.get_doc("Attendance", existing)
			action = "Updated"
			updated += 1
		else:
			doc = frappe.new_doc("Attendance")
			doc.employee = emp_name
			doc.attendance_date = att_date
			action = "Created"
			created += 1

		doc.status = status
		# CRITICAL: Ensure attendance_date is always yesterday (att_date)
		doc.attendance_date = att_date
		
		# Map in_time / out_time into your custom datetime fields
		# If your fieldnames are different, change them here.
		doc.custom_attendance_in_time = (
			in_time.strftime("%Y-%m-%d %H:%M:%S") if in_time else None
		)
		doc.custom_attendance_out_time = (
			out_time.strftime("%Y-%m-%d %H:%M:%S") if out_time else None
		)

		doc.flags.ignore_permissions = True
		doc.save()
		
		# Verify the saved date
		if doc.attendance_date != att_date:
			print(f"     [ERROR] Attendance date mismatch! Expected {att_date}, got {doc.attendance_date}")

		# Submit the Attendance so it is not left in Draft
		if doc.docstatus == 0:
			try:
				doc.submit()
				print(
					f"     [{action} + SUBMITTED] Attendance for {emp_name} on {att_date} -> "
					f"status={status}, in={in_time}, out={out_time}"
				)
			except Exception as e:
				print(
					f"     [ERROR] Failed to submit Attendance for {emp_name} on {att_date}: {e!s}"
				)
		else:
			print(
				f"     [{action}] Attendance (already submitted) for {emp_name} on {att_date} -> "
				f"status={status}, in={in_time}, out={out_time}"
			)

	# Users with no punches at all → Absent
	print("\n[STEP] Marking employees with NO punches as Absent")
	userids_with_punches = set(user_punch_times.keys())
	for emp in employees:
		userid = emp.custom_employee_id
		if not userid:
			continue
		if userid in userids_with_punches:
			continue

		emp_name = emp.name

		if frappe.db.exists("Attendance", {"employee": emp_name, "attendance_date": att_date}):
			print(f"  [SKIP] Attendance already exists for {emp_name} on {att_date} (no punches case)")
			continue

		doc = frappe.new_doc("Attendance")
		doc.employee = emp_name
		doc.attendance_date = att_date
		doc.status = "Absent"
		doc.flags.ignore_permissions = True
		doc.save()

		# Submit the Absent Attendance so it is not left in Draft
		if doc.docstatus == 0:
			try:
				doc.submit()
				print(f"  [Created + SUBMITTED] Absent Attendance for {emp_name} ({userid}) on {att_date}")
			except Exception as e:
				print(f"  [ERROR] Failed to submit Absent Attendance for {emp_name} on {att_date}: {e!s}")
		else:
			print(f"  [Created] Absent Attendance (already submitted) for {emp_name} ({userid}) on {att_date}")

		absent_count += 1
		created += 1

	frappe.db.commit()

	summary = {
		"success": True,
		"date": att_date,
		"present": present_count,
		"absent": absent_count,
		"created": created,
		"updated": updated,
		"skipped_no_employee": skipped_no_emp,
	}

	print("\n" + "=" * 80)
	print("SYNC SUMMARY")
	print("=" * 80)
	print(json.dumps(summary, indent=2))
	print("=" * 80 + "\n")

	return summary
