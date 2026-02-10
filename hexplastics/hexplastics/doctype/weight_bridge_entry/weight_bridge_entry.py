# Copyright (c) 2025, beetashoke chakraborty and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class WeightBridgeEntry(Document):
	def validate(self):
		"""Round weight fields to 2 decimal places before saving"""
		weight_fields = [
			"weight_of_finished_material",
			"total_weight",
			"weight_of_packing_material",
			"actual_kata_weight",
			"difference_in_weights",
		]

		for field in weight_fields:
			if self.get(field) is not None:
				# Round to 2 decimal places
				self.set(field, round(float(self.get(field)), 2))


@frappe.whitelist()
def get_used_invoices(current_doc_name=None):
	"""
	Get list of purchase and sales invoices already used in other Weight Bridge Entry documents.
	Returns a dict with 'purchase_invoices' and 'sales_invoices' lists.
	"""
	used_purchase = []
	used_sales = []

	# Query all Weight Bridge Entry documents except current one
	filters = {}
	if current_doc_name:
		filters["name"] = ["!=", current_doc_name]

	doc_names = frappe.get_all("Weight Bridge Entry", filters=filters, pluck="name")

	# For each document, get child table data
	for doc_name in doc_names:
		doc = frappe.get_doc("Weight Bridge Entry", doc_name)

		# Extract purchase invoices
		if doc.purchase_invoice_details:
			for row in doc.purchase_invoice_details:
				if row.purchase_invoice:
					used_purchase.append(row.purchase_invoice)

		# Extract sales invoices
		if doc.sales_invoice_details:
			for row in doc.sales_invoice_details:
				if row.sales_invoice:
					used_sales.append(row.sales_invoice)

	# Remove duplicates so it not comes again in the list
	used_purchase = list(set(used_purchase))
	used_sales = list(set(used_sales))

	return {"purchase_invoices": used_purchase, "sales_invoices": used_sales}
