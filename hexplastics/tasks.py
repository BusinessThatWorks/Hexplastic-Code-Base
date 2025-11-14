"""Scheduled tasks for Hexplastics app."""

import re

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
		warehouse = "All Warehouses - HEX"

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

		# Log email content for debugging
		frappe.logger().info("=" * 80)
		frappe.logger().info("STOCK ALERT EMAIL - DETAILED LOG")
		frappe.logger().info("=" * 80)
		frappe.logger().info(f"Recipient: {recipient_email}")
		frappe.logger().info(f"Subject: {subject}")
		frappe.logger().info(f"Total items checked: {len(items)}")
		frappe.logger().info(f"Low stock items found: {len(low_stock_items)}")
		frappe.logger().info("-" * 80)

		if low_stock_items:
			frappe.logger().info("LOW STOCK ITEMS:")
			frappe.logger().info(
				f"{'Item Code':<20} {'Item Name':<30} {'Safety Stock':<15} {'Current Stock':<15} {'Shortage':<15}"
			)
			frappe.logger().info("-" * 80)
			for item in low_stock_items:
				shortage = item["safety_stock"] - item["current_stock"]
				frappe.logger().info(
					f"{item['item_code']:<20} {item['item_name']:<30} {item['safety_stock']:<15} {item['current_stock']:<15} {shortage:<15}"
				)
		else:
			frappe.logger().info("All items have sufficient stock!")

		frappe.logger().info("-" * 80)
		frappe.logger().info("EMAIL MESSAGE CONTENT:")
		frappe.logger().info("-" * 80)
		# Convert HTML to plain text for logging
		plain_message = re.sub(r"<[^>]+>", "", message)  # Remove HTML tags
		plain_message = plain_message.replace("&nbsp;", " ").strip()
		frappe.logger().info(plain_message)
		frappe.logger().info("=" * 80)

		# Print email content to console before sending
		# Using both print and frappe.print for better visibility
		email_output = f"""
{"=" * 80}
EMAIL CONTENT (BEFORE SENDING):
{"=" * 80}
To: {", ".join(recipient_email)}
Subject: {subject}
{"-" * 80}
Message Body (Plain Text):
{"-" * 80}
{plain_message}
{"=" * 80}

Full HTML Message:
{"-" * 80}
{message}
{"=" * 80}
"""
		print(email_output)
		frappe.print(email_output)  # Also use frappe.print for console visibility

		# Send email
		try:
			frappe.sendmail(recipients=recipient_email, subject=subject, message=message, now=True)
			frappe.logger().info(f"✓ Email sent successfully to {recipient_email}")
		except Exception as email_error:
			frappe.log_error(
				f"Failed to send email: {str(email_error)}\n{frappe.get_traceback()}",
				"Stock Alert Email Error",
			)
			frappe.logger().error(f"✗ Failed to send email: {str(email_error)}")

		frappe.logger().info("=" * 80)

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Stock Alert Check Error")
		# Don't throw exception in scheduled task - just log the error
		frappe.logger().error(f"Error checking stock levels: {str(e)}")
