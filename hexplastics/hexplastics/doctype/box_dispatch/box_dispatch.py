# Copyright (c) 2026, beetashoke chakraborty and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, nowtime


class BoxDispatch(Document):
	def validate(self):
		self.set_row_dispatched_qty()
		self.set_totals_from_items()

	def before_submit(self):
		self.validate_manufacture_rows()

	def on_submit(self):
		self.create_manufacture_stock_entry()

	def set_row_dispatched_qty(self):
		for row in self.get("table_azko") or []:
			sticker_applied_qty = cint(row.sticker_applied_qty)
			rejected_qty = cint(row.rejected_qty)
			row.dispatched_qty = sticker_applied_qty - rejected_qty

	def set_totals_from_items(self):
		total_rejected = 0
		total_dispatched = 0

		for row in self.get("table_azko") or []:
			total_rejected += cint(row.rejected_qty)
			total_dispatched += cint(row.dispatched_qty)

		self.total_rejected_qty = total_rejected
		self.total_dispatched_qty = total_dispatched

	def validate_manufacture_rows(self):
		rows = self.get("table_azko") or []
		if not rows:
			frappe.throw(_("Add at least one item row before submit."), title=_("Items required"))

		for idx, row in enumerate(rows, start=1):
			sticker_applied_qty = cint(row.sticker_applied_qty)
			rejected_qty = cint(row.rejected_qty)

			if sticker_applied_qty <= 0:
				frappe.throw(
					_("Row #{0}: Sticker Applied Qty must be greater than zero.").format(idx),
					title=_("Invalid quantity"),
				)

			if rejected_qty < 0:
				frappe.throw(
					_("Row #{0}: Rejected Qty cannot be negative.").format(idx),
					title=_("Invalid quantity"),
				)

			if rejected_qty > sticker_applied_qty:
				frappe.throw(
					_("Row #{0}: Rejected Qty cannot be greater than Sticker Applied Qty.").format(idx),
					title=_("Invalid quantity"),
				)

			if not row.box_without_stickering:
				frappe.throw(
					_("Row #{0}: Box without Stickering is required.").format(idx),
					title=_("Missing item"),
				)

			if not row.sticker_applied_item:
				frappe.throw(
					_("Row #{0}: Sticker Applied Item is required.").format(idx),
					title=_("Missing item"),
				)

			if not row.source_warehouse:
				frappe.throw(
					_("Row #{0}: Source Warehouse is required.").format(idx),
					title=_("Missing warehouse"),
				)

			if not row.target_warehouse:
				frappe.throw(
					_("Row #{0}: Target Warehouse is required.").format(idx),
					title=_("Missing warehouse"),
				)

	def create_manufacture_stock_entry(self):
		if self.stock_entry_id:
			return

		items = []
		warehouses = []
		first_finished_item = True
		for row in self.get("table_azko") or []:
			sticker_applied_qty = cint(row.sticker_applied_qty)
			if sticker_applied_qty <= 0:
				continue

			warehouses.extend([row.source_warehouse, row.target_warehouse])
			items.append(
				{
					"item_code": row.box_without_stickering,
					"qty": sticker_applied_qty,
					"s_warehouse": row.source_warehouse,
				}
			)
			items.append(
				{
					"item_code": row.sticker_applied_item,
					"qty": sticker_applied_qty,
					"t_warehouse": row.target_warehouse,
					"is_finished_item": 1 if first_finished_item else 0,
				}
			)
			first_finished_item = False

		if not items:
			frappe.throw(
				_("No valid item rows found to create Manufacture Stock Entry."),
				title=_("Stock Entry not created"),
			)

		company = self._get_company_from_warehouses(*warehouses)
		manufacture = frappe.get_doc(
			{
				"doctype": "Stock Entry",
				"stock_entry_type": "Manufacture",
				"set_posting_time": 1,
				"posting_date": self.date,
				"posting_time": nowtime(),
				"company": company,
				"remarks": _("Auto-created from Box Dispatch {0}").format(self.name),
				"items": items,
			}
		)
		manufacture.insert()
		manufacture.submit()
		self.db_set("stock_entry_id", manufacture.name, update_modified=False)

	def _get_company_from_warehouses(self, *warehouses):
		companies = {
			frappe.db.get_value("Warehouse", warehouse, "company") for warehouse in warehouses if warehouse
		}
		companies.discard(None)

		if len(companies) > 1:
			frappe.throw(
				_("Selected warehouses belong to different companies."),
				title=_("Invalid warehouses"),
			)

		if companies:
			return companies.pop()

		default_company = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value(
			"Global Defaults", "default_company"
		)
		if not default_company:
			frappe.throw(_("Unable to determine company for Stock Entry."), title=_("Missing company"))
		return default_company
