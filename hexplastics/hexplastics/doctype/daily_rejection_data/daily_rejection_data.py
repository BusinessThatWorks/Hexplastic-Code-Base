# Copyright (c) 2025, beetashoke chakraborty and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class DailyRejectionData(Document):
	def validate(self):
		"""Calculate total_rejection and rejection_in_%"""
		# Calculate total_rejection
		total_rejection = (
			(self.box_rejected_by_die_punching or 0) +
			(self.box_rejected_by_printing or 0) +
			(self.box_rejected_by_bending or 0) +
			(self.box_rejected_by_stepling or 0)+
			(self.box_rejected_by_dry_problem or 0)
		)
		self.total_rejection = total_rejection
		
		# Calculate rejection_in_% = (total_rejection / total_box_checked) * 100
		if self.total_box_checked and self.total_box_checked > 0:
			self.rejection_in_ = (total_rejection / self.total_box_checked) * 100
		else:
			self.rejection_in_ = 0
