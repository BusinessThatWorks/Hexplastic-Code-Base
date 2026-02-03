# Copyright (c) 2026, beetashoke chakraborty and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt


class RecycleMachineDailyProduction(Document):
	"""Custom controller for Recycle Machine Daily Production.
	
	On submit, automatically creates and submits a Manufacture-type Stock Entry
	based on the Production Details table.
	"""

	def on_submit(self):
		"""Create and submit Manufacture Stock Entry on submit.
		
		Rules:
		- Only create if no stock_entry_no already exists (prevent duplicates)
		- Map items from production_details table
		- Source items: grinding_mip_item from grinding_mip_source_warehouse
		- Target items: pp_mip_item to pp_mip_target_warehouse
		- Submit Stock Entry automatically
		- Set stock_entry_no only after successful submission
		"""
		# Prevent duplicate Stock Entry creation
		if self.stock_entry_no:
			frappe.msgprint(
				f"Stock Entry {self.stock_entry_no} already exists. Skipping creation.",
				alert=True,
				indicator="blue"
			)
			return

		# Validate that production_details table exists and has data
		if not getattr(self, "production_details", None) or not self.production_details:
			frappe.throw(
				"Cannot create Stock Entry: Production Details table is empty."
			)

		# Validate that we have at least one valid row with required fields
		has_valid_source = False
		has_valid_target = False

		for row in self.production_details:
			if row.item_code and row.grinding_mip_source_warehouse and flt(row.material_consumed or 0) > 0:
				has_valid_source = True
			if row.pp_mip_item and row.pp_mip_target_warehouse and flt(row.pp_mip_production or 0) > 0:
				has_valid_target = True

		if not has_valid_source:
			frappe.throw(
				"Cannot create Stock Entry: No valid source items found. "
				"At least one row must have Grinding MIP Item, Source Warehouse, and Material Consumed > 0."
			)

		if not has_valid_target:
			frappe.throw(
				"Cannot create Stock Entry: No valid target items found. "
				"At least one row must have PP MIP Item, Target Warehouse, and PP MIP Production > 0."
			)

		try:
			# Create new Stock Entry
			stock_entry = frappe.new_doc("Stock Entry")
			stock_entry.stock_entry_type = "Manufacture"

			# Map parent fields
			stock_entry.posting_date = self.production_date
			
			# Map custom fields if they exist on Stock Entry
			if hasattr(stock_entry, "custom_shift_type"):
				stock_entry.custom_shift_type = self.shift_type
			if hasattr(stock_entry, "custom_supervisor_id"):
				stock_entry.custom_supervisor_id = self.supervisor_id
			if hasattr(stock_entry, "custom_supervisor_name"):
				stock_entry.custom_supervisor_name = self.supervisor_name

			# Set posting time if available
			if hasattr(stock_entry, "set_posting_time"):
				stock_entry.set_posting_time = 1

			# Build Stock Entry Items from production_details table
			for row in self.production_details:
				_add_items_from_production_row(stock_entry, row)

			# Validate that we have items
			if not stock_entry.items:
				frappe.throw(
					"No valid Stock Entry Items could be created from Production Details table."
				)

			# Insert the Stock Entry
			stock_entry.insert(ignore_permissions=True)

			# Calculate rates for all items
			stock_entry.calculate_rate_and_amount()

			# Save the Stock Entry
			stock_entry.save(ignore_permissions=True)

			# Submit the Stock Entry
			stock_entry.submit()

			# Only set stock_entry_no after successful submission
			# Use db_set to avoid dirtying the document and prevent recursion
			self.db_set("stock_entry_no", stock_entry.name, update_modified=False)

			frappe.msgprint(
				f"Stock Entry {stock_entry.name} created and submitted successfully.",
				alert=True,
				indicator="green"
			)

		except Exception as e:
			# Log the error for debugging
			frappe.log_error(
				frappe.get_traceback(),
				f"Error creating Stock Entry for Recycle Machine Daily Production {self.name}"
			)
			# Prevent submit and show clear error
			# Do NOT populate stock_entry_no if Stock Entry creation fails
			frappe.throw(
				f"Failed to create Manufacture Stock Entry: {frappe.utils.cstr(e)}"
			)


def _add_items_from_production_row(stock_entry, row) -> None:
	"""Append Stock Entry Items based on a single Production Details row.
	
	Rules:
	- Source item: grinding_mip_item from grinding_mip_source_warehouse (qty = material_consumed)
	- Target item: pp_mip_item to pp_mip_target_warehouse (qty = pp_mip_production, is_finished_item = 1)
	- Skip items with zero or negative quantities
	- Validate required fields
	"""
	
	# SOURCE ITEM: Grinding MIP Item (Raw Material)
	if row.item_code and row.grinding_mip_source_warehouse:
		qty = flt(row.material_consumed or 0)
		
		if qty < 0:
			frappe.throw(
				f"Row for Item {row.item_code or ''}: "
				"Material Consumed cannot be negative."
			)
		
		# Only append if qty > 0
		if qty > 0:
			stock_entry.append(
				"items",
				_make_stock_entry_item(
					item_code=row.item_code,
					qty=qty,
					s_warehouse=row.grinding_mip_source_warehouse,
					t_warehouse=None,
					stock_uom=getattr(row, "default_uom", None),
					is_finished_item=0,
					is_scrap_item=0,
				),
			)
	
	# TARGET ITEM: PP MIP Item (Finished Good)
	if row.pp_mip_item and row.pp_mip_target_warehouse:
		qty = flt(row.pp_mip_production or 0)
		
		if qty < 0:
			frappe.throw(
				f"Row for Item {row.pp_mip_item or ''}: "
				"PP MIP Production cannot be negative."
			)
		
		# Only append if qty > 0
		if qty > 0:
			stock_entry.append(
				"items",
				_make_stock_entry_item(
					item_code=row.pp_mip_item,
					qty=qty,
					s_warehouse=None,
					t_warehouse=row.pp_mip_target_warehouse,
					stock_uom=None,  # Will be fetched from item master
					is_finished_item=1,
					is_scrap_item=0,
				),
			)


def _make_stock_entry_item(
	*,
	item_code: str,
	qty: float,
	s_warehouse: str | None,
	t_warehouse: str | None,
	stock_uom: str | None,
	is_finished_item: int = 0,
	is_scrap_item: int = 0,
):
	"""Helper to construct a single Stock Entry Item. Rate will be calculated by ERPNext."""
	
	if not item_code:
		frappe.throw("Item Code is mandatory in Production Details rows.")
	
	if not s_warehouse and not t_warehouse:
		frappe.throw(
			f"Warehouse is mandatory for Item {item_code}. "
			"Either Source Warehouse or Target Warehouse must be set."
		)
	
	if flt(qty) < 0:
		frappe.throw(f"Quantity cannot be negative for Item {item_code}.")
	
	# Get stock_uom from item if not provided
	if not stock_uom:
		stock_uom = frappe.db.get_value("Item", item_code, "stock_uom")
	
	item_dict = {
		"item_code": item_code,
		"qty": qty,
		"s_warehouse": s_warehouse,
		"t_warehouse": t_warehouse,
		"uom": stock_uom,
		"stock_uom": stock_uom,
		"conversion_factor": 1,
		"is_finished_item": is_finished_item,
		"is_scrap_item": is_scrap_item,
	}
	
	return item_dict
