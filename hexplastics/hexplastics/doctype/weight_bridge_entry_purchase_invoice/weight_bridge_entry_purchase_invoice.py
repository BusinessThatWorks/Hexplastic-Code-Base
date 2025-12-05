# Copyright (c) 2025, beetashoke chakraborty and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class WeightBridgeEntryPurchaseInvoice(Document):
	pass


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def get_query(doctype, txt, searchfield, start, page_len, filters):
	"""Filter out canceled Purchase Invoices"""
	return {
		"filters": [
			["docstatus", "!=", 2]  # Exclude canceled invoices (docstatus 2 = Canceled)
		]
	}
