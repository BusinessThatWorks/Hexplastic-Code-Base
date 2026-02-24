frappe.ui.form.on("Production Plan", {
	onload(frm) {
		// Hook into grid refresh event - this fires after "Get Sales Orders" completes
		setupGridRefreshHook(frm);

		// Use MutationObserver to watch for table changes
		setupMutationObserver(frm);
	},

	refresh(frm) {
		// Set up grid refresh hook on each refresh
		setupGridRefreshHook(frm);
		setupMutationObserver(frm);

		// Also fetch for existing rows
		setTimeout(() => {
			fetchAllDeliveryDates(frm);
			fetchAllBOMNames(frm);
		}, 500);
	},

	sales_orders_add(frm, cdt, cdn) {
		// Handle individual row additions - use debouncing for bulk adds
		if (frm._add_timeout) {
			clearTimeout(frm._add_timeout);
		}

		frm._add_timeout = setTimeout(() => {
			// Fetch for all rows after a short delay (handles bulk additions)
			fetchAllDeliveryDates(frm);
		}, 500);
	},
});

frappe.ui.form.on("Production Plan Sales Order", {
	sales_order(frm, cdt, cdn) {
		// Handle when sales order field is manually changed
		let row = locals[cdt][cdn];
		if (row.sales_order) {
			fetchDeliveryDate(frm, cdt, cdn, row.sales_order);
		}
	},

	// This fires after each row is rendered in the grid
	form_render(frm, cdt, cdn) {
		let row = locals[cdt][cdn];
		if (row.sales_order && !row.delivery_date && !row.custom_delivery_date) {
			fetchDeliveryDate(frm, cdt, cdn, row.sales_order);
		}
	},
});

// Production Plan Item child table handlers
frappe.ui.form.on("Production Plan Item", {
	item_code(frm, cdt, cdn) {
		// When item_code changes, fetch weight_per_unit from Item master
		let row = locals[cdt][cdn];
		if (row.item_code) {
			fetchWeightPerUnit(frm, cdt, cdn, row.item_code);
		} else {
			// Clear weight_per_unit and custom_planned_weight if item_code is cleared
			frappe.model.set_value(cdt, cdn, "weight_per_unit", 0);
			frappe.model.set_value(cdt, cdn, "custom_planned_weight", 0);
		}
	},

	bom_no(frm, cdt, cdn) {
		// When bom_no changes, automatically fetch and populate BOM Name
		let row = locals[cdt][cdn];
		if (row.bom_no) {
			fetchBOMName(frm, cdt, cdn, row.bom_no);
		} else {
			// Clear custom_bom_name if bom_no is cleared
			frappe.model.set_value(cdt, cdn, "custom_bom_name", "");
		}
	},

	// This fires after each row is rendered in the grid
	form_render(frm, cdt, cdn) {
		let row = locals[cdt][cdn];
		// Fetch BOM name if bom_no exists but custom_bom_name is missing
		if (row.bom_no && !row.custom_bom_name) {
			fetchBOMName(frm, cdt, cdn, row.bom_no);
		}
	},

	planned_qty(frm, cdt, cdn) {
		// When planned_qty changes, recalculate custom_planned_weight
		calculatePlannedWeight(frm, cdt, cdn);
	},

	weight_per_unit(frm, cdt, cdn) {
		// When weight_per_unit changes (manually or via fetch), recalculate custom_planned_weight
		calculatePlannedWeight(frm, cdt, cdn);
	},
});

function setupGridRefreshHook(frm) {
	// Wait for the grid to be available
	if (frm.fields_dict.sales_orders && frm.fields_dict.sales_orders.grid) {
		const grid = frm.fields_dict.sales_orders.grid;

		// Override or hook into grid refresh
		if (!grid._delivery_date_hook_setup) {
			const originalRefresh = grid.refresh.bind(grid);

			grid.refresh = function () {
				originalRefresh();
				// After grid refreshes, fetch all delivery dates
				setTimeout(() => {
					fetchAllDeliveryDates(frm);
				}, 500);
			};

			// Also hook into the grid's internal refresh if available
			if (grid.on_grid_after_refresh === undefined) {
				grid.on_grid_after_refresh = function () {
					setTimeout(() => {
						fetchAllDeliveryDates(frm);
					}, 500);
				};
			}

			grid._delivery_date_hook_setup = true;
		}
	} else {
		// If grid not ready, try again after a short delay
		setTimeout(() => {
			setupGridRefreshHook(frm);
		}, 500);
	}
}

function fetchDeliveryDate(frm, cdt, cdn, sales_order) {
	frappe.call({
		method: "frappe.client.get_value",
		args: {
			doctype: "Sales Order",
			filters: { name: sales_order },
			fieldname: ["delivery_date"],
		},
		callback(r) {
			if (r.message && r.message.delivery_date) {
				frappe.model.set_value(cdt, cdn, "delivery_date", r.message.delivery_date);
				frappe.model.set_value(cdt, cdn, "custom_delivery_date", r.message.delivery_date);
			}
		},
	});
}

function setupMutationObserver(frm) {
	// Wait for the grid to be available
	if (!frm.fields_dict.sales_orders || !frm.fields_dict.sales_orders.grid) {
		setTimeout(() => setupMutationObserver(frm), 500);
		return;
	}

	const grid = frm.fields_dict.sales_orders.grid;
	const gridWrapper = grid.wrapper || grid.$wrapper;

	if (gridWrapper && !grid._observer_setup) {
		const observer = new MutationObserver(function (mutations) {
			// Check if rows were added/changed
			let shouldFetch = false;
			for (let mutation of mutations) {
				if (mutation.addedNodes.length > 0 || mutation.type === "childList") {
					shouldFetch = true;
					break;
				}
			}

			if (shouldFetch && !frm._fetching_delivery_dates) {
				frm._fetching_delivery_dates = true;
				setTimeout(() => {
					fetchAllDeliveryDates(frm);
					frm._fetching_delivery_dates = false;
				}, 300);
			}
		});

		observer.observe(gridWrapper[0] || gridWrapper, {
			childList: true,
			subtree: true,
		});

		grid._observer_setup = true;
	}
}

function fetchAllDeliveryDates(frm) {
	if (!frm.doc.sales_orders || frm.doc.sales_orders.length === 0) {
		return;
	}

	frm.doc.sales_orders.forEach(function (row) {
		if (row.sales_order && !row.delivery_date && !row.custom_delivery_date) {
			fetchDeliveryDate(frm, row.doctype, row.name, row.sales_order);
		}
	});
}

function fetchWeightPerUnit(frm, cdt, cdn, item_code) {
	// Fetch weight_per_unit from Item master (Item Inventory section)
	// Use frappe.get_doc to get full document and access any field (including custom fields)
	frappe.db
		.get_doc("Item", item_code)
		.then((item_doc) => {
			// Try weight_per_unit field (could be standard or custom field)
			let weight_per_unit = item_doc.weight_per_unit || 0;

			frappe.model.set_value(cdt, cdn, "weight_per_unit", weight_per_unit, function () {
				// After setting weight_per_unit, calculate custom_planned_weight
				calculatePlannedWeight(frm, cdt, cdn);
			});
		})
		.catch((err) => {
			console.error("Error fetching weight_per_unit for item:", item_code, err);
			// Set to 0 if fetch fails
			frappe.model.set_value(cdt, cdn, "weight_per_unit", 0);
		});
}

function calculatePlannedWeight(frm, cdt, cdn) {
	// Calculate custom_planned_weight = planned_qty × weight_per_unit
	let row = locals[cdt][cdn];
	if (!row) {
		return;
	}

	let planned_qty = flt(row.planned_qty) || 0;
	let weight_per_unit = flt(row.weight_per_unit) || 0;
	let custom_planned_weight = planned_qty * weight_per_unit;

	frappe.model.set_value(cdt, cdn, "custom_planned_weight", custom_planned_weight);
}

function fetchBOMName(frm, cdt, cdn, bom_no) {
	// Fetch BOM name from BOM doctype's custom_bom_name field
	if (!bom_no) {
		frappe.model.set_value(cdt, cdn, "custom_bom_name", "");
		return;
	}

	frappe.call({
		method: "frappe.client.get_value",
		args: {
			doctype: "BOM",
			filters: { name: bom_no },
			fieldname: ["custom_bom_name"],
		},
		callback(r) {
			if (r.message && r.message.custom_bom_name) {
				// Set the BOM name in custom_bom_name field
				frappe.model.set_value(cdt, cdn, "custom_bom_name", r.message.custom_bom_name);
			} else {
				// If BOM not found or custom_bom_name is empty, clear the field
				frappe.model.set_value(cdt, cdn, "custom_bom_name", "");
			}
		},
		error(r) {
			// Handle error gracefully - clear the field if BOM is invalid
			console.error("Error fetching BOM name for BOM No:", bom_no, r);
			frappe.model.set_value(cdt, cdn, "custom_bom_name", "");
		},
	});
}

function fetchAllBOMNames(frm) {
	// Fetch BOM names for all existing rows in the Assembly Item table (po_items)
	if (!frm.doc.po_items || frm.doc.po_items.length === 0) {
		return;
	}

	frm.doc.po_items.forEach(function (row) {
		if (row.bom_no && !row.custom_bom_name) {
			fetchBOMName(frm, row.doctype, row.name, row.bom_no);
		}
	});
}
