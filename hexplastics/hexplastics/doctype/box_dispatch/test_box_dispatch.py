# Copyright (c) 2026, beetashoke chakraborty and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase


class TestBoxDispatch(FrappeTestCase):
	def _new_dispatch_doc(self, **fields):
		data = {
			"doctype": "Box Dispatch",
			"date": "2026-04-08",
			"location": "_Test Box Dispatch Location",
			"table_azko": [],
			"total_rejected_qty": 0,
			"total_dispatched_qty": 0,
		}
		data.update(fields)
		return frappe.get_doc(data)

	def test_validate_sets_totals_from_items(self):
		doc = self._new_dispatch_doc(
			table_azko=[
				{"sticker_applied_qty": 20, "rejected_qty": 3},
				{"sticker_applied_qty": 11, "rejected_qty": 2},
			]
		)
		doc.validate()

		self.assertEqual(doc.total_rejected_qty, 5)
		self.assertEqual(doc.total_dispatched_qty, 26)
		self.assertEqual(doc.table_azko[0].dispatched_qty, 17)
		self.assertEqual(doc.table_azko[1].dispatched_qty, 9)

	def test_validate_keeps_date_manual(self):
		doc = self._new_dispatch_doc(
			date="2026-04-01",
			table_azko=[{"sticker_applied_qty": 2, "rejected_qty": 1}],
		)
		doc.validate()

		self.assertEqual(doc.date, "2026-04-01")

	def test_totals_support_zero_and_empty_values(self):
		doc = self._new_dispatch_doc(
			table_azko=[
				{"sticker_applied_qty": 0, "rejected_qty": 0},
				{"sticker_applied_qty": None, "rejected_qty": ""},
				{"sticker_applied_qty": 9, "rejected_qty": 4},
			]
		)
		doc.validate()

		self.assertEqual(doc.total_rejected_qty, 4)
		self.assertEqual(doc.total_dispatched_qty, 5)
