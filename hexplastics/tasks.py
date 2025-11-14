"""Scheduled tasks for Hexplastics app."""

import frappe
from frappe import _
from hexplastics.utils.stock_utils import get_item_stock_quantity


def check_stock_levels_and_send_alert():
	"""
	Check all items' stock quantity against safety_stock in Stores - HP warehouse.
	Send email alert if items have low stock (stock < safety_stock).
	Runs at 12:30 PM daily.
	"""
	try:
		warehouse = "Stores - HP"

		# Get all items with safety_stock > 0
		items = frappe.get_all(
			"Item",
			filters={"disabled": 0, "safety_stock": [">", 0]},
			fields=["name", "item_name", "safety_stock"],
			order_by="name",
		)

		if not items:
			frappe.log_error("No items found with safety_stock > 0", "Stock Alert Check")
			return

		low_stock_items = []

		# Check each item's stock in Stores - HP warehouse
		for item in items:
			item_code = item.name
			safety_stock = item.safety_stock or 0

			# Get stock quantity for this item in Stores - HP
			stock_data = get_item_stock_quantity(item_code=item_code, warehouse=warehouse)
			actual_qty = stock_data.get("actual_qty", 0) or 0

			# Check if stock is less than safety_stock
			if actual_qty < safety_stock:
				low_stock_items.append(
					{
						"item_code": item_code,
						"item_name": item.item_name,
						"safety_stock": safety_stock,
						"current_stock": actual_qty,
					}
				)

		# Prepare email content
		if low_stock_items:
			# Items with low stock found - send alert with item names
			subject = "Stock Alert: Items Below Safety Stock Level"

			# Create HTML table for better formatting
			message = f"""
			<p>Dear Team,</p>
			<p>The following items have stock quantity below their safety stock level in <strong>{warehouse}</strong>:</p>
			<table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; width: 100%;">
				<thead>
					<tr style="background-color: #f0f0f0;">
						<th>Item Code</th>
						<th>Item Name</th>
						<th>Safety Stock</th>
						<th>Current Stock</th>
						<th>Shortage</th>
					</tr>
				</thead>
				<tbody>
			"""

			for item in low_stock_items:
				shortage = item["safety_stock"] - item["current_stock"]
				message += f"""
					<tr>
						<td>{item["item_code"]}</td>
						<td>{item["item_name"]}</td>
						<td>{item["safety_stock"]}</td>
						<td style="color: red; font-weight: bold;">{item["current_stock"]}</td>
						<td style="color: red; font-weight: bold;">{shortage}</td>
					</tr>
				"""

			message += """
				</tbody>
			</table>
			<p><strong>Please take necessary action to replenish stock.</strong></p>
			<p>This is an automated alert from Hexplastics Stock Monitoring System.</p>
			"""
		else:
			# All items have sufficient stock
			subject = "Stock Status: All Items Have Correct Stock"
			message = f"""
			<p>Dear Team,</p>
			<p><strong>All your items have correct stock in {warehouse}.</strong></p>
			<p>All items meet or exceed their safety stock levels.</p>
			<p>This is an automated alert from Hexplastics Stock Monitoring System.</p>
			"""

		# Set recipient email
		recipient_email = ["beetashoke.chakraborty@clapgrow.com"]

		# Send email
		frappe.sendmail(recipients=recipient_email, subject=subject, message=message, now=True)

		frappe.logger().info(
			f"Stock alert email sent to {recipient_email}. Low stock items: {len(low_stock_items)}"
		)

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Stock Alert Check Error")
		# Don't throw exception in scheduled task - just log the error
		frappe.logger().error(f"Error checking stock levels: {str(e)}")
