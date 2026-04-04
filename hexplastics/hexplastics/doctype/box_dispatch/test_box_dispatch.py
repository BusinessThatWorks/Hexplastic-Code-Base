# Copyright (c) 2026, beetashoke chakraborty and Contributors
# See license.txt

from unittest.mock import MagicMock, patch

import frappe
from frappe.tests.utils import FrappeTestCase


class TestBoxDispatch(FrappeTestCase):
	def _mock_box_production(self, **kwargs):
		defaults = {
			"production_date": "2026-04-05",
			"shift_type": "Day",
			"tape_checked": 100,
			"tape_rejected": 15,
		}
		defaults.update(kwargs)
		mock_bp = MagicMock()
		for k, v in defaults.items():
			setattr(mock_bp, k, v)
		return mock_bp

	def _new_dispatch_doc(self, **fields):
		data = {
			"doctype": "Box Dispatch",
			"box_production_id": "BOX-MOCK-001",
			"date": "2020-01-01",
			"shift_type": "Wrong",
			"stickering_done": 10,
			"no_of_boxes_checked": 80,
			"no_of_boxes_rejected": 5,
			"received_from_taping_dept": 0,
			"dispatched_qty": 0,
		}
		data.update(fields)
		return frappe.get_doc(data)

	def _patch_get_doc_for_box_production(self, mock_bp):
		"""Must capture real get_doc before patching to avoid recursion."""
		real_get_doc = frappe.get_doc

		def get_doc_side_effect(*args, **kwargs):
			if len(args) >= 2 and args[0] == "Box Production":
				return mock_bp
			return real_get_doc(*args, **kwargs)

		return patch.object(frappe, "get_doc", side_effect=get_doc_side_effect)

	def test_validate_derives_from_box_production(self):
		mock_bp = self._mock_box_production()
		with self._patch_get_doc_for_box_production(mock_bp):
			doc = self._new_dispatch_doc()
			doc.validate()

		self.assertEqual(doc.date, "2026-04-05")
		self.assertEqual(doc.shift_type, "Day")
		self.assertEqual(doc.received_from_taping_dept, 85)
		self.assertEqual(doc.dispatched_qty, 75)

	def test_validate_received_from_taping_non_negative(self):
		mock_bp = self._mock_box_production(tape_checked=10, tape_rejected=30)
		with self._patch_get_doc_for_box_production(mock_bp):
			doc = self._new_dispatch_doc()
			doc.validate()

		self.assertEqual(doc.received_from_taping_dept, 0)

	def test_validate_dispatched_qty_non_negative(self):
		mock_bp = self._mock_box_production()
		with self._patch_get_doc_for_box_production(mock_bp):
			doc = self._new_dispatch_doc(no_of_boxes_checked=5, no_of_boxes_rejected=20)
			doc.validate()

		self.assertEqual(doc.dispatched_qty, 0)

	def test_apply_from_box_production_skips_without_link(self):
		doc = frappe.new_doc("Box Dispatch")
		doc.box_production_id = None
		doc.date = "2026-06-01"
		doc.shift_type = "Night"
		doc.received_from_taping_dept = 99

		real_get_doc = frappe.get_doc

		def get_doc_side_effect(*args, **kwargs):
			if len(args) >= 2 and args[0] == "Box Production":
				raise AssertionError("Box Production should not be loaded when link is empty")
			return real_get_doc(*args, **kwargs)

		with patch.object(frappe, "get_doc", side_effect=get_doc_side_effect):
			doc.apply_from_box_production()

		self.assertEqual(doc.date, "2026-06-01")
		self.assertEqual(doc.shift_type, "Night")
		self.assertEqual(doc.received_from_taping_dept, 99)

	def test_set_dispatched_qty_on_new_doc(self):
		doc = frappe.new_doc("Box Dispatch")
		doc.no_of_boxes_checked = 50
		doc.no_of_boxes_rejected = 12
		doc.set_dispatched_qty()
		self.assertEqual(doc.dispatched_qty, 38)
