# Copyright (c) 2026, beetashoke chakraborty and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class gradetypesolver(Document):
	pass


@frappe.whitelist()
def solve_bom_grade():
	# Get all child table rows where bom is set but bom_name is empty
	rows = frappe.db.sql("""
		SELECT t.name, t.bom
		FROM `tabProduction Log Sheet FG Details Table` t
		WHERE t.bom IS NOT NULL AND t.bom != ''
		AND (t.bom_name IS NULL OR t.bom_name = '')
	""", as_dict=True)

	count = 0
	for row in rows:
		custom_bom_name = frappe.db.get_value("BOM", row.bom, "custom_bom_name")
		if custom_bom_name:
			frappe.db.sql("""
				UPDATE `tabProduction Log Sheet FG Details Table`
				SET bom_name = %s, modified = NOW()
				WHERE name = %s
			""", (custom_bom_name, row.name))
			count += 1

	frappe.db.commit()
	return f"Done. {count} row(s) updated with BOM grade."
