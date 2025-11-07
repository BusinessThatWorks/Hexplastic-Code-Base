# Copyright (c) 2025, beetashoke chakraborty and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class DailyGateEntry(Document):
	pass


@frappe.whitelist()
def get_used_invoices(current_doc_name=None):
	"""
	Get list of purchase and sales invoices already used in other Daily Gate Entry documents.
	Returns a dict with 'purchase_invoices' and 'sales_invoices' lists.
	"""
	used_purchase = []
	used_sales = []

	# Query all Daily Gate Entry documents except current one
	filters = {}
	if current_doc_name:
		filters["name"] = ["!=", current_doc_name]

	doc_names = frappe.get_all("Daily Gate Entry", filters=filters, pluck="name")

	# For each document, get child table data
	for doc_name in doc_names:
		doc = frappe.get_doc("Daily Gate Entry", doc_name)

		# Extract purchase invoices from table_sxbw
		if doc.table_sxbw:
			for row in doc.table_sxbw:
				if row.purchase_invoice:
					used_purchase.append(row.purchase_invoice)

		# Extract sales invoices from sales_invoice_details
		if doc.sales_invoice_details:
			for row in doc.sales_invoice_details:
				if row.sales_invoice:
					used_sales.append(row.sales_invoice)

	# Remove duplicates
	used_purchase = list(set(used_purchase))
	used_sales = list(set(used_sales))

	return {"purchase_invoices": used_purchase, "sales_invoices": used_sales}
