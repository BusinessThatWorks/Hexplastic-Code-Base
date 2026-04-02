# Copyright (c) 2026, beetashoke chakraborty and Contributors
# See license.txt

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from hexplastics.hexplastics.doctype.box_production.box_production import (
	OPENING_BALANCE_FIELDS,
	BoxProduction,
	_compute_next_opening_from_doc,
	_validate_finished_goods_table,
	apply_closing_balances,
	apply_derived_quantities,
	apply_opening_balances,
	get_previous_shift,
)


class TestBoxProduction(FrappeTestCase):
	def test_apply_derived_quantities(self):
		doc = frappe._dict(
			in_area_checked=5,
			front_printed=40,
			back_printed=30,
			rejected_for_dry_problem=2,
			rejected_for_printing=3,
			rejected_for_broken=1,
			die_checked=50,
			die_rejected=8,
			trim_checked=42,
			staple_checked=100,
			staple_rejected=4,
			tape_checked=90,
			tape_rejected=10,
		)

		apply_derived_quantities(doc)

		self.assertEqual(doc.transfer_to_clean_sheet, 10)
		# 40 + 30 - ((5 + 2 + 3) + 1) = 59
		self.assertEqual(doc.received_from_printing_dept, 59)
		self.assertEqual(doc.received_from_die_punching_dept, 42)
		self.assertEqual(doc.received_from_trimming_dept, 42)
		self.assertEqual(doc.received_from_stapling_dept, 48)
		self.assertEqual(doc.box_produced, 48)  # (100 - 4) // 2

	def test_apply_closing_balances(self):
		doc = frappe._dict(
			print_available_in_plant=0,
			die_available_in_plant=0,
			trim_available_in_plant=0,
			staple_available_in_plant=0,
			tape_available_in_plant=3,
			sheet_received=7000,
			front_printed=3000,
			back_printed=3400,
			received_from_printing_dept=6400,
			die_checked=6300,
			received_from_die_punching_dept=6200,
			trim_checked=6000,
			received_from_trimming_dept=6001,
			staple_checked=6001,
			staple_rejected=0,
			received_from_stapling_dept=2997,
			tape_checked=2996,
		)

		apply_closing_balances(doc)

		self.assertEqual(doc.print_available_in_plant, 600)
		self.assertEqual(doc.die_available_in_plant, 100)
		self.assertEqual(doc.trim_available_in_plant, 200)
		self.assertEqual(doc.staple_available_in_plant, 1)  # odd usable sheet remainder
		self.assertEqual(doc.tape_available_in_plant, 7)  # 3 + (6001 // 2) - 2996

	def _row(self, name, date, shift, **plant_overrides):
		r = {fn: 0 for fn in OPENING_BALANCE_FIELDS}
		r.update(
			{
				"name": name,
				"production_date": date,
				"shift_type": shift,
			}
		)
		r.update(plant_overrides)
		return r

	@patch("hexplastics.hexplastics.doctype.box_production.box_production.frappe.db.sql")
	def test_get_previous_shift_ordering(self, mock_sql):
		mock_sql.return_value = [self._row("C", "2026-03-31", "Night")]

		prev_day = get_previous_shift("2026-04-01", "Day")
		self.assertEqual(prev_day["name"], "C")
		self.assertIn("ORDER BY", mock_sql.call_args.args[0])
		self.assertIn("LIMIT 1", mock_sql.call_args.args[0])

		mock_sql.return_value = [self._row("B", "2026-03-31", "Day")]
		prev_night = get_previous_shift("2026-04-01", "Night", exclude_name="CURR")
		self.assertEqual(prev_night["name"], "B")
		self.assertEqual(mock_sql.call_args.args[1]["exclude_name"], "CURR")

	def test_apply_opening_balances(self):
		doc = frappe._dict(
			production_date="2026-04-01",
			shift_type="Day",
			name="NEW",
		)
		for fn in OPENING_BALANCE_FIELDS:
			doc[fn] = 0

		prev = self._row(
			"P",
			"2026-03-31",
			"Night",
			print_available_in_plant=7,
			tape_available_in_plant=3,
		)

		with patch(
			"hexplastics.hexplastics.doctype.box_production.box_production.get_previous_shift",
			return_value=prev,
		):
			apply_opening_balances(doc)

		self.assertEqual(doc.print_available_in_plant, 7)
		self.assertEqual(doc.tape_available_in_plant, 3)
		self.assertEqual(doc.die_available_in_plant, 0)

	def test_submit_carry_forward_chain_keeps_opening_on_prior_doc(self):
		prior = frappe._dict(
			production_date="2026-03-31",
			shift_type="Night",
			print_available_in_plant=10,
			die_available_in_plant=5,
			trim_available_in_plant=0,
			staple_available_in_plant=0,
			tape_available_in_plant=4,
			sheet_received=100,
			front_printed=40,
			back_printed=40,
			in_area_checked=5,
			rejected_for_dry_problem=3,
			rejected_for_printing=2,
			rejected_for_broken=0,
			die_checked=60,
			die_rejected=5,
			trim_checked=50,
			staple_checked=40,
			staple_rejected=0,
			tape_checked=18,
			tape_rejected=2,
		)
		apply_derived_quantities(prior)
		expected_opening = _compute_next_opening_from_doc(prior)
		self.assertEqual(prior.print_available_in_plant, 10)
		self.assertEqual(prior.tape_available_in_plant, 4)

		new_doc = frappe._dict(production_date="2026-04-01", shift_type="Day", name="NEW")
		for fn in OPENING_BALANCE_FIELDS:
			new_doc[fn] = 0

		with patch(
			"hexplastics.hexplastics.doctype.box_production.box_production.get_previous_shift",
			return_value=prior,
		):
			apply_opening_balances(new_doc)

		# Explicitly validate that all departments carry previous available stock
		# into new-doc opening balances while applying net movement from prior shift.
		self.assertEqual(new_doc.print_available_in_plant, 30)  # 10 + 100 - 40 - 40
		self.assertEqual(new_doc.die_available_in_plant, 15)  # 5 + 70 - 60
		self.assertEqual(new_doc.trim_available_in_plant, 5)  # 0 + 55 - 50
		self.assertEqual(new_doc.staple_available_in_plant, 10)  # 0 + 50 - 40 + 0
		self.assertEqual(new_doc.tape_available_in_plant, 6)  # 4 + (40 // 2) - 18

		for fieldname in OPENING_BALANCE_FIELDS:
			self.assertEqual(new_doc[fieldname], expected_opening[fieldname])

	@patch("hexplastics.hexplastics.doctype.box_production.box_production.nowtime", return_value="10:10:10")
	@patch("hexplastics.hexplastics.doctype.box_production.box_production._get_company_from_warehouses")
	@patch("hexplastics.hexplastics.doctype.box_production.box_production.frappe.get_doc")
	def test_create_submit_stock_entries(self, mock_get_doc, mock_get_company, _mock_nowtime):
		mock_get_company.return_value = "Test Company"
		created_docs = []

		class _MockStockEntry:
			def __init__(self, payload):
				self.payload = payload
				self.name = f"STE-{len(created_docs) + 1}"

			def insert(self):
				return self

			def submit(self):
				return self

		def _build_doc(payload):
			doc = _MockStockEntry(payload)
			created_docs.append(doc)
			return doc

		mock_get_doc.side_effect = _build_doc

		doc = frappe._dict()
		doc.name = "BOX-TEST-0001"
		doc.rm_source_warehouse = "RM WH - TC"
		doc.target_warehouse = "CLEAN WH - TC"
		doc.raw_material = "RAW-ITEM-001"
		doc.cleaning_item = "CLEAN-ITEM-001"
		doc.sheet_received = 100
		doc.sheet_cleaning_qty = 5
		doc.production_date = "2026-04-01"
		doc.table_aqtt = [
			frappe._dict(
				finished_item="FG-ITEM-001",
				finished_qty=50,
				fg_target_warehouse="FG WH - TC",
			),
			frappe._dict(
				finished_item="FG-ITEM-001",
				finished_qty=40,
				fg_target_warehouse="FG WH - TC",
			),
		]

		updates = {}
		doc.db_set = lambda key, value, update_modified=False: updates.update({key: value})

		BoxProduction._create_submit_stock_entries(doc)

		self.assertEqual(len(created_docs), 2)
		manufacture_payload = created_docs[0].payload
		self.assertEqual(manufacture_payload["stock_entry_type"], "Manufacture")
		self.assertEqual(manufacture_payload["posting_date"], "2026-04-01")
		self.assertEqual(manufacture_payload["posting_time"], "10:10:10")
		self.assertEqual(manufacture_payload["items"][0]["item_code"], "RAW-ITEM-001")
		self.assertEqual(manufacture_payload["items"][0]["qty"], 100)
		self.assertEqual(manufacture_payload["items"][0]["s_warehouse"], "RM WH - TC")
		self.assertEqual(manufacture_payload["items"][1]["item_code"], "FG-ITEM-001")
		self.assertEqual(manufacture_payload["items"][1]["qty"], 50)
		self.assertEqual(manufacture_payload["items"][1]["t_warehouse"], "FG WH - TC")
		self.assertEqual(manufacture_payload["items"][1]["is_finished_item"], 1)
		self.assertEqual(manufacture_payload["items"][2]["item_code"], "FG-ITEM-001")
		self.assertEqual(manufacture_payload["items"][2]["qty"], 40)
		self.assertEqual(manufacture_payload["items"][2]["is_finished_item"], 1)

		cleaning_payload = created_docs[1].payload
		self.assertEqual(cleaning_payload["stock_entry_type"], "Material Receipt")
		self.assertEqual(cleaning_payload["posting_date"], "2026-04-01")
		self.assertEqual(cleaning_payload["posting_time"], "10:10:10")
		self.assertEqual(cleaning_payload["items"][0]["item_code"], "CLEAN-ITEM-001")
		self.assertEqual(cleaning_payload["items"][0]["qty"], 5)
		self.assertEqual(cleaning_payload["items"][0]["t_warehouse"], "CLEAN WH - TC")

		self.assertEqual(updates["box_stock_entry_id"], "STE-1")
		self.assertEqual(updates["stock_entry_id"], "STE-2")

	@patch("hexplastics.hexplastics.doctype.box_production.box_production.nowtime", return_value="10:10:10")
	@patch("hexplastics.hexplastics.doctype.box_production.box_production._get_company_from_warehouses")
	@patch("hexplastics.hexplastics.doctype.box_production.box_production.frappe.get_doc")
	def test_create_submit_stock_entries_skips_cleaning_when_zero(
		self, mock_get_doc, mock_get_company, _mock_nowtime
	):
		mock_get_company.return_value = "Test Company"
		created_docs = []

		class _MockStockEntry:
			def __init__(self, payload):
				self.payload = payload
				self.name = f"STE-{len(created_docs) + 1}"

			def insert(self):
				return self

			def submit(self):
				return self

		def _build_doc(payload):
			doc = _MockStockEntry(payload)
			created_docs.append(doc)
			return doc

		mock_get_doc.side_effect = _build_doc

		doc = frappe._dict()
		doc.name = "BOX-TEST-0002"
		doc.rm_source_warehouse = "RM WH - TC"
		doc.target_warehouse = "CLEAN WH - TC"
		doc.raw_material = "RAW-ITEM-001"
		doc.cleaning_item = "CLEAN-ITEM-001"
		doc.sheet_received = 100
		doc.sheet_cleaning_qty = 0
		doc.production_date = "2026-04-01"
		doc.table_aqtt = [
			frappe._dict(
				finished_item="FG-ITEM-001",
				finished_qty=90,
				fg_target_warehouse="FG WH - TC",
			),
		]

		updates = {}
		doc.db_set = lambda key, value, update_modified=False: updates.update({key: value})

		BoxProduction._create_submit_stock_entries(doc)

		self.assertEqual(len(created_docs), 1)
		self.assertEqual(created_docs[0].payload["stock_entry_type"], "Manufacture")
		self.assertEqual(updates["box_stock_entry_id"], "STE-1")
		self.assertNotIn("stock_entry_id", updates)

	@patch("hexplastics.hexplastics.doctype.box_production.box_production.nowtime", return_value="10:10:10")
	@patch("hexplastics.hexplastics.doctype.box_production.box_production._get_company_from_warehouses")
	@patch("hexplastics.hexplastics.doctype.box_production.box_production.frappe.get_doc")
	def test_create_submit_stock_entries_does_not_recreate_manufacture_if_linked(
		self, mock_get_doc, mock_get_company, _mock_nowtime
	):
		mock_get_company.return_value = "Test Company"
		created_docs = []

		class _MockStockEntry:
			def __init__(self, payload):
				self.payload = payload
				self.name = f"STE-{len(created_docs) + 1}"

			def insert(self):
				return self

			def submit(self):
				return self

		def _build_doc(payload):
			doc = _MockStockEntry(payload)
			created_docs.append(doc)
			return doc

		mock_get_doc.side_effect = _build_doc

		doc = frappe._dict()
		doc.name = "BOX-TEST-0003"
		doc.rm_source_warehouse = "RM WH - TC"
		doc.target_warehouse = "CLEAN WH - TC"
		doc.raw_material = "RAW-ITEM-001"
		doc.cleaning_item = "CLEAN-ITEM-001"
		doc.sheet_received = 100
		doc.sheet_cleaning_qty = 5
		doc.production_date = "2026-04-01"
		doc.box_stock_entry_id = "STE-EXISTING-MANUFACTURE"
		doc.stock_entry_id = None
		doc.table_aqtt = [
			frappe._dict(
				finished_item="FG-ITEM-001",
				finished_qty=90,
				fg_target_warehouse="FG WH - TC",
			),
		]

		updates = {}
		doc.db_set = lambda key, value, update_modified=False: updates.update({key: value})

		BoxProduction._create_submit_stock_entries(doc)

		self.assertEqual(len(created_docs), 1)
		self.assertEqual(created_docs[0].payload["stock_entry_type"], "Material Receipt")
		self.assertNotIn("box_stock_entry_id", updates)
		self.assertEqual(updates["stock_entry_id"], "STE-1")

	def test_validate_finished_goods_table_requires_exact_net_tape(self):
		# net good tape = 100 - 20 = 80
		doc = frappe._dict(
			tape_checked=100,
			tape_rejected=20,
			table_aqtt=[
				frappe._dict(finished_item="FG-1", finished_qty=60, fg_target_warehouse="WH-1"),
				frappe._dict(finished_item="FG-1", finished_qty=10, fg_target_warehouse="WH-1"),
			],
		)
		with self.assertRaises(frappe.ValidationError):
			_validate_finished_goods_table(doc)

	def test_validate_finished_goods_table_allows_exact_net_tape_distribution(self):
		doc = frappe._dict(
			tape_checked=100,
			tape_rejected=20,
			table_aqtt=[
				frappe._dict(finished_item="FG-1", finished_qty=50, fg_target_warehouse="WH-1"),
				frappe._dict(finished_item="FG-1", finished_qty=30, fg_target_warehouse="WH-2"),
			],
		)
		_validate_finished_goods_table(doc)
