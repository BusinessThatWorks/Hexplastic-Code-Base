# Copyright (c) 2026, beetashoke chakraborty and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class ProductionLogSheet(Document):
	def validate(self):
		# Convert Operator ID (Employee ID) to Employee Name
		if self.operator_id:
			employee_name = self.get_employee_name(self.operator_id)
			if employee_name:
				self.operator_id = employee_name
		
		# Convert Supervisor ID (Employee ID) to Employee Name
		if self.supervisor_id:
			employee_name = self.get_employee_name(self.supervisor_id)
			if employee_name:
				self.supervisor_id = employee_name
	
	def get_employee_name(self, employee_value):
		"""
		Get employee name from Employee doctype.
		If employee_value is already a name (not found as ID), return it as is.
		If employee_value is an ID, fetch and return the employee_name.
		"""
		if not employee_value:
			return None
		
		try:
			# Try to get employee by ID/name
			employee = frappe.get_doc("Employee", employee_value)
			if employee and employee.employee_name:
				return employee.employee_name
			# If employee exists but no employee_name, return the ID as fallback
			return employee_value
		except frappe.DoesNotExistError:
			# If not found as ID, assume it's already a name
			return employee_value
		except Exception as e:
			# On any error, return the original value
			frappe.log_error(f"Error fetching employee name for {employee_value}: {str(e)}")
			return employee_value
