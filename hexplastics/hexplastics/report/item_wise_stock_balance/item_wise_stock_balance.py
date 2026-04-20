import frappe
from frappe import _
from frappe.utils import flt

from erpnext.stock.report.stock_balance.stock_balance import StockBalanceReport


def execute(filters=None):
	filters = frappe._dict(filters or {})
	columns = get_columns()
	data = get_data(filters)
	return columns, data


def get_data(filters):
	# Reuse ERPNext Stock Balance report as the base data source.
	_, stock_balance_data = StockBalanceReport(filters).run()
	item_map = {}

	for row in stock_balance_data:
		item_code = row.get("item_code")
		if not item_code:
			continue

		if item_code not in item_map:
			item_map[item_code] = frappe._dict(
				{
					"item_code": item_code,
					"item_name": row.get("item_name"),
					"item_group": row.get("item_group"),
					"stock_uom": row.get("stock_uom"),
					"bal_qty": 0.0,
				}
			)

		item_map[item_code].bal_qty += flt(row.get("bal_qty"))

	return sorted(item_map.values(), key=lambda d: d.item_code)


def get_columns():
	return [
		{
			"label": _("Item"),
			"fieldname": "item_code",
			"fieldtype": "Link",
			"options": "Item",
			"width": 140,
		},
		{"label": _("Item Name"), "fieldname": "item_name", "fieldtype": "Data", "width": 220},
		{
			"label": _("Item Group"),
			"fieldname": "item_group",
			"fieldtype": "Link",
			"options": "Item Group",
			"width": 160,
		},
		{
			"label": _("Stock UOM"),
			"fieldname": "stock_uom",
			"fieldtype": "Link",
			"options": "UOM",
			"width": 120,
		},
		{
			"label": _("Balance Qty"),
			"fieldname": "bal_qty",
			"fieldtype": "Float",
			"width": 140,
		},
	]
