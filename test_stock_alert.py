#!/usr/bin/env python3
"""
Manual test script for stock alert function.
Run this from the bench directory:
    bench --site hex.com execute hexplastics.test_stock_alert.test
"""

import frappe


def test():
	"""Test the stock alert function."""
	try:
		from hexplastics.tasks import check_stock_levels_and_send_alert

		print("\n" + "=" * 80)
		print("STARTING STOCK ALERT CHECK...")
		print("=" * 80 + "\n")

		check_stock_levels_and_send_alert()

		print("\n" + "=" * 80)
		print("✓ Stock alert check completed successfully!")
		print("✓ Check logs above for detailed email content")
		print("✓ Email has been sent to beetashoke.chakraborty@clapgrow.com")
		print("=" * 80 + "\n")

		return "Success"
	except Exception as e:
		print(f"\n✗ Error: {str(e)}")
		print(frappe.get_traceback())
		frappe.log_error(frappe.get_traceback(), "Stock Alert Manual Test Error")
		raise
