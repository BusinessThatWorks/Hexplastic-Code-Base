# Copyright (c) 2025, beetashoke chakraborty and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class DailyRejectionData(Document):
	def validate(self):
		"""Calculate totals from child rows and rejection percentage.

		Authoritative calculation happens on the server to keep data consistent
		with client-side JS, but we now read from the child table
		`table_zsze` (Daily Rejection Data Table) instead of old parent fields.
		"""

		day_total = 0
		night_total = 0
		overall_total = 0

		# Sum up all child rows
		for row in self.get("table_zsze") or []:
			# Treat empty as 0
			die_punch = row.box_rejected_by_die_punching or 0
			printing = row.box_rejected_by_printing or 0
			bending = row.box_rejected_by_bending or 0
			stepling = row.box_rejected_by_stepling or 0
			dry_problem = row.box_rejected_by_dry_problem or 0

			row_total = die_punch + printing + bending + stepling + dry_problem

			# keep row_total_rejection in sync (in case it was not set from JS)
			row.row_total_rejection = row_total

			if row.shift_type == "Day":
				day_total += row_total
			elif row.shift_type == "Night":
				night_total += row_total

			overall_total += row_total

		# Set parent fields
		self.total_rejected_in_day_shift = day_total
		self.total_rejected_in_night_shift = night_total
		self.total_rejection = overall_total

		# Calculate rejection_in_% = (total_rejection / total_box_checked) * 100
		if self.total_box_checked and self.total_box_checked > 0:
			self.rejection_in_ = (overall_total / float(self.total_box_checked)) * 100
		else:
			self.rejection_in_ = 0
