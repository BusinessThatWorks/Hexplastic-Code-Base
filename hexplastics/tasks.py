"""Scheduled tasks for Hexplastics app."""

import re
import sys

import frappe
from frappe import _
from hexplastics.utils.stock_utils import get_item_stock_quantity


def check_stock_levels_and_send_alert():
	"""
	Check all items' stock quantity against safety_stock across 3 warehouses.
	Sum stock from: Production - HEX, Raw Material - HEX, Finished Goods - HEX
	Send red alert email if total stock < safety_stock, else send green alert.
	Runs at 9:00 AM daily.
	"""
	print("\n>>> Starting stock alert check...\n")
	sys.stdout.flush()

	try:
		# List of warehouses to check
		warehouses = ["Production - HEX", "Raw Material - HEX", "Finished Goods - HEX"]

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

		# Check each item's stock across all 3 warehouses
		for item in items:
			item_code = item.name
			safety_stock = item.safety_stock or 0

			# Get stock quantity for this item from each warehouse and sum them
			total_stock = 0
			warehouse_stocks = {}

			for warehouse in warehouses:
				stock_data = get_item_stock_quantity(item_code=item_code, warehouse=warehouse)
				warehouse_qty = stock_data.get("actual_qty", 0) or 0
				warehouse_stocks[warehouse] = warehouse_qty
				total_stock += warehouse_qty

			# Check if total stock is less than safety_stock
			if total_stock < safety_stock:
				low_stock_items.append(
					{
						"item_code": item_code,
						"item_name": item.item_name,
						"safety_stock": safety_stock,
						"current_stock": total_stock,
						"warehouse_stocks": warehouse_stocks,  # Store individual warehouse stocks
					}
				)

		# Prepare email content
		warehouse_list = ", ".join(warehouses)

		if low_stock_items:
			# Items with low stock found - send red alert with item names
			subject = "🔴 Stock Alert: Items Below Safety Stock Level"

			# Create HTML table for better formatting
			message = f"""
			<p>Dear Team,</p>
			<p>The following items have stock quantity below their safety stock level across warehouses: <strong>{warehouse_list}</strong>:</p>
			<table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; width: 100%;">
				<thead>
					<tr style="background-color: #f0f0f0;">
						<th>Item Code</th>
						<th>Item Name</th>
						<th>Safety Stock</th>
						<th>Total Current Stock</th>
						<th>Shortage</th>
						<th>Warehouse Breakdown</th>
					</tr>
				</thead>
				<tbody>
			"""

			for item in low_stock_items:
				shortage = item["safety_stock"] - item["current_stock"]
				warehouse_details = item.get("warehouse_stocks", {})
				warehouse_breakdown = ", ".join([f"{wh}: {qty:.2f}" for wh, qty in warehouse_details.items()])
				message += f"""
					<tr>
						<td>{item["item_code"]}</td>
						<td>{item["item_name"]}</td>
						<td>{item["safety_stock"]:.2f}</td>
						<td style="color: red; font-weight: bold;">{item["current_stock"]:.2f}</td>
						<td style="color: red; font-weight: bold;">{shortage:.2f}</td>
						<td>{warehouse_breakdown}</td>
					</tr>
				"""

			message += """
				</tbody>
			</table>
			<p><strong>Please take necessary action to replenish stock.</strong></p>
			<p>This is an automated alert from Hexplastics Stock Monitoring System.</p>
			"""
		else:
			# All items have sufficient stock - send green alert
			subject = "🟢 Stock Status: All Items Have Correct Stock"
			message = f"""
			<p>Dear Team,</p>
			<p><strong style="color: green;">✅ All your items have correct stock across warehouses: {warehouse_list}.</strong></p>
			<p>All items meet or exceed their safety stock levels.</p>
			<p>This is an automated alert from Hexplastics Stock Monitoring System.</p>
			"""

		# Set recipient emails - send to 6 people
		recipient_email = [
			"beetashoke.chakraborty@clapgrow.com",
			"beetashokechakraborty721@gmail.com",
			"ritika@clapgrow.com",
			"rohanathex@gmail.com",
			"avinashathex@gmail.com",
			"gauravmartinian@gmail.com",
		]

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

		# Print email content to console BEFORE attempting to send
		# This will show even if email sending fails
		email_preview = f"""
{"=" * 80}
EMAIL CONTENT (WHAT WILL BE SENT):
{"=" * 80}
To: {", ".join(recipient_email)}
Subject: {subject}
{"-" * 80}
MESSAGE BODY (PLAIN TEXT):
{"-" * 80}
{plain_message}
{"=" * 80}
FULL HTML MESSAGE:
{"=" * 80}
{message}
{"=" * 80}
"""

		# Print to console
		print(email_preview)
		print("\n>>> Now attempting to send email...\n")
		sys.stdout.flush()

		# Return email content so it shows in console (this will definitely display)
		email_info = {
			"to": recipient_email,
			"subject": subject,
			"plain_message": plain_message,
			"html_message": message,
			"low_stock_count": len(low_stock_items),
			"preview": email_preview,  # Add preview as string for easy viewing
		}

		# Send email (this may fail due to encryption key issues, but content is already shown above)
		try:
			frappe.sendmail(recipients=recipient_email, subject=subject, message=message, now=True)
			frappe.logger().info(f"✓ Email sent successfully to {recipient_email}")
			print("\n>>> Email sent successfully!\n")
			sys.stdout.flush()
		except Exception as email_error:
			frappe.log_error(
				f"Failed to send email: {str(email_error)}\n{frappe.get_traceback()}",
				"Stock Alert Email Error",
			)
			frappe.logger().error(f"✗ Failed to send email: {str(email_error)}")
			print(f"\n>>> ERROR: Failed to send email: {str(email_error)}\n")
			sys.stdout.flush()

		frappe.logger().info("=" * 80)

		# Return email info so it displays in console
		return email_info

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Stock Alert Check Error")
		# Don't throw exception in scheduled task - just log the error
		frappe.logger().error(f"Error checking stock levels: {str(e)}")
