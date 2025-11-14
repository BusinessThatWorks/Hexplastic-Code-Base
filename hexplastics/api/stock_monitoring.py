"""API endpoints for stock monitoring."""

import frappe
from frappe import _
from hexplastics.utils.stock_utils import get_all_items_stock_quantity, get_item_stock_quantity
from hexplastics.tasks import check_stock_levels_and_send_alert


@frappe.whitelist()
def get_all_items_stock(warehouse=None, item_group=None, include_zero_stock=False):
	"""
	API endpoint to get stock quantity for all items.

	Args:
		warehouse: Optional warehouse filter
		item_group: Optional item group filter
		include_zero_stock: Include items with zero stock (default: False)

	Returns:
		dict: Contains list of items with their stock quantities
	"""
	try:
		stock_data = get_all_items_stock_quantity(
			warehouse=warehouse,
			item_group=item_group,
			include_zero_stock=frappe.parse_json(include_zero_stock)
			if isinstance(include_zero_stock, str)
			else include_zero_stock,
		)

		return {"success": True, "data": stock_data, "count": len(stock_data)}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Stock Monitoring API Error")
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def get_item_stock(item_code, warehouse=None):
	"""
	API endpoint to get stock quantity for a specific item.

	Args:
		item_code: Item code to check
		warehouse: Optional warehouse filter

	Returns:
		dict: Stock quantity information for the item
	"""
	try:
		if not item_code:
			return {"success": False, "error": "Item Code is required"}

		stock_data = get_item_stock_quantity(item_code=item_code, warehouse=warehouse)

		return {"success": True, "data": stock_data}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Stock Monitoring API Error")
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def get_stock_summary(warehouse=None, item_group=None):
	"""
	API endpoint to get a summary of stock quantities.

	Args:
		warehouse: Optional warehouse filter
		item_group: Optional item group filter

	Returns:
		dict: Summary statistics of stock
	"""
	try:
		stock_data = get_all_items_stock_quantity(
			warehouse=warehouse, item_group=item_group, include_zero_stock=False
		)

		total_items = len(stock_data)
		total_qty = sum(item.get("actual_qty", 0) for item in stock_data)
		items_with_stock = len([item for item in stock_data if item.get("actual_qty", 0) > 0])

		# Group by item group
		by_item_group = {}
		for item in stock_data:
			group = item.get("item_group", "Unknown")
			if group not in by_item_group:
				by_item_group[group] = {"count": 0, "total_qty": 0}
			by_item_group[group]["count"] += 1
			by_item_group[group]["total_qty"] += item.get("actual_qty", 0)

		return {
			"success": True,
			"summary": {
				"total_items": total_items,
				"items_with_stock": items_with_stock,
				"total_quantity": total_qty,
				"by_item_group": by_item_group,
			},
		}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Stock Monitoring API Error")
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def test_stock_alert():
	"""
	API endpoint to manually test the stock alert function.
	This will check stock levels and send email alert.

	Returns:
		dict: Success status and message
	"""
	try:
		check_stock_levels_and_send_alert()
		return {
			"success": True,
			"message": "Stock alert check completed. Email has been sent if applicable.",
		}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Stock Alert Test Error")
		return {"success": False, "error": str(e)}
