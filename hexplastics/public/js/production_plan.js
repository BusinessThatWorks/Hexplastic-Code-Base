
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
	}
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
		if (row.sales_order && (!row.delivery_date && !row.custom_delivery_date)) {
			fetchDeliveryDate(frm, cdt, cdn, row.sales_order);
		}
	}
});

function setupGridRefreshHook(frm) {
	// Wait for the grid to be available
	if (frm.fields_dict.sales_orders && frm.fields_dict.sales_orders.grid) {
		const grid = frm.fields_dict.sales_orders.grid;
		
		// Override or hook into grid refresh
		if (!grid._delivery_date_hook_setup) {
			const originalRefresh = grid.refresh.bind(grid);
			
			grid.refresh = function() {
				originalRefresh();
				// After grid refreshes, fetch all delivery dates
				setTimeout(() => {
					fetchAllDeliveryDates(frm);
				}, 500);
			};
			
			// Also hook into the grid's internal refresh if available
			if (grid.on_grid_after_refresh === undefined) {
				grid.on_grid_after_refresh = function() {
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
			fieldname: ["delivery_date"]
		},
		callback(r) {
			if (r.message && r.message.delivery_date) {
				frappe.model.set_value(cdt, cdn, "delivery_date", r.message.delivery_date);
				frappe.model.set_value(cdt, cdn, "custom_delivery_date", r.message.delivery_date);
			}
		}
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
		const observer = new MutationObserver(function(mutations) {
			// Check if rows were added/changed
			let shouldFetch = false;
			for (let mutation of mutations) {
				if (mutation.addedNodes.length > 0 || mutation.type === 'childList') {
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
			subtree: true
		});

		grid._observer_setup = true;
	}
}

function fetchAllDeliveryDates(frm) {
	if (!frm.doc.sales_orders || frm.doc.sales_orders.length === 0) {
		return;
	}

	frm.doc.sales_orders.forEach(function(row) {
		if (row.sales_order && (!row.delivery_date && !row.custom_delivery_date)) {
			fetchDeliveryDate(frm, row.doctype, row.name, row.sales_order);
		}
	});
}
