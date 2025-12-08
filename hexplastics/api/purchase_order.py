"""API endpoints for Purchase Order."""

import frappe


@frappe.whitelist()
def get_last_5_avg_rate(item_code):
	"""
	Calculate the average rate from the last 5 Purchase Orders containing the specified item.

	Args:
	    item_code: Item code to search for

	Returns:
	    float: Average rate from last 5 purchase orders, or 0 if not found
	"""
	if not item_code:
		frappe.logger("avg_rate").info("❌ No item_code provided.")
		return 0

	frappe.logger("avg_rate").info(f"🔍 Finding last 5 occurrences of Item: {item_code}")

	# 1️⃣ Fetch ALL Purchase Order Items containing this item (sorted by creation DESC)
	all_items = frappe.get_all(
		"Purchase Order Item",
		filters={"item_code": item_code, "docstatus": 1},
		fields=["parent", "rate", "creation"],
		order_by="creation desc",
	)

	frappe.logger("avg_rate").info(f"📄 Total occurrences found = {len(all_items)}")

	# 2️⃣ Take the last 5 occurrences if 5 or more exist, otherwise take all
	if len(all_items) == 0:
		frappe.logger("avg_rate").info("⚠️ No purchase orders found for this item")
		return 0

	# If 5 or more, take latest 5; otherwise take all
	items_to_use = all_items[:5] if len(all_items) >= 5 else all_items
	divisor = 5 if len(all_items) >= 5 else len(all_items)

	rates = []

	for idx, row in enumerate(items_to_use, start=1):
		frappe.logger("avg_rate").info(
			f"#{idx} → PO: {row.parent} | Rate: {row.rate} | Created: {row.creation}"
		)
		rates.append(float(row.rate or 0))

	# 3️⃣ Calculate average: divide by 5 if 5+ orders exist, otherwise by actual count
	avg_rate = sum(rates) / divisor

	frappe.logger("avg_rate").info(f"🧮 Rates used for avg: {rates}")
	frappe.logger("avg_rate").info(f"📊 Number of purchase orders used: {len(rates)}, Divisor: {divisor}")
	frappe.logger("avg_rate").info(f"✅ Final Average Rate = {avg_rate}")

	return avg_rate
