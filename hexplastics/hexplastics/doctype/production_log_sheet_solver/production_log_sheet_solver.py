# Copyright (c) 2026, beetashoke chakraborty and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class Productionlogsheetsolver(Document):
	pass


@frappe.whitelist()
def solve_production_log_sheets():
	# Find all PLS docs where parent has bom data but child table (table_foun) is empty
	docs_to_migrate = frappe.db.sql("""
		SELECT
			pls.name, pls.bom, pls.bom_grade, pls.manufacturing_item,
			pls.manufactured_qty, pls.gross_weight, pls.weight_of_fabric_packing, pls.net_weight
		FROM `tabProduction Log Sheet` pls
		WHERE
			pls.bom IS NOT NULL AND pls.bom != ''
			AND pls.name NOT IN (
				SELECT DISTINCT parent FROM `tabProduction Log Sheet FG Details Table`
			)
	""", as_dict=True)

	count = 0
	for d in docs_to_migrate:
		row_name = frappe.generate_hash(length=10)
		frappe.db.sql("""
			INSERT INTO `tabProduction Log Sheet FG Details Table`
				(name, parent, parentfield, parenttype, idx,
				 owner, creation, modified, modified_by,
				 bom, bom_name, manufacturing_item,
				 manufactured_qty, gross_weight, weight_of_fabric_packing, net_weight)
			VALUES
				(%s, %s, 'table_foun', 'Production Log Sheet', 1,
				 %s, NOW(), NOW(), %s,
				 %s, %s, %s,
				 %s, %s, %s, %s)
		""", (
			row_name, d.name,
			frappe.session.user, frappe.session.user,
			d.bom, d.bom_grade, d.manufacturing_item,
			d.manufactured_qty or 0,
			d.gross_weight or 0,
			d.weight_of_fabric_packing or 0,
			d.net_weight or 0,
		))
		count += 1

	frappe.db.commit()
	return f"Migration complete. {count} Production Log Sheet(s) updated."
