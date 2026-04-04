# Copyright (c) 2026, beetashoke chakraborty and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import cint


class BoxDispatch(Document):
	def validate(self):
		self.apply_from_box_production()
		self.set_dispatched_qty()

	def apply_from_box_production(self):
		if not self.box_production_id:
			return
		bp = frappe.get_doc("Box Production", self.box_production_id)
		self.date = bp.production_date
		self.shift_type = bp.shift_type
		tape_ok = cint(bp.tape_checked) - cint(bp.tape_rejected)
		self.received_from_taping_dept = max(0, tape_ok)

	def set_dispatched_qty(self):
		self.dispatched_qty = max(0, cint(self.no_of_boxes_checked) - cint(self.no_of_boxes_rejected))
