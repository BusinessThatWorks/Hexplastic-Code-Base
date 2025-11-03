// Copyright (c) 2025, beetashoke chakraborty and contributors
// For license information, please see license.txt

// BOM Client Script - Calculate Total BOM Cost per KG

frappe.ui.form.on('BOM', {
	refresh: function(frm) {
		calculate_bom_cost_per_kg(frm);
	},
	
	items_add: function(frm) {
		calculate_bom_cost_per_kg(frm);
	},
	
	items_remove: function(frm) {
		calculate_bom_cost_per_kg(frm);
	},
	
	items: {
		qty: function(frm, cdt, cdn) {
			calculate_bom_cost_per_kg(frm);
		},
		rate: function(frm, cdt, cdn) {
			calculate_bom_cost_per_kg(frm);
		},
		amount: function(frm, cdt, cdn) {
			calculate_bom_cost_per_kg(frm);
		}
	}
});

function calculate_bom_cost_per_kg(frm) {
	if (frm.doc.items && frm.doc.items.length > 0) {
		let total_qty = 0;
		
		// Calculate total quantity from child table
		frm.doc.items.forEach(function(item) {
			if (item.qty) {
				total_qty += parseFloat(item.qty) || 0;
			}
		});
		
		// Get total cost from existing field
		let total_cost = parseFloat(frm.doc.total_cost) || 0;
		
		// Calculate cost per KG
		let cost_per_kg = 0;
		if (total_qty > 0) {
			cost_per_kg = total_cost / total_qty;
		}
		
		// Try to set the value in the field
		let field_names = [
			'total_bom_cost_per_kg',
			'custom_total_bom_cost_per_kg', 
			'custom_total_bom_cose_per_kg',
			'bom_cost_per_kg',
			'cost_per_kg'
		];
		
		for (let field_name of field_names) {
			if (frm.fields_dict[field_name]) {
				frm.set_value(field_name, cost_per_kg.toFixed(2));
				return;
			}
		}
		
		// Search by label if direct field name not found
		for (let field_name in frm.fields_dict) {
			let field = frm.fields_dict[field_name];
			if (field && field.df && field.df.label) {
				let label = field.df.label.toLowerCase();
				if (label.includes('total bom cost per kg') || 
					label.includes('bom cost per kg') ||
					label.includes('cost per kg')) {
					frm.set_value(field_name, cost_per_kg.toFixed(2));
					return;
				}
			}
		}
	}
}

