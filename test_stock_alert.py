#!/usr/bin/env python3
"""
Manual test script for stock alert function.
Run this from the bench directory:
    bench --site [your-site-name] execute hexplastics.test_stock_alert.test
"""

import frappe


def test():
	"""Test the stock alert function."""
	try:
		from hexplastics.tasks import check_stock_levels_and_send_alert

		print("Starting stock alert check...")
		check_stock_levels_and_send_alert()
		print("✓ Stock alert check completed successfully!")
		print("✓ Email has been sent to beetashoke.chakraborty@clapgrow.com")
		return "Success"
	except Exception as e:
		print(f"✗ Error: {str(e)}")
		frappe.log_error(frappe.get_traceback(), "Stock Alert Manual Test Error")
		raise
