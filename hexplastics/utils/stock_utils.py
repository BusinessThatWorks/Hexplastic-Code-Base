"""Utility functions for stock management and monitoring."""

import frappe
from frappe import _


def get_all_items_stock_quantity(warehouse=None, item_group=None, include_zero_stock=False):
	"""
	Get stock quantity for all items.

	Args:
		warehouse: Optional warehouse filter. If None, returns stock across all warehouses.
		item_group: Optional item group filter.
		include_zero_stock: If True, includes items with zero stock. Default is False.

	Returns:
		list: List of dictionaries containing item_code, item_name, stock_qty, and warehouse
	"""
	filters = {}

	# Build filters for Bin query
	if warehouse:
		filters["warehouse"] = warehouse

	# Get all items first
	item_filters = {"disabled": 0}  # Only get enabled items
	if item_group:
		item_filters["item_group"] = item_group

	items = frappe.get_all(
		"Item", filters=item_filters, fields=["name", "item_name", "item_group", "stock_uom"], order_by="name"
	)

	# Get stock quantities from Bin
	stock_data = []

	for item in items:
		item_code = item.name

		# Query Bin for this item
		bin_filters = {"item_code": item_code}
		if warehouse:
			bin_filters["warehouse"] = warehouse

		bins = frappe.get_all(
			"Bin",
			filters=bin_filters,
			fields=["warehouse", "actual_qty", "reserved_qty", "ordered_qty", "projected_qty"],
		)

		if bins:
			# If warehouse specified, return single warehouse data
			# Otherwise, aggregate across all warehouses
			if warehouse:
				bin_data = bins[0] if bins else {}
				total_qty = bin_data.get("actual_qty", 0) or 0

				if include_zero_stock or total_qty > 0:
					stock_data.append(
						{
							"item_code": item_code,
							"item_name": item.item_name,
							"item_group": item.item_group,
							"stock_uom": item.stock_uom,
							"warehouse": warehouse,
							"actual_qty": total_qty,
							"reserved_qty": bin_data.get("reserved_qty", 0) or 0,
							"ordered_qty": bin_data.get("ordered_qty", 0) or 0,
							"projected_qty": bin_data.get("projected_qty", 0) or 0,
						}
					)
			else:
				# Aggregate across all warehouses
				total_actual_qty = sum((bin.get("actual_qty", 0) or 0) for bin in bins)
				total_reserved_qty = sum((bin.get("reserved_qty", 0) or 0) for bin in bins)
				total_ordered_qty = sum((bin.get("ordered_qty", 0) or 0) for bin in bins)
				total_projected_qty = sum((bin.get("projected_qty", 0) or 0) for bin in bins)

				if include_zero_stock or total_actual_qty > 0:
					stock_data.append(
						{
							"item_code": item_code,
							"item_name": item.item_name,
							"item_group": item.item_group,
							"stock_uom": item.stock_uom,
							"warehouse": "All Warehouses",
							"actual_qty": total_actual_qty,
							"reserved_qty": total_reserved_qty,
							"ordered_qty": total_ordered_qty,
							"projected_qty": total_projected_qty,
						}
					)
		else:
			# Item has no Bin record (no stock ever)
			if include_zero_stock:
				stock_data.append(
					{
						"item_code": item_code,
						"item_name": item.item_name,
						"item_group": item.item_group,
						"stock_uom": item.stock_uom,
						"warehouse": warehouse or "All Warehouses",
						"actual_qty": 0,
						"reserved_qty": 0,
						"ordered_qty": 0,
						"projected_qty": 0,
					}
				)

	return stock_data


def get_item_stock_quantity(item_code, warehouse=None):
	"""
	Get stock quantity for a specific item.

	Args:
		item_code: Item code to check
		warehouse: Optional warehouse filter

	Returns:
		dict: Stock quantity information for the item
	"""
	if not item_code:
		frappe.throw(_("Item Code is required"))

	if warehouse:
		# Use frappe.db.get_value for direct warehouse query (simpler and faster)
		current_stock = (
			frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "actual_qty") or 0
		)
		return {
			"item_code": item_code,
			"warehouse": warehouse,
			"actual_qty": current_stock,
			"reserved_qty": frappe.db.get_value(
				"Bin", {"item_code": item_code, "warehouse": warehouse}, "reserved_qty"
			)
			or 0,
			"ordered_qty": frappe.db.get_value(
				"Bin", {"item_code": item_code, "warehouse": warehouse}, "ordered_qty"
			)
			or 0,
			"projected_qty": frappe.db.get_value(
				"Bin", {"item_code": item_code, "warehouse": warehouse}, "projected_qty"
			)
			or 0,
		}
	else:
		# Aggregate across all warehouses if no warehouse specified
		bins = frappe.get_all(
			"Bin",
			filters={"item_code": item_code},
			fields=["warehouse", "actual_qty", "reserved_qty", "ordered_qty", "projected_qty"],
		)

		if bins:
			return {
				"item_code": item_code,
				"warehouse": "All Warehouses",
				"actual_qty": sum((bin.get("actual_qty", 0) or 0) for bin in bins),
				"reserved_qty": sum((bin.get("reserved_qty", 0) or 0) for bin in bins),
				"ordered_qty": sum((bin.get("ordered_qty", 0) or 0) for bin in bins),
				"projected_qty": sum((bin.get("projected_qty", 0) or 0) for bin in bins),
				"warehouses": [bin.get("warehouse") for bin in bins],
			}
		else:
			return {
				"item_code": item_code,
				"warehouse": "All Warehouses",
				"actual_qty": 0,
				"reserved_qty": 0,
				"ordered_qty": 0,
				"projected_qty": 0,
			}
