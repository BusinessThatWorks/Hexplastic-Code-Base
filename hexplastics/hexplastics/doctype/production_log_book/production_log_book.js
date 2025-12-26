// Copyright (c) 2025, beetashoke chakraborty and contributors
// For license information, please see license.txt

frappe.ui.form.on("Production Log Book", {
	// Hook into form setup to ensure after_submit is called after successful submit
	setup: function (frm) {
		// Store original submit method if not already stored
		if (!frm._original_submit_hooked) {
			frm._original_submit_hooked = true;
			const original_submit = frm.submit;

			// Override submit to call after_submit after successful submit
			frm.submit = function (callback) {
				const self = this;
				const prev_docstatus = self.doc.docstatus || 0;

				return original_submit.call(this, function (r) {
					// Call original callback if provided
					if (callback) {
						callback(r);
					}

					// If submit was successful and docstatus changed to 1, trigger after_submit
					if (
						r &&
						!r.exc &&
						prev_docstatus === 0 &&
						self.doc &&
						self.doc.docstatus === 1
					) {
						// Small delay to ensure submit is fully complete
						setTimeout(function () {
							// Try to call after_submit handler via event system
							if (
								self.script_manager &&
								self.script_manager.events &&
								self.script_manager.events.after_submit
							) {
								self.script_manager.events.after_submit.forEach(function (
									handler
								) {
									try {
										handler(self);
									} catch (e) {
										console.error("Error in after_submit handler:", e);
									}
								});
							} else {
								// Fallback: call update function directly if event system doesn't work
								update_stock_entry_no_after_submit_direct(self);
							}
						}, 100);
					}
				});
			};
		}

		// CRITICAL: Intercept set_value to prevent dirtying form after save
		if (!frm._set_value_hooked) {
			frm._set_value_hooked = true;
			const original_set_value = frm.set_value;

			frm.set_value = function (fieldname, value) {
				// If we just saved, block set_value calls to calculated fields
				if (frm._just_saved || frm._is_saving) {
					const calculated_fields = ["closing_qty", "closing_qty_mip", "net_weight"];
					if (calculated_fields.includes(fieldname)) {
						console.log("🚫 set_value BLOCKED for", fieldname, "during save");
						// Set value directly without triggering dirty flag
						frm.doc[fieldname] = value;
						frm.refresh_field(fieldname);
						return;
					}
				}
				return original_set_value.call(this, fieldname, value);
			};
		}
	},

	// Before save handler - set flag to track save state
	before_save: function (frm) {
		// Set flag to indicate we're in the middle of saving
		frm._is_saving = true;
		console.log("🔵 BEFORE SAVE - Setting _is_saving flag");
	},

	// After save handler - set flag to prevent refresh from dirtying the form
	after_save: function (frm) {
		console.log("🟢 AFTER SAVE - Document saved successfully");
		// Clear the saving flag
		frm._is_saving = false;
		// Set flag to indicate we just saved - prevents refresh from running calculations
		frm._just_saved = true;

		// Store the current document hash to detect if it changes
		frm._saved_doc_hash = JSON.stringify(frm.doc);

		// CRITICAL: Mark form as not dirty immediately after save
		frm.is_dirty = function () {
			return false;
		};

		// Clear the flag after a longer delay to ensure all refresh events complete
		setTimeout(function () {
			frm._just_saved = false;
			// Restore original is_dirty function
			delete frm.is_dirty;
			console.log("🟡 SAVE FLAG CLEARED - Normal operations resumed");
		}, 1500);
	},

	bom: function (frm) {
		// When BOM field changes, fetch and populate ONLY BOM Items
		// Clear cached main item code when BOM changes
		frm._bom_main_item_code = null;

		if (frm.doc.bom) {
			// Clear existing rows in material_consumption table
			frm.clear_table("material_consumption");

			// Fetch only BOM Items from server
			frappe.call({
				method: "hexplastics.api.production_log_book.get_bom_items_only",
				args: {
					bom_name: frm.doc.bom,
				},
				callback: function (r) {
					if (r.message && r.message.length > 0) {
						// Add BOM items to the child table
						add_items_to_table(frm, r.message);

						// Refresh the child table to show new rows first
						frm.refresh_field("material_consumption");

						// Assign warehouses for all rows after BOM items are added
						// Use longer timeout to ensure all set_value callbacks have completed
						setTimeout(function () {
							assign_warehouses_for_all_rows(frm);
							// Refresh again after assigning warehouses to show the values
							setTimeout(function () {
								frm.refresh_field("material_consumption");
							}, 200);
						}, 400);

						// Fetch opening stock (previous closing_stock) for all items
						// This must be done after items are added to the table
						fill_opening_stock_for_items(frm);

						// Also fetch hopper opening quantity using same shift-based logic
						fill_hopper_opening_qty(frm);

						// Also fetch MIP opening quantity using same shift-based logic
						fill_mip_opening_qty(frm);

						// After BOM items are loaded, recalculate issued if qty_to_manufacture is present
						recalculate_issued_for_material_consumption(frm);

						// Also recalculate consumption if manufactured_qty is present
						recalculate_consumption_for_material_consumption(frm);

						// Recalculate closing_stock for raw materials
						recalculate_closing_stock_for_raw_materials(frm);

						// If manufactured_qty is already filled, also fetch main item and scrap items
						if (frm.doc.manufactured_qty) {
							fetch_and_append_main_and_scrap_items(frm);
						}

						// If manufactured_qty and BOM are present, recalculate scrap in_qty
						if (frm.doc.manufactured_qty) {
							recalculate_scrap_in_qty_for_material_consumption(frm);
						}

						// Show success message
						frappe.show_alert(
							{
								message: __("{0} BOM items added", [r.message.length]),
								indicator: "green",
							},
							3
						);
					} else {
						// No items found in BOM
						frm.refresh_field("material_consumption");
						frappe.show_alert(
							{
								message: __("No items found in selected BOM"),
								indicator: "orange",
							},
							3
						);
					}
				},
				error: function (r) {
					// Handle error
					frappe.msgprint({
						title: __("Error"),
						message: __("Failed to fetch BOM items. Please try again."),
						indicator: "red",
					});
					console.error("Error fetching BOM items:", r);
				},
			});
		} else {
			// If BOM is cleared, clear the child table and cached main item code
			frm.clear_table("material_consumption");
			frm.refresh_field("material_consumption");
			frm._bom_main_item_code = null;
		}
	},

	// Trigger recalculation when production_date changes
	production_date: function (frm) {
		// Refetch opening stock when date changes
		if (frm.doc.bom) {
			if (frm.doc.material_consumption && frm.doc.material_consumption.length > 0) {
				fill_opening_stock_for_items(frm);
			}

			// Also refetch hopper opening qty (depends on BOM-based process)
			fill_hopper_opening_qty(frm);
		}

		// MIP opening does NOT depend on BOM; always refetch based on previous shift
		fill_mip_opening_qty(frm);
	},

	// Trigger recalculation when shift_type changes
	shift_type: function (frm) {
		// Refetch opening stock when shift changes
		if (frm.doc.bom) {
			if (frm.doc.material_consumption && frm.doc.material_consumption.length > 0) {
				fill_opening_stock_for_items(frm);
			}

			// Also refetch hopper opening qty (depends on BOM-based process)
			fill_hopper_opening_qty(frm);
		}

		// MIP opening does NOT depend on BOM; always refetch based on previous shift
		fill_mip_opening_qty(frm);
	},

	// Trigger recalculation when qty_to_manufacture changes
	qty_to_manufacture: function (frm) {
		recalculate_issued_for_material_consumption(frm);
		// closing_stock will be recalculated automatically via issued event handler
	},

	// Trigger recalculation when manufactured_qty changes
	manufactured_qty: function (frm) {
		// Recalculate consumption
		recalculate_consumption_for_material_consumption(frm);
		// closing_stock will be recalculated automatically via consumption event handler

		// If manufactured_qty is filled and BOM exists
		if (frm.doc.manufactured_qty && frm.doc.bom) {
			// Check if main item already exists in the table
			const rows = frm.doc.material_consumption || [];
			let main_item_exists = false;

			// Try to get main item code from cached value or check if any row might be main item
			if (frm._bom_main_item_code) {
				main_item_exists = rows.some((row) => row.item_code === frm._bom_main_item_code);
			}

			if (main_item_exists) {
				// Main item exists, just update its in_qty
				update_main_item_in_qty(frm);
				// Recalculate scrap in_qty for all scrap rows
				recalculate_scrap_in_qty_for_material_consumption(frm);
				// Ensure warehouses are assigned correctly
				assign_warehouses_for_all_rows(frm);
			} else {
				// Main item doesn't exist, fetch and add it (along with scrap items)
				fetch_and_append_main_and_scrap_items(frm);
			}
		} else {
			// If manufactured_qty is cleared, update main item in_qty to 0 (if exists)
			update_main_item_in_qty(frm);
			// Also reset scrap in_qty to 0 when manufactured_qty is cleared
			reset_scrap_in_qty_for_material_consumption(frm);
		}
	},

	// On form refresh, re-run calculation for safety (e.g., when loading an existing *draft* doc)
	refresh: function (frm) {
		console.log(
			"🔄 REFRESH EVENT - docstatus:",
			frm.doc.docstatus,
			"is_new:",
			frm.is_new(),
			"_just_saved:",
			frm._just_saved
		);

		// Check if document was just submitted (docstatus changed from 0 to 1)
		if (frm.doc.docstatus === 1 && frm._previous_docstatus === 0) {
			// Document was just submitted, reload to get stock_entry_no from server
			// This will refresh the form with latest data without making it dirty
			setTimeout(function () {
				frm.reload_doc();
			}, 300);
		}
		// Store current docstatus for next refresh
		frm._previous_docstatus = frm.doc.docstatus;

		// Make closing quantity fields read-only (always do this, doesn't dirty form)
		make_closing_qty_fields_readonly(frm);
		// Make net_weight read-only
		make_net_weight_readonly(frm);

		// CRITICAL: Skip all auto-calculations if we just saved
		// This prevents the form from becoming dirty immediately after save
		if (frm._just_saved) {
			console.log("⚠️ REFRESH BLOCKED - Just saved, skipping all calculations");
			return;
		}

		// CRITICAL: Skip all auto-calculations for existing documents (already saved)
		// Calculations should ONLY run for NEW documents or when specific fields change
		if (!frm.is_new() && frm.doc.docstatus === 0) {
			console.log(
				"⚠️ REFRESH BLOCKED - Existing document, calculations only run on field changes"
			);
			return;
		}

		// Never recalculate for submitted/cancelled docs to avoid changing values after submission
		if (frm.doc.docstatus === 0) {
			// Only run calculations for NEW documents (not yet saved)
			// For existing documents, calculations should only run when specific fields change
			if (frm.is_new()) {
				console.log("✅ REFRESH CALCULATIONS - Running for new document");
				// Assign warehouses for all rows on form refresh (only for rows that haven't been user-modified)
				assign_warehouses_for_all_rows(frm);

				// Recalculate closing_stock for raw materials on form refresh (this is a calculated field)
				recalculate_closing_stock_for_raw_materials(frm);

				// Recalculate Hopper & Tray closing quantity (this is a calculated field)
				calculate_hopper_closing_qty(frm);

				// Recalculate MIP closing quantity (this is a calculated field)
				calculate_mip_closing_qty(frm);

				// Recalculate net_weight (this is a calculated field)
				calculate_net_weight(frm);
			}
		}
	},

	// When opening_qty_in_hopper_and_tray changes, recalculate closing qty
	opening_qty_in_hopper_and_tray: function (frm) {
		if (frm.doc.docstatus !== 0) return;
		calculate_hopper_closing_qty(frm);
		// Also recalculate PRIME item closing_stock
		recalculate_PRIME_items_closing_stock(frm);
	},

	// When add_or_used changes, recalculate closing qty
	add_or_used: function (frm) {
		if (frm.doc.docstatus !== 0) return;
		calculate_hopper_closing_qty(frm);
		// Also recalculate PRIME item closing_stock
		recalculate_PRIME_items_closing_stock(frm);
	},

	// When net_weight changes, recalculate hopper closing qty
	net_weight: function (frm) {
		if (frm.doc.docstatus !== 0) return;
		calculate_hopper_closing_qty(frm);
		// Also recalculate PRIME item closing_stock
		recalculate_PRIME_items_closing_stock(frm);
	},

	// When mip_used changes, recalculate hopper closing qty
	mip_used: function (frm) {
		if (frm.doc.docstatus !== 0) return;
		calculate_hopper_closing_qty(frm);
		// Also recalculate MIP closing qty
		calculate_mip_closing_qty(frm);
		// Also recalculate PRIME item closing_stock
		recalculate_PRIME_items_closing_stock(frm);
	},

	// When mip_generate changes, recalculate hopper closing qty
	mip_generate: function (frm) {
		if (frm.doc.docstatus !== 0) return;
		calculate_hopper_closing_qty(frm);
		// Also recalculate MIP closing qty
		calculate_mip_closing_qty(frm);
		// Also recalculate PRIME item closing_stock
		recalculate_PRIME_items_closing_stock(frm);
	},

	// When process_loss_weight changes, recalculate hopper closing qty
	process_loss_weight: function (frm) {
		if (frm.doc.docstatus !== 0) return;
		calculate_hopper_closing_qty(frm);
		// Also recalculate PRIME item closing_stock
		recalculate_PRIME_items_closing_stock(frm);
	},

	// When opening_qty_mip changes, recalculate closing qty
	opening_qty_mip: function (frm) {
		if (frm.doc.docstatus !== 0) return;
		calculate_mip_closing_qty(frm);
	},

	// When gross_weight changes, recalculate net_weight
	gross_weight: function (frm) {
		if (frm.doc.docstatus !== 0) return;
		calculate_net_weight(frm);
	},

	// When weight_of_fabric_packing changes, recalculate net_weight
	weight_of_fabric_packing: function (frm) {
		if (frm.doc.docstatus !== 0) return;
		calculate_net_weight(frm);
	},

	// After form loads, ensure closing quantity fields are read-only
	onload_post_render: function (frm) {
		// Make closing quantity fields read-only
		make_closing_qty_fields_readonly(frm);
		// Make net_weight read-only
		make_net_weight_readonly(frm);

		// CRITICAL: Skip calculations if we just saved to prevent form becoming dirty
		if (frm._just_saved) {
			return;
		}

		// Only recalculate closing quantities for NEW draft docs
		// Existing docs should only recalculate when specific fields change
		if (frm.doc.docstatus === 0 && frm.is_new()) {
			calculate_hopper_closing_qty(frm);
			calculate_mip_closing_qty(frm);
			calculate_net_weight(frm);
		}
	},

	// After document is submitted, update stock_entry_no in UI without making document dirty
	after_submit: function (frm) {
		// Safety guard: only run if document is actually submitted
		if (frm.doc.docstatus !== 1) {
			return;
		}

		// Safety guard: only update if stock_entry_no field exists
		if (!frm.fields_dict.stock_entry_no) {
			return;
		}

		// Call the whitelisted function to retrieve stock_entry_no from backend
		frappe.call({
			method: "hexplastics.api.production_log_book.get_stock_entry_no",
			args: {
				docname: frm.doc.name,
			},
			callback: function (r) {
				// Safety guard: ensure document is still submitted
				if (frm.doc.docstatus !== 1) {
					return;
				}

				// Safety guard: ensure field still exists
				if (!frm.fields_dict.stock_entry_no) {
					return;
				}

				// Update UI safely without using frm.set_value()
				// This prevents the document from becoming dirty
				if (r.message) {
					// Update the document object in locals (source of truth)
					if (
						locals["Production Log Book"] &&
						locals["Production Log Book"][frm.doc.name]
					) {
						locals["Production Log Book"][frm.doc.name].stock_entry_no = r.message;
					}
					// Update frm.doc as well
					frm.doc.stock_entry_no = r.message;
					// Update the field value directly
					frm.fields_dict.stock_entry_no.value = r.message;
					// Refresh the field to ensure UI updates
					frm.refresh_field("stock_entry_no");
				}
			},
			error: function (r) {
				// Log error but don't break the form
				console.error("Error fetching stock_entry_no:", r);
			},
		});
	},
});

// Child table: Production Log Book Table
frappe.ui.form.on("Production Log Book Table", {
	// When item_code is changed manually, recompute issued and fetch item_name
	item_code: function (frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (!row) {
			return;
		}

		// Fetch item_name from Item doctype when item_code is manually selected
		if (row.item_code) {
			frappe.db.get_value("Item", { name: row.item_code }, "item_name", function (r) {
				if (r && r.item_name) {
					// Set item_name in the child table row
					frappe.model.set_value(cdt, cdn, "item_name", r.item_name, function () {
						// After item_name is set, check if it's a PRIME item and calculate closing_stock
						setTimeout(function () {
							const updated_row = locals[cdt][cdn];
							if (updated_row && is_PRIME_item(updated_row)) {
								calculate_closing_stock_for_row(frm, cdt, cdn);
							}
						}, 150);
					});
				} else {
					// If item_name fetch failed, check if item_name was already set by fetch_from
					// Wait a bit for Frappe's fetch_from to complete
					setTimeout(function () {
						const updated_row = locals[cdt][cdn];
						if (updated_row && is_PRIME_item(updated_row)) {
							calculate_closing_stock_for_row(frm, cdt, cdn);
						}
					}, 300);
				}
			});
		} else {
			// If item_code is cleared, check if item_name was already set (might be a PRIME item)
			// This handles the case where user types item_name directly
			setTimeout(function () {
				const updated_row = locals[cdt][cdn];
				if (updated_row && is_PRIME_item(updated_row)) {
					calculate_closing_stock_for_row(frm, cdt, cdn);
				}
			}, 200);
		}

		// CRITICAL: Check if this is a new row (doesn't have warehouses assigned yet)
		// If it's a new row, only recalculate for this specific row
		// If it's an existing row, recalculate globally (existing behavior)
		const has_source = row.source_warehouse && row.source_warehouse.trim() !== "";
		const has_target = row.target_warhouse && row.target_warhouse.trim() !== "";
		const is_new_row = !has_source && !has_target;

		if (is_new_row) {
			// This is a new row - only recalculate for this specific row
			// Wait for item_name to be available before checking if it's a PRIME item
			setTimeout(function () {
				const current_row = locals[cdt][cdn];
				if (!current_row) return;

				// CRITICAL: Skip calculations for PRIME items - they don't use BOM-based calculations
				if (!is_PRIME_item(current_row)) {
					recalculate_issued_for_single_row(frm, cdt, cdn);
					recalculate_consumption_for_single_row(frm, cdt, cdn);
				}
				// Calculate closing_stock for this row (handles both raw materials and PRIME items)
				calculate_closing_stock_for_row(frm, cdt, cdn);
			}, 300);
		} else {
			// This is an existing row - recalculate globally (existing behavior)
			// This maintains backward compatibility for when users change item_code on existing rows
			recalculate_issued_for_material_consumption(frm);
			recalculate_consumption_for_material_consumption(frm);
			recalculate_closing_stock_for_raw_materials(frm);
		}

		// Assign warehouses based on item type after item_code is set
		// Use setTimeout to ensure item_code and related fields are set first
		setTimeout(function () {
			assign_warehouses(frm, cdt, cdn);
		}, 100);
	},

	// When item_name changes, check if it's a PRIME item and calculate closing_stock
	item_name: function (frm, cdt, cdn) {
		// Skip calculation if document is submitted
		if (frm.doc.docstatus === 1) {
			return;
		}

		const row = locals[cdt][cdn];
		if (!row) {
			return;
		}

		console.log("📝 item_name changed to:", row.item_name, "| item_code:", row.item_code);

		// If this is a PRIME item (item_code starts with "PRIME"), calculate closing_stock
		// Use setTimeout to ensure the value is fully set
		if (is_PRIME_item(row)) {
			console.log("✅ PRIME item detected in item_name handler");
			setTimeout(function () {
				const current_row = locals[cdt][cdn];
				if (current_row && is_PRIME_item(current_row)) {
					console.log("🔄 Triggering closing_stock calculation for PRIME item");
					calculate_closing_stock_for_row(frm, cdt, cdn);
				}
			}, 150);
		} else {
			console.log("❌ Not a PRIME item - item_code:", row.item_code);
		}
	},

	// When item_type changes, recalculate scrap in_qty if it becomes a scrap item
	item_type: function (frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (!row) {
			return;
		}

		// Assign warehouses based on item type
		assign_warehouses(frm, cdt, cdn);

		// If this row is now a scrap item, calculate its in_qty
		if (is_scrap_item_row(row)) {
			recalculate_scrap_in_qty_for_row(frm, row);
		}
	},

	// When target_warhouse is set/changed, recalculate scrap in_qty for that row
	target_warhouse: function (frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (!row) {
			return;
		}

		// Mark that user has manually changed the warehouse (unless we're auto-assigning)
		// Check if this is a user change (not programmatic)
		// Use a small delay to ensure _auto_assigning flag is checked correctly
		setTimeout(function () {
			const current_row = locals[cdt][cdn];
			if (!current_row) return;

			// Only mark as user-changed if we're NOT in the middle of auto-assignment
			if (!current_row._assigning_warehouses && !current_row._auto_assigning) {
				// User manually changed the warehouse - mark it so we don't overwrite it
				// Check if flag is not already set
				const already_marked =
					current_row.user_changed_warehouse === 1 ||
					current_row.user_changed_warehouse === "1" ||
					current_row.user_changed_warehouse === true;

				if (!already_marked) {
					// Set the flag to prevent future auto-assignment
					current_row.user_changed_warehouse = 1;
					frappe.model.set_value(cdt, cdn, "user_changed_warehouse", 1);
				}
			}
		}, 50);

		// Only apply to scrap rows
		if (is_scrap_item_row(row)) {
			recalculate_scrap_in_qty_for_row(frm, row);
		}
	},

	// When source_warehouse is changed manually, mark it as user-modified
	source_warehouse: function (frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (!row) {
			return;
		}

		// Mark that user has manually changed the warehouse (unless we're auto-assigning)
		// Check if this is a user change (not programmatic)
		// Use a small delay to ensure _auto_assigning flag is checked correctly
		setTimeout(function () {
			const current_row = locals[cdt][cdn];
			if (!current_row) return;

			// Only mark as user-changed if we're NOT in the middle of auto-assignment
			if (!current_row._assigning_warehouses && !current_row._auto_assigning) {
				// User manually changed the warehouse - mark it so we don't overwrite it
				// Check if flag is not already set
				const already_marked =
					current_row.user_changed_warehouse === 1 ||
					current_row.user_changed_warehouse === "1" ||
					current_row.user_changed_warehouse === true;

				if (!already_marked) {
					// Set the flag to prevent future auto-assignment
					current_row.user_changed_warehouse = 1;
					frappe.model.set_value(cdt, cdn, "user_changed_warehouse", 1);
				}
			}
		}, 50);
	},

	// When opp_in_plant changes, recalculate closing_stock for the current row
	opp_in_plant: function (frm, cdt, cdn) {
		// Skip calculation if document is submitted
		if (frm.doc.docstatus !== 0) {
			return;
		}
		// Calculate closing_stock for the specific row
		calculate_closing_stock_for_row(frm, cdt, cdn);
	},

	// When issued changes, recalculate closing_stock for the current row
	issued: function (frm, cdt, cdn) {
		// Skip calculation if document is submitted
		if (frm.doc.docstatus !== 0) {
			return;
		}
		// Calculate closing_stock for the specific row
		calculate_closing_stock_for_row(frm, cdt, cdn);
	},

	// When consumption changes (auto-calculated or manual), recalculate closing_stock for the current row
	consumption: function (frm, cdt, cdn) {
		// Skip calculation if document is submitted
		if (frm.doc.docstatus !== 0) {
			return;
		}

		const row = locals[cdt][cdn];
		if (!row) {
			return;
		}

		// CRITICAL: Check synchronously if this is auto-calculation
		// If _auto_calculating_consumption flag is set, this is programmatic change - don't mark as user edit
		if (!row._auto_calculating_consumption) {
			// This appears to be a user edit - mark it immediately
			// Check if flag is not already set
			const already_marked =
				row.user_changed_consumption === 1 ||
				row.user_changed_consumption === "1" ||
				row.user_changed_consumption === true ||
				(row.user_changed_consumption &&
					row.user_changed_consumption !== 0 &&
					row.user_changed_consumption !== "0" &&
					row.user_changed_consumption !== false);

			if (!already_marked) {
				// Set the flag immediately to prevent future auto-calculation
				row.user_changed_consumption = 1;
				// Use set_value to persist it, but don't wait for callback
				frappe.model.set_value(cdt, cdn, "user_changed_consumption", 1, function () {
					// Flag is now persisted
				});
			}
		}

		// Calculate closing_stock for the specific row (handles both raw materials and PRIME items)
		calculate_closing_stock_for_row(frm, cdt, cdn);

		// Recalculate hopper closing qty when consumption changes
		calculate_hopper_closing_qty(frm);

		// If consumption changed for a raw material, recalculate all PRIME item closing_stock
		// (since PRIME items depend on raw material consumption sum)
		if (!is_PRIME_item(row)) {
			setTimeout(function () {
				const rows = frm.doc.material_consumption || [];
				rows.forEach(function (PRIME_row) {
					if (is_PRIME_item(PRIME_row)) {
						calculate_PRIME_item_closing_stock(frm, PRIME_row.doctype, PRIME_row.name);
					}
				});
			}, 100);
		}
	},

	// When in_qty changes (auto-calculated or manual), mark if user edited it
	in_qty: function (frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (!row) {
			return;
		}

		// CRITICAL: Check synchronously if this is auto-calculation
		// If _auto_calculating_in_qty flag is set, this is programmatic change - don't mark as user edit
		if (!row._auto_calculating_in_qty) {
			// This appears to be a user edit - mark it immediately
			// Check if flag is not already set
			const already_marked =
				row.user_changed_in_qty === 1 ||
				row.user_changed_in_qty === "1" ||
				row.user_changed_in_qty === true ||
				(row.user_changed_in_qty &&
					row.user_changed_in_qty !== 0 &&
					row.user_changed_in_qty !== "0" &&
					row.user_changed_in_qty !== false);

			if (!already_marked) {
				// Set the flag immediately to prevent future auto-calculation
				row.user_changed_in_qty = 1;
				// Use set_value to persist it, but don't wait for callback
				frappe.model.set_value(cdt, cdn, "user_changed_in_qty", 1, function () {
					// Flag is now persisted
				});
			}
		}
	},

	// When a row is manually added, assign warehouses if item_type is set
	material_consumption_add: function (frm) {
		// CRITICAL: Only process the newly added row, not all rows
		// Find rows that need processing (have item_type but no warehouses assigned yet)
		setTimeout(function () {
			const rows = frm.doc.material_consumption || [];
			if (!rows.length) {
				return;
			}

			// Find rows that need processing:
			// 1. Have item_type set
			// 2. Don't have warehouses assigned yet
			// 3. User hasn't manually modified warehouses
			const rows_to_process = rows.filter(function (row) {
				if (!row || !row.item_type) {
					return false;
				}

				// Skip if user has already modified warehouses
				const user_changed_warehouse =
					row.user_changed_warehouse === 1 ||
					row.user_changed_warehouse === "1" ||
					row.user_changed_warehouse === true ||
					(row.user_changed_warehouse &&
						row.user_changed_warehouse !== 0 &&
						row.user_changed_warehouse !== "0" &&
						row.user_changed_warehouse !== false);

				if (user_changed_warehouse) {
					return false;
				}

				// Check if warehouses are already assigned
				const has_source = row.source_warehouse && row.source_warehouse.trim() !== "";
				const has_target = row.target_warhouse && row.target_warhouse.trim() !== "";

				// If item_type is set but warehouses are not assigned, this row needs processing
				return !has_source && !has_target;
			});

			// Process only the rows that need processing (typically just the newly added row)
			rows_to_process.forEach(function (row) {
				// Assign warehouses for the new row only
				assign_warehouses(frm, row.doctype, row.name);

				// Calculate closing_stock for new rows (handles both raw materials and PRIME items)
				// Use a longer timeout to ensure item_name, opp_in_plant, issued, and consumption are available
				setTimeout(function () {
					const current_row = locals[row.doctype] && locals[row.doctype][row.name];
					if (current_row) {
						calculate_closing_stock_for_row(frm, row.doctype, row.name);
					}
				}, 400);
			});
		}, 100);
	},

	// When child table is refreshed, ensure warehouses are assigned (only for new rows)
	material_consumption_refresh: function (frm) {
		// CRITICAL: Skip if we just saved to prevent form becoming dirty
		if (frm._just_saved) {
			return;
		}

		// Only assign warehouses for new rows (not user-modified ones) after table refresh
		if (frm.doc.docstatus === 0) {
			setTimeout(function () {
				// Double-check the flag in case it was set during timeout
				if (frm._just_saved) {
					return;
				}
				assign_warehouses_for_all_rows(frm);
				// Recalculate hopper closing qty after table refresh (in case rows were added/removed)
				calculate_hopper_closing_qty(frm);
				// Also recalculate PRIME item closing_stock after table refresh
				recalculate_PRIME_items_closing_stock(frm);
			}, 200);
		}
	},
});

/**
 * Assign warehouses for a specific row based on item type.
 * This function automatically sets source_warehouse and target_warehouse
 * based on the item_type field.
 *
 * IMPORTANT: This function will ONLY auto-assign warehouses if:
 * - The row is new (user_changed_warehouse is 0 or undefined)
 * - The warehouse field is empty
 * - The user has not manually changed the warehouse
 *
 * Rules:
 * - Raw Material (item_type === "BOM Item"):
 *     source_warehouse = "Raw Material - HEX"
 *     target_warehouse = ""
 * - Scrap Item (item_type === "Scrap Item"):
 *     target_warehouse = "Production - HEX"
 *     source_warehouse = ""
 * - Main Item (item_type === "Main Item"):
 *     target_warehouse = "Finished Goods - HEX"
 *     source_warehouse = ""
 *
 * @param {Object} frm - The form object
 * @param {string} cdt - Child doctype name
 * @param {string} cdn - Child document name
 */
function assign_warehouses(frm, cdt, cdn) {
	// Don't modify submitted documents
	if (frm.doc.docstatus === 1) {
		return;
	}

	const row = locals[cdt][cdn];
	if (!row) {
		return;
	}

	// If item_type is not set yet, skip
	if (!row.item_type) {
		return;
	}

	// CRITICAL: If user has manually changed the warehouse, NEVER overwrite it
	// Check both number 1 and string "1" for compatibility, and also check if value exists and is truthy
	const user_changed =
		row.user_changed_warehouse === 1 ||
		row.user_changed_warehouse === "1" ||
		row.user_changed_warehouse === true ||
		(row.user_changed_warehouse &&
			row.user_changed_warehouse !== 0 &&
			row.user_changed_warehouse !== "0" &&
			row.user_changed_warehouse !== false);

	if (user_changed) {
		return;
	}

	// Prevent infinite loops by checking if we're already in the middle of assignment
	if (row._assigning_warehouses || row._auto_assigning) {
		return;
	}

	// Mark row to prevent infinite loops and to indicate we're auto-assigning
	row._assigning_warehouses = true;
	row._auto_assigning = true;

	const item_type = row.item_type;
	let source_warehouse = "";
	let target_warehouse = "";

	// Assign warehouses based on item type
	if (item_type === "BOM Item") {
		// Raw Material
		source_warehouse = "Production - HEX";
		target_warehouse = "";
	} else if (item_type === "Scrap Item") {
		// Scrap Item
		source_warehouse = "";
		target_warehouse = "Production - HEX";
	} else if (item_type === "Main Item") {
		// Main Item
		source_warehouse = "";
		target_warehouse = "Finished Goods - HEX";
	} else {
		// Unknown item type, clear flags and return
		row._assigning_warehouses = false;
		row._auto_assigning = false;
		return;
	}

	// Only auto-assign if the warehouse field is empty
	// This ensures we only fill empty fields, not overwrite existing values
	let should_update_source = false;
	let should_update_target = false;

	if (item_type === "BOM Item") {
		// For raw materials, only set source_warehouse if it's empty
		if (!row.source_warehouse || row.source_warehouse === "") {
			should_update_source = true;
		}
		// Clear target_warehouse if it's set (raw materials shouldn't have target)
		if (row.target_warhouse && row.target_warhouse !== "") {
			should_update_target = true;
		}
	} else if (item_type === "Scrap Item" || item_type === "Main Item") {
		// For scrap/main items, only set target_warehouse if it's empty
		if (!row.target_warhouse || row.target_warhouse === "") {
			should_update_target = true;
		}
		// Clear source_warehouse if it's set (scrap/main items shouldn't have source)
		if (row.source_warehouse && row.source_warehouse !== "") {
			should_update_source = true;
		}
	}

	// Track how many updates we're making
	let update_count = 0;
	const total_updates = (should_update_source ? 1 : 0) + (should_update_target ? 1 : 0);

	const clear_flags = function () {
		update_count++;
		if (update_count >= total_updates) {
			// All updates complete, clear flags after a delay
			setTimeout(function () {
				if (row) {
					row._assigning_warehouses = false;
					row._auto_assigning = false;
				}
			}, 200);
		}
	};

	// Update warehouses only if needed
	if (should_update_source) {
		frappe.model.set_value(cdt, cdn, "source_warehouse", source_warehouse, clear_flags);
	}

	// Note: fieldname is "target_warhouse" (typo in doctype definition)
	if (should_update_target) {
		frappe.model.set_value(cdt, cdn, "target_warhouse", target_warehouse, clear_flags);
	}

	// If no updates were needed, clear flags immediately
	if (total_updates === 0) {
		row._assigning_warehouses = false;
		row._auto_assigning = false;
	}
}

/**
 * Assign warehouses for all rows in the material_consumption table.
 * This is called after BOM selection or when main/scrap items are added.
 *
 * @param {Object} frm - The form object
 */
function assign_warehouses_for_all_rows(frm) {
	// Don't modify submitted documents
	if (frm.doc.docstatus !== 0) {
		return;
	}

	// Skip if we just saved to prevent dirtying the form
	if (frm._just_saved) {
		return;
	}

	const rows = frm.doc.material_consumption || [];
	if (!rows.length) {
		return;
	}

	// Assign warehouses for each row that has an item_type
	rows.forEach(function (row) {
		if (row && row.item_type) {
			// Use setTimeout to ensure row is fully initialized
			setTimeout(function () {
				// Double-check the flag in case it was set during timeout
				if (frm._just_saved) {
					return;
				}
				assign_warehouses(frm, row.doctype, row.name);
			}, 50);
		}
	});
}

/**
 * Helper function to add items to the material_consumption child table.
 * Prevents duplicate entries based on item_code.
 * Auto-fills in_qty for main item with manufactured_qty value.
 *
 * @param {Object} frm - The form object
 * @param {Array} items - Array of item objects to add
 * @param {string} main_item_code - The main item code from BOM (optional)
 * @returns {number} - Number of items actually added (excluding duplicates)
 */
function add_items_to_table(frm, items, main_item_code = null) {
	if (!items || items.length === 0) {
		return 0;
	}

	// Get existing item codes in the table to prevent duplicates
	const existing_item_codes = new Set();
	(frm.doc.material_consumption || []).forEach((row) => {
		if (row.item_code) {
			existing_item_codes.add(row.item_code);
		}
	});

	let added_count = 0;
	const manufactured_qty = flt(frm.doc.manufactured_qty) || 0;

	// Add each item to the child table
	items.forEach(function (item) {
		// Skip if item_code is missing or already exists
		if (!item.item_code || existing_item_codes.has(item.item_code)) {
			return;
		}

		let row = frm.add_child("material_consumption");

		// Initialize user_changed flags to 0 for new rows
		row.user_changed_warehouse = 0;
		row.user_changed_consumption = 0;
		row.user_changed_in_qty = 0;

		// Set item_code using frappe.model.set_value to trigger auto-fetch
		// This will auto-fetch item_name, stock_uom, item_description from Item master
		frappe.model.set_value(row.doctype, row.name, "item_code", item.item_code);

		// Explicitly set item_name if available from BOM item data
		// This ensures item_name is populated even if fetch_from doesn't work programmatically
		if (item.item_name) {
			frappe.model.set_value(row.doctype, row.name, "item_name", item.item_name);
		}

		// Do NOT set 'issued' from BOM qty directly.
		// 'issued' will be computed based on qty_to_manufacture and BOM ratios.
		frappe.model.set_value(row.doctype, row.name, "issued", 0);

		// Set UOM from BOM if provided (will override auto-fetched value)
		if (item.uom) {
			frappe.model.set_value(row.doctype, row.name, "stock_uom", item.uom);
		}

		// Set description from BOM if provided (will override auto-fetched value)
		if (item.description) {
			frappe.model.set_value(row.doctype, row.name, "item_description", item.description);
		}

		// Set item_type to distinguish BOM Item, Main Item, or Scrap Item
		if (item.item_type) {
			// Set item_type directly on the row first (synchronous)
			row.item_type = item.item_type;

			// Then use set_value to persist it and assign warehouses in callback
			frappe.model.set_value(
				row.doctype,
				row.name,
				"item_type",
				item.item_type,
				function () {
					// Assign warehouses after item_type is set
					assign_warehouses(frm, row.doctype, row.name);

					// If this is a scrap item and manufactured_qty is available, calculate in_qty
					if (item.item_type === "Scrap Item" && manufactured_qty > 0 && frm.doc.bom) {
						setTimeout(function () {
							const scrap_row = locals[row.doctype][row.name];
							if (scrap_row) {
								recalculate_scrap_in_qty_for_row(frm, scrap_row);
							}
						}, 100);
					}
				}
			);

			// Also try to assign warehouses immediately (in case callback doesn't fire)
			setTimeout(function () {
				const current_row = locals[row.doctype][row.name];
				if (current_row && current_row.item_type) {
					assign_warehouses(frm, row.doctype, row.name);
				}
			}, 150);
		}

		// Auto-fill in_qty for main item only with manufactured_qty
		// Check if this is the main item by comparing item_code
		if (main_item_code && item.item_code === main_item_code && manufactured_qty > 0) {
			// CRITICAL: Set flag BEFORE calling set_value to prevent event handler from marking as user-changed
			row._auto_calculating_in_qty = true;
			frappe.model.set_value(row.doctype, row.name, "in_qty", manufactured_qty, function () {
				setTimeout(function () {
					const current_row = locals[row.doctype] && locals[row.doctype][row.name];
					if (current_row) {
						current_row._auto_calculating_in_qty = false;
					}
				}, 200);
			});
		}

		// For scrap items, in_qty will be auto-calculated from BOM Scrap ratios
		// based on manufactured_qty and BOM scrap quantities.

		// Mark item as added
		existing_item_codes.add(item.item_code);
		added_count++;
	});

	return added_count;
}

/**
 * Fetch BOM main item and scrap items, then append them to the material_consumption table.
 * This is called when manufactured_qty is filled.
 * Auto-fills in_qty for main item with manufactured_qty value.
 *
 * @param {Object} frm - The form object
 */
function fetch_and_append_main_and_scrap_items(frm) {
	if (!frm.doc.bom) {
		return;
	}

	// Fetch main item and scrap items from server
	frappe.call({
		method: "hexplastics.api.production_log_book.get_bom_main_and_scrap_items",
		args: {
			bom_name: frm.doc.bom,
		},
		callback: function (r) {
			if (r.message && r.message.items && r.message.items.length > 0) {
				const main_item_code = r.message.main_item_code;
				const items = r.message.items;

				// Store main_item_code in form for later reference
				frm._bom_main_item_code = main_item_code;

				// Append items to the table (without removing existing BOM Items)
				// Pass main_item_code to auto-fill in_qty for main item
				const added_count = add_items_to_table(frm, items, main_item_code);

				// Refresh the child table to show new rows first
				frm.refresh_field("material_consumption");

				// Assign warehouses for all rows after main/scrap items are added
				// Use longer timeout to ensure all set_value callbacks have completed
				setTimeout(function () {
					assign_warehouses_for_all_rows(frm);
					// Refresh again after assigning warehouses to show the values
					setTimeout(function () {
						frm.refresh_field("material_consumption");
					}, 200);
				}, 400);

				// Recalculate consumption after adding new items
				recalculate_consumption_for_material_consumption(frm);

				// Recalculate closing_stock for raw materials
				recalculate_closing_stock_for_raw_materials(frm);

				// Recalculate scrap in_qty for scrap items if manufactured_qty is present
				if (frm.doc.manufactured_qty) {
					recalculate_scrap_in_qty_for_material_consumption(frm);
				}

				// Show success message if items were added
				if (added_count > 0) {
					frappe.show_alert(
						{
							message: __("{0} item(s) added (main item and scrap items)", [
								added_count,
							]),
							indicator: "green",
						},
						3
					);
				}
			}
		},
		error: function (r) {
			// Handle error silently or show a message
			console.error("Error fetching BOM main and scrap items:", r);
		},
	});
}

/**
 * Update the in_qty field for the main item in Material Consumption Table
 * when manufactured_qty changes. Only updates the main item, not BOM items or scrap items.
 *
 * @param {Object} frm - The form object
 */
function update_main_item_in_qty(frm) {
	if (!frm.doc.bom) {
		return;
	}

	// Get the main item code from BOM
	// First try to get it from cached value, otherwise fetch from BOM
	if (!frm._bom_main_item_code) {
		frappe.call({
			method: "hexplastics.api.production_log_book.get_bom_main_and_scrap_items",
			args: {
				bom_name: frm.doc.bom,
			},
			callback: function (r) {
				if (r.message && r.message.main_item_code) {
					frm._bom_main_item_code = r.message.main_item_code;
					update_main_item_in_qty_in_table(frm, r.message.main_item_code);
				}
			},
		});
	} else {
		update_main_item_in_qty_in_table(frm, frm._bom_main_item_code);
	}
}

/**
 * Helper function to update in_qty for main item in the material_consumption table.
 *
 * IMPORTANT: This function will ONLY auto-calculate in_qty if:
 * - The row is new (user_changed_in_qty is 0 or undefined)
 * - The user has not manually changed the in_qty
 *
 * @param {Object} frm - The form object
 * @param {string} main_item_code - The main item code from BOM
 */
function update_main_item_in_qty_in_table(frm, main_item_code) {
	if (!main_item_code) {
		return;
	}

	// Never recalculate for submitted/cancelled docs to avoid changing values after submission
	if (frm.doc.docstatus === 1) {
		return;
	}

	const manufactured_qty = flt(frm.doc.manufactured_qty) || 0;
	const rows = frm.doc.material_consumption || [];

	// Find the row with the main item code and update its in_qty
	let main_item_found = false;
	rows.forEach((row) => {
		if (row.item_code === main_item_code) {
			// CRITICAL: If user has manually changed in_qty, NEVER overwrite it
			const user_changed =
				row.user_changed_in_qty === 1 ||
				row.user_changed_in_qty === "1" ||
				row.user_changed_in_qty === true ||
				(row.user_changed_in_qty &&
					row.user_changed_in_qty !== 0 &&
					row.user_changed_in_qty !== "0" &&
					row.user_changed_in_qty !== false);

			if (!user_changed) {
				// CRITICAL: Set flag BEFORE calling set_value to prevent event handler from marking as user-changed
				row._auto_calculating_in_qty = true;
				frappe.model.set_value(
					row.doctype,
					row.name,
					"in_qty",
					manufactured_qty,
					function () {
						setTimeout(function () {
							const current_row =
								locals[row.doctype] && locals[row.doctype][row.name];
							if (current_row) {
								current_row._auto_calculating_in_qty = false;
							}
						}, 200);
					}
				);
			}
			main_item_found = true;
		}
	});

	// If main item not found in table but manufactured_qty exists, fetch and add it
	if (!main_item_found && manufactured_qty > 0) {
		fetch_and_append_main_and_scrap_items(frm);
	} else if (main_item_found) {
		// Refresh the field to show updated in_qty
		frm.refresh_field("material_consumption");
	}
}

/**
 * Recalculate 'issued' for all rows in material_consumption child table.
 *
 * Logic:
 *   base = item_quantity_from_BOM_items / BOM_main_quantity
 *   issued = base * qty_to_manufacture
 *
 * If any required value is missing or invalid, issued is set to 0.
 * Division by zero is prevented by checking BOM_main_quantity > 0.
 */
function recalculate_issued_for_material_consumption(frm) {
	const bom = frm.doc.bom;
	const qty_to_manufacture = flt(frm.doc.qty_to_manufacture);

	// If essential inputs are missing, set issued = 0 for all rows and exit
	if (!bom || !qty_to_manufacture) {
		(frm.doc.material_consumption || []).forEach((row) => {
			frappe.model.set_value(row.doctype, row.name, "issued", 0);
		});
		return;
	}

	const rows = frm.doc.material_consumption || [];
	if (!rows.length) {
		return;
	}

	// Collect item codes in the child table
	const item_codes = rows.map((row) => row.item_code).filter((c) => !!c);

	if (!item_codes.length) {
		// No valid item codes; set issued = 0
		rows.forEach((row) => {
			frappe.model.set_value(row.doctype, row.name, "issued", 0);
		});
		return;
	}

	// Fetch BOM main quantity and BOM item quantities for the listed item codes
	frappe.call({
		method: "hexplastics.api.production_log_book.get_bom_item_quantities",
		args: {
			bom_name: bom,
			item_codes: item_codes,
		},
		freeze: false,
		callback: function (r) {
			const data = r.message || {};
			const bom_qty = flt(data.bom_qty);

			// Prepare a quick lookup for item quantities from BOM
			const qty_by_item = {};
			(data.items || []).forEach((item) => {
				if (item.item_code) {
					qty_by_item[item.item_code] = flt(item.qty);
				}
			});

			rows.forEach((row) => {
				// CRITICAL: Skip PRIME items - they don't use BOM-based calculations
				if (is_PRIME_item(row)) {
					return; // Skip this row - PRIME items don't use issued calculation
				}

				const item_code = row.item_code;
				const bom_item_qty = qty_by_item[item_code] || 0;
				let issued = 0;

				// Compute only if both BOM main quantity and item quantity are valid
				if (bom_qty > 0 && bom_item_qty > 0 && qty_to_manufacture > 0) {
					const base = bom_item_qty / bom_qty; // safe: bom_qty > 0
					issued = base * qty_to_manufacture;
				}

				// If anything is missing or invalid, issued remains 0 as per requirement
				frappe.model.set_value(row.doctype, row.name, "issued", issued || 0);
			});

			frm.refresh_field("material_consumption");

			// Recalculate closing_stock for raw materials after issued is updated
			recalculate_closing_stock_for_raw_materials(frm);
		},
	});
}

/**
 * Recalculate 'consumption' for all rows in material_consumption child table.
 *
 * Logic:
 *   base = item_quantity_from_BOM_items / BOM_main_quantity
 *   consumption = base * manufactured_qty
 *
 * If any required value is missing or invalid, consumption is set to 0.
 * Division by zero is prevented by checking BOM_main_quantity > 0.
 *
 * IMPORTANT: This function will ONLY auto-calculate consumption if:
 * - The row is new (user_changed_consumption is 0 or undefined)
 * - The user has not manually changed the consumption
 */
function recalculate_consumption_for_material_consumption(frm) {
	// Never recalculate for submitted/cancelled docs to avoid changing values after submission
	if (frm.doc.docstatus === 1) {
		return;
	}

	const bom = frm.doc.bom;
	const manufactured_qty = flt(frm.doc.manufactured_qty);

	// If essential inputs are missing, set consumption = 0 for all rows that haven't been user-modified
	if (!bom || !manufactured_qty) {
		(frm.doc.material_consumption || []).forEach((row) => {
			// Only auto-set to 0 if user hasn't manually changed it
			const user_changed =
				row.user_changed_consumption === 1 ||
				row.user_changed_consumption === "1" ||
				row.user_changed_consumption === true ||
				(row.user_changed_consumption &&
					row.user_changed_consumption !== 0 &&
					row.user_changed_consumption !== "0" &&
					row.user_changed_consumption !== false);

			if (!user_changed) {
				// CRITICAL: Set flag BEFORE calling set_value
				row._auto_calculating_consumption = true;
				frappe.model.set_value(row.doctype, row.name, "consumption", 0, function () {
					setTimeout(function () {
						const current_row = locals[row.doctype] && locals[row.doctype][row.name];
						if (current_row) {
							current_row._auto_calculating_consumption = false;
						}
					}, 200);
				});
			}
		});
		return;
	}

	const rows = frm.doc.material_consumption || [];
	if (!rows.length) {
		return;
	}

	// Collect item codes in the child table
	const item_codes = rows.map((row) => row.item_code).filter((c) => !!c);

	if (!item_codes.length) {
		// No valid item codes; set consumption = 0 for rows that haven't been user-modified
		rows.forEach((row) => {
			const user_changed =
				row.user_changed_consumption === 1 ||
				row.user_changed_consumption === "1" ||
				row.user_changed_consumption === true ||
				(row.user_changed_consumption &&
					row.user_changed_consumption !== 0 &&
					row.user_changed_consumption !== "0" &&
					row.user_changed_consumption !== false);

			if (!user_changed) {
				// CRITICAL: Set flag BEFORE calling set_value
				row._auto_calculating_consumption = true;
				frappe.model.set_value(row.doctype, row.name, "consumption", 0, function () {
					setTimeout(function () {
						const current_row = locals[row.doctype] && locals[row.doctype][row.name];
						if (current_row) {
							current_row._auto_calculating_consumption = false;
						}
					}, 200);
				});
			}
		});
		return;
	}

	// Reuse the same server method that provides BOM main quantity and item quantities
	frappe.call({
		method: "hexplastics.api.production_log_book.get_bom_item_quantities",
		args: {
			bom_name: bom,
			item_codes: item_codes,
		},
		freeze: false,
		callback: function (r) {
			const data = r.message || {};
			const bom_qty = flt(data.bom_qty);

			// Prepare a quick lookup for item quantities from BOM
			const qty_by_item = {};
			(data.items || []).forEach((item) => {
				if (item.item_code) {
					qty_by_item[item.item_code] = flt(item.qty);
				}
			});

			rows.forEach((row) => {
				// CRITICAL: Skip PRIME items - they don't use BOM-based calculations
				if (is_PRIME_item(row)) {
					return; // Skip this row - PRIME items don't use consumption calculation
				}

				// CRITICAL: If user has manually changed consumption, NEVER overwrite it
				// Check both the row object and the persisted value
				const row_user_changed =
					row.user_changed_consumption === 1 ||
					row.user_changed_consumption === "1" ||
					row.user_changed_consumption === true ||
					(row.user_changed_consumption &&
						row.user_changed_consumption !== 0 &&
						row.user_changed_consumption !== "0" &&
						row.user_changed_consumption !== false);

				if (row_user_changed) {
					return; // Skip this row - user has manually edited consumption
				}

				const item_code = row.item_code;
				const bom_item_qty = qty_by_item[item_code] || 0;
				let consumption = 0;

				// Compute only if both BOM main quantity and item quantity are valid
				if (bom_qty > 0 && bom_item_qty > 0 && manufactured_qty > 0) {
					const base = bom_item_qty / bom_qty; // safe: bom_qty > 0
					consumption = base * manufactured_qty;
				}

				// CRITICAL: Set flag BEFORE calling set_value to prevent event handler from marking as user edit
				// This must be set synchronously before the set_value call
				row._auto_calculating_consumption = true;

				// If anything is missing or invalid, consumption remains 0 as per requirement
				frappe.model.set_value(
					row.doctype,
					row.name,
					"consumption",
					consumption || 0,
					function () {
						// After set_value completes, clear the flag with a delay to ensure event handler has finished
						setTimeout(function () {
							const current_row =
								locals[row.doctype] && locals[row.doctype][row.name];
							if (current_row) {
								current_row._auto_calculating_consumption = false;
							}
						}, 200);
					}
				);
			});

			frm.refresh_field("material_consumption");

			// Recalculate closing_stock for raw materials after consumption is updated
			recalculate_closing_stock_for_raw_materials(frm);

			// Recalculate hopper closing qty after consumption is updated
			// Use setTimeout to ensure all set_value callbacks have completed
			setTimeout(function () {
				calculate_hopper_closing_qty(frm);
				// Also recalculate PRIME item closing_stock
				recalculate_PRIME_items_closing_stock(frm);
			}, 300);
		},
	});
}

/**
 * Recalculate 'issued' for a single row in material_consumption child table.
 * This function only processes the specified row, not all rows.
 *
 * Logic:
 *   base = item_quantity_from_BOM_items / BOM_main_quantity
 *   issued = base * qty_to_manufacture
 *
 * @param {Object} frm - The form object
 * @param {string} cdt - Child doctype name
 * @param {string} cdn - Child document name
 */
function recalculate_issued_for_single_row(frm, cdt, cdn) {
	const row = locals[cdt][cdn];
	if (!row || !row.item_code) {
		return;
	}

	// CRITICAL: Skip PRIME items - they don't use BOM-based calculations
	if (is_PRIME_item(row)) {
		return; // Skip this row - PRIME items don't use issued calculation
	}

	const bom = frm.doc.bom;
	const qty_to_manufacture = flt(frm.doc.qty_to_manufacture);

	// If essential inputs are missing, set issued = 0 for this row
	if (!bom || !qty_to_manufacture) {
		frappe.model.set_value(cdt, cdn, "issued", 0);
		return;
	}

	// Fetch BOM main quantity and BOM item quantity for this specific item
	frappe.call({
		method: "hexplastics.api.production_log_book.get_bom_item_quantities",
		args: {
			bom_name: bom,
			item_codes: [row.item_code],
		},
		freeze: false,
		callback: function (r) {
			const data = r.message || {};
			const bom_qty = flt(data.bom_qty);

			// Get item quantity from BOM
			let bom_item_qty = 0;
			if (data.items && data.items.length > 0) {
				const item = data.items.find((item) => item.item_code === row.item_code);
				if (item) {
					bom_item_qty = flt(item.qty);
				}
			}

			let issued = 0;

			// Compute only if both BOM main quantity and item quantity are valid
			if (bom_qty > 0 && bom_item_qty > 0 && qty_to_manufacture > 0) {
				const base = bom_item_qty / bom_qty; // safe: bom_qty > 0
				issued = base * qty_to_manufacture;
			}

			// Update issued for this row only
			frappe.model.set_value(cdt, cdn, "issued", issued || 0);

			// Recalculate closing_stock for this row (handles both raw materials and PRIME items)
			setTimeout(function () {
				calculate_closing_stock_for_row(frm, cdt, cdn);
			}, 100);
		},
	});
}

/**
 * Recalculate 'consumption' for a single row in material_consumption child table.
 * This function only processes the specified row, not all rows.
 *
 * Logic:
 *   base = item_quantity_from_BOM_items / BOM_main_quantity
 *   consumption = base * manufactured_qty
 *
 * IMPORTANT: This function will ONLY auto-calculate consumption if:
 * - The user has not manually changed the consumption
 *
 * @param {Object} frm - The form object
 * @param {string} cdt - Child doctype name
 * @param {string} cdn - Child document name
 */
function recalculate_consumption_for_single_row(frm, cdt, cdn) {
	const row = locals[cdt][cdn];
	if (!row || !row.item_code) {
		return;
	}

	// Never recalculate for submitted/cancelled docs
	if (frm.doc.docstatus === 1) {
		return;
	}

	// CRITICAL: Skip PRIME items - they don't use BOM-based calculations
	if (is_PRIME_item(row)) {
		return; // Skip this row - PRIME items don't use consumption calculation
	}

	// CRITICAL: If user has manually changed consumption, NEVER overwrite it
	const user_changed =
		row.user_changed_consumption === 1 ||
		row.user_changed_consumption === "1" ||
		row.user_changed_consumption === true ||
		(row.user_changed_consumption &&
			row.user_changed_consumption !== 0 &&
			row.user_changed_consumption !== "0" &&
			row.user_changed_consumption !== false);

	if (user_changed) {
		return; // Skip this row - user has manually edited consumption
	}

	const bom = frm.doc.bom;
	const manufactured_qty = flt(frm.doc.manufactured_qty);

	// If essential inputs are missing, set consumption = 0 for this row
	if (!bom || !manufactured_qty) {
		// CRITICAL: Set flag BEFORE calling set_value
		row._auto_calculating_consumption = true;
		frappe.model.set_value(cdt, cdn, "consumption", 0, function () {
			setTimeout(function () {
				const current_row = locals[cdt] && locals[cdt][cdn];
				if (current_row) {
					current_row._auto_calculating_consumption = false;
				}
			}, 200);
		});
		return;
	}

	// Fetch BOM main quantity and BOM item quantity for this specific item
	frappe.call({
		method: "hexplastics.api.production_log_book.get_bom_item_quantities",
		args: {
			bom_name: bom,
			item_codes: [row.item_code],
		},
		freeze: false,
		callback: function (r) {
			const data = r.message || {};
			const bom_qty = flt(data.bom_qty);

			// Get item quantity from BOM
			let bom_item_qty = 0;
			if (data.items && data.items.length > 0) {
				const item = data.items.find((item) => item.item_code === row.item_code);
				if (item) {
					bom_item_qty = flt(item.qty);
				}
			}

			let consumption = 0;

			// Compute only if both BOM main quantity and item quantity are valid
			if (bom_qty > 0 && bom_item_qty > 0 && manufactured_qty > 0) {
				const base = bom_item_qty / bom_qty; // safe: bom_qty > 0
				consumption = base * manufactured_qty;
			}

			// CRITICAL: Set flag BEFORE calling set_value to prevent event handler from marking as user edit
			row._auto_calculating_consumption = true;

			// Update consumption for this row only
			frappe.model.set_value(cdt, cdn, "consumption", consumption || 0, function () {
				// After set_value completes, clear the flag with a delay
				setTimeout(function () {
					const current_row = locals[cdt] && locals[cdt][cdn];
					if (current_row) {
						current_row._auto_calculating_consumption = false;
					}
				}, 200);
			});

			// Recalculate closing_stock for this row (handles both raw materials and PRIME items)
			setTimeout(function () {
				calculate_closing_stock_for_row(frm, cdt, cdn);
			}, 100);

			// Recalculate hopper closing qty after consumption is updated
			setTimeout(function () {
				calculate_hopper_closing_qty(frm);
			}, 200);
		},
	});
}

/**
 * Identify if a row in Material Consumption is a scrap item row.
 *
 * Rules:
 * - item_type === "Scrap Item"
 *
 * Note: target_warehouse is not required for calculation, only for final validation.
 *
 * @param {Object} row - The child table row object
 * @returns {boolean} - True if the row is a scrap item row, false otherwise
 */
function is_scrap_item_row(row) {
	if (!row) {
		return false;
	}

	return row.item_type === "Scrap Item";
}

/**
 * Recalculate in_qty for a single scrap item row using the server-side BOM ratio.
 *
 * Calls:
 *   hexplastics.api.production_log_book.calculate_scrap_in_qty
 *
 * If any required value is missing, in_qty is set to 0 as per requirements.
 *
 * IMPORTANT: This function will ONLY auto-calculate in_qty if:
 * - The row is new (user_changed_in_qty is 0 or undefined)
 * - The user has not manually changed the in_qty
 *
 * @param {Object} frm - The form object
 * @param {Object} row - The child table row object
 */
function recalculate_scrap_in_qty_for_row(frm, row) {
	if (!frm || !row) {
		return;
	}

	// Never recalculate for submitted/cancelled docs to avoid changing values after submission
	if (frm.doc.docstatus === 1) {
		return;
	}

	// Only operate on scrap rows (identified by item_type)
	if (!is_scrap_item_row(row)) {
		return;
	}

	// CRITICAL: If user has manually changed in_qty, NEVER overwrite it
	const user_changed =
		row.user_changed_in_qty === 1 ||
		row.user_changed_in_qty === "1" ||
		row.user_changed_in_qty === true ||
		(row.user_changed_in_qty &&
			row.user_changed_in_qty !== 0 &&
			row.user_changed_in_qty !== "0" &&
			row.user_changed_in_qty !== false);

	if (user_changed) {
		return; // Skip this row - user has manually edited in_qty
	}

	const bom = frm.doc.bom;
	const manufactured_qty = flt(frm.doc.manufactured_qty) || 0;
	const item_code = row.item_code;

	// If any required value is missing, set in_qty = 0 (only if user hasn't changed it)
	if (!bom || !item_code || !manufactured_qty) {
		// CRITICAL: Set flag BEFORE calling set_value
		row._auto_calculating_in_qty = true;
		frappe.model.set_value(row.doctype, row.name, "in_qty", 0, function () {
			setTimeout(function () {
				const current_row = locals[row.doctype] && locals[row.doctype][row.name];
				if (current_row) {
					current_row._auto_calculating_in_qty = false;
				}
			}, 200);
		});
		return;
	}

	frappe.call({
		method: "hexplastics.api.production_log_book.calculate_scrap_in_qty",
		args: {
			bom_name: bom,
			item_code: item_code,
			manufactured_qty: manufactured_qty,
		},
		freeze: false,
		callback: function (r) {
			const data = r.message || {};
			const in_qty = flt(data.in_qty) || 0;

			// CRITICAL: Set flag BEFORE calling set_value to prevent event handler from marking as user-changed
			row._auto_calculating_in_qty = true;

			// Set calculated in_qty back on the row
			frappe.model.set_value(row.doctype, row.name, "in_qty", in_qty, function () {
				setTimeout(function () {
					const current_row = locals[row.doctype] && locals[row.doctype][row.name];
					if (current_row) {
						current_row._auto_calculating_in_qty = false;
					}
				}, 200);
			});
		},
		error: function (err) {
			// On error, fail-safe to 0 and log
			console.error("Error calculating scrap in_qty:", err);
			// CRITICAL: Set flag BEFORE calling set_value
			row._auto_calculating_in_qty = true;
			frappe.model.set_value(row.doctype, row.name, "in_qty", 0, function () {
				setTimeout(function () {
					const current_row = locals[row.doctype] && locals[row.doctype][row.name];
					if (current_row) {
						current_row._auto_calculating_in_qty = false;
					}
				}, 200);
			});
		},
	});
}

/**
 * Recalculate in_qty for all scrap rows in the Material Consumption table.
 *
 * This is invoked when:
 * - manufactured_qty changes
 * - form is refreshed (for draft docs)
 * - BOM is changed and manufactured_qty is present
 *
 * @param {Object} frm - The form object
 */
function recalculate_scrap_in_qty_for_material_consumption(frm) {
	if (!frm || !frm.doc || !frm.doc.material_consumption) {
		return;
	}

	const rows = frm.doc.material_consumption || [];
	if (!rows.length) {
		return;
	}

	rows.forEach((row) => {
		if (is_scrap_item_row(row)) {
			recalculate_scrap_in_qty_for_row(frm, row);
		}
	});
}

/**
 * Reset in_qty to 0 for all scrap rows in the Material Consumption table.
 *
 * Used when manufactured_qty is cleared.
 * Note: This will reset even if user has manually changed in_qty, since the source
 * (manufactured_qty) is being cleared by the user.
 *
 * @param {Object} frm - The form object
 */
function reset_scrap_in_qty_for_material_consumption(frm) {
	if (!frm || !frm.doc || !frm.doc.material_consumption) {
		return;
	}

	// Never reset for submitted/cancelled docs
	if (frm.doc.docstatus === 1) {
		return;
	}

	const rows = frm.doc.material_consumption || [];
	if (!rows.length) {
		return;
	}

	rows.forEach((row) => {
		if (row && row.item_type === "Scrap Item") {
			// CRITICAL: Set flag BEFORE calling set_value to prevent event handler from marking as user-changed
			row._auto_calculating_in_qty = true;
			frappe.model.set_value(row.doctype, row.name, "in_qty", 0, function () {
				setTimeout(function () {
					const current_row = locals[row.doctype] && locals[row.doctype][row.name];
					if (current_row) {
						current_row._auto_calculating_in_qty = false;
					}
				}, 200);
			});
		}
	});
}

/**
 * Check if a row represents a raw material.
 * A row is considered a raw material if item_type === "BOM Item".
 *
 * @param {Object} row - The child table row object
 * @returns {boolean} - True if the row is a raw material, false otherwise
 */
function is_raw_material(row) {
	return row && row.item_type === "BOM Item";
}

/**
 * Check if a row represents a PRIME item.
 * A row is considered a PRIME item if item_code starts with "PRIME" (case-insensitive).
 *
 * @param {Object} row - The child table row object
 * @returns {boolean} - True if the row is a PRIME item, false otherwise
 */
function is_PRIME_item(row) {
	if (!row) {
		return false;
	}
	// Check item_code - this is the PRIMARY identifier for PRIME items
	// A row is a PRIME item if item_code starts with "PRIME" (case-insensitive)
	if (row.item_code) {
		const item_code = String(row.item_code).trim();
		const is_PRIME = item_code.toLowerCase().startsWith("prime");
		if (is_PRIME) {
			console.log("✓ PRIME item detected via item_code:", item_code);
		}
		return is_PRIME;
	}
	return false;
}

/**
 * Calculate closing_stock for a specific row when user manually enters values.
 * Formula: closing_stock = opp_in_plant + issued - consumption
 *
 * SPECIAL CASE: For PRIME items, uses Hopper & Tray formula instead:
 * closing_stock = (hopper_add_or_used + SUM(consumption of all RAW MATERIAL rows) + mip_used) - (net_weight + mip_generate + process_loss)
 *
 * This function:
 * - Only calculates for the current row being edited
 * - Treats empty values as 0
 * - Updates closing_stock immediately in the UI
 * - Works for any row (not just raw materials) when values are manually entered
 *
 * @param {Object} frm - The form object
 * @param {string} cdt - Child doctype name
 * @param {string} cdn - Child document name
 */
function calculate_closing_stock_for_row(frm, cdt, cdn) {
	// Skip calculation if document is submitted
	if (frm.doc.docstatus !== 0) {
		return;
	}

	// CRITICAL: Skip if we're in the middle of saving or just saved
	if (frm._is_saving || frm._just_saved) {
		return;
	}

	const row = locals[cdt][cdn];
	if (!row) {
		console.log("⚠️ calculate_closing_stock_for_row: Row not found");
		return;
	}

	console.log("🧮 calculate_closing_stock_for_row called for:", row.item_name || row.item_code);

	// SPECIAL CASE: PRIME items use Hopper & Tray formula
	// Check if item_name exists, if not, wait a bit for it to be fetched
	if (!row.item_name && row.item_code) {
		console.log("⏳ Waiting for item_name to be fetched...");
		// Item name might not be set yet, wait for it
		setTimeout(function () {
			const updated_row = locals[cdt][cdn];
			if (updated_row) {
				calculate_closing_stock_for_row(frm, cdt, cdn);
			}
		}, 200);
		return;
	}

	if (is_PRIME_item(row)) {
		console.log("🎯 PRIME item detected, using Hopper & Tray formula");
		calculate_PRIME_item_closing_stock(frm, cdt, cdn);
		return;
	}

	console.log("📊 Normal item, using standard formula");

	// Get values from the current row, defaulting to 0 if undefined, null, or empty
	const opp_in_plant = flt(row.opp_in_plant) || 0;
	const issued = flt(row.issued) || 0;
	const consumption = flt(row.consumption) || 0;

	// Calculate closing_stock: opp_in_plant + issued - consumption
	const closing_stock = opp_in_plant + issued - consumption;

	// CRITICAL: Update value without using frappe.model.set_value to avoid dirtying the form
	// closing_stock is a calculated field, so we can set it directly
	row.closing_stock = closing_stock;

	// Refresh the grid row to show updated closing_stock
	if (frm.fields_dict.material_consumption && frm.fields_dict.material_consumption.grid) {
		const grid_row = frm.fields_dict.material_consumption.grid.get_row(cdn);
		if (grid_row) {
			grid_row.refresh_field("closing_stock");
		}
	}
}

/**
 * Recalculate closing_stock for all raw material rows in the material_consumption table.
 * Only applies to rows where item_type === "BOM Item".
 * Formula: closing_stock = opp_in_plant + issued - consumption
 *
 * SPECIAL CASE: PRIME items use Hopper & Tray formula instead.
 *
 * @param {Object} frm - The form object
 */
function recalculate_closing_stock_for_raw_materials(frm) {
	// Skip if document is not in draft state
	if (frm.doc.docstatus !== 0) {
		return;
	}

	// CRITICAL: Skip if we're in the middle of saving or just saved
	if (frm._is_saving || frm._just_saved) {
		return;
	}

	const rows = frm.doc.material_consumption || [];
	if (!rows.length) {
		return;
	}

	// Calculate closing_stock for each raw material row
	rows.forEach((row) => {
		if (is_raw_material(row)) {
			// Get values, defaulting to 0 if undefined or null
			const opp_in_plant = flt(row.opp_in_plant) || 0;
			const issued = flt(row.issued) || 0;
			const consumption = flt(row.consumption) || 0;

			// Calculate closing_stock: opening_in_plant + issued - consumption
			const closing_stock = opp_in_plant + issued - consumption;

			// CRITICAL: Update value directly to avoid dirtying the form
			// closing_stock is a calculated field
			row.closing_stock = closing_stock;
		}
	});

	// Also recalculate closing_stock for PRIME items using Hopper & Tray formula
	rows.forEach((row) => {
		if (is_PRIME_item(row)) {
			calculate_PRIME_item_closing_stock(frm, row.doctype, row.name);
		}
	});

	// Refresh the field to show updated values
	frm.refresh_field("material_consumption");
}

/**
 * Recalculate closing_stock for all PRIME items in the material_consumption table.
 * This is called when fields affecting the Hopper & Tray formula change.
 *
 * @param {Object} frm - The form object
 */
function recalculate_PRIME_items_closing_stock(frm) {
	// Skip calculation if document is submitted
	if (frm.doc.docstatus !== 0) {
		return;
	}

	// Skip if we just saved to prevent dirtying the form
	if (frm._just_saved) {
		return;
	}

	const rows = frm.doc.material_consumption || [];
	if (!rows.length) {
		return;
	}

	// Recalculate closing_stock for each PRIME item
	rows.forEach(function (row) {
		if (is_PRIME_item(row)) {
			calculate_PRIME_item_closing_stock(frm, row.doctype, row.name);
		}
	});
}

/**
 * Calculate closing_stock for a PRIME item using Hopper & Tray formula.
 * Formula: closing_stock = (hopper_add_or_used + SUM(consumption of all RAW MATERIAL rows) + mip_used) - (net_weight + mip_generate + process_loss_weight)
 *
 * This is the same formula used for Hopper & Tray closing qty, but applied to PRIME item's closing_stock field.
 *
 * @param {Object} frm - The form object
 * @param {string} cdt - Child doctype name
 * @param {string} cdn - Child document name
 */
function calculate_PRIME_item_closing_stock(frm, cdt, cdn) {
	// Skip calculation if document is submitted
	if (frm.doc.docstatus !== 0) {
		return;
	}

	// CRITICAL: Skip if we're in the middle of saving or just saved
	if (frm._is_saving || frm._just_saved) {
		return;
	}

	const row = locals[cdt][cdn];
	if (!row || !is_PRIME_item(row)) {
		console.log("⚠️ calculate_PRIME_item_closing_stock: Not a PRIME item or row not found");
		return;
	}

	console.log("🔢 Calculating PRIME item closing_stock for:", row.item_name || row.item_code);

	// Get values from Hopper & Tray section, defaulting to 0 if undefined or null
	const hopper_add_or_used = flt(frm.doc.add_or_used) || 0;

	// Sum consumption for raw material rows (those with source_warehouse filled)
	// Exclude PRIME items from this sum
	const material_consumption = frm.doc.material_consumption || [];
	let raw_material_consumption_sum = 0;

	material_consumption.forEach(function (consumption_row) {
		// Only sum consumption for raw material rows (identified by source_warehouse not empty)
		// Exclude PRIME items from the sum
		if (
			consumption_row.source_warehouse &&
			consumption_row.source_warehouse.trim() !== "" &&
			!is_PRIME_item(consumption_row)
		) {
			const consumption = flt(consumption_row.consumption) || 0;
			raw_material_consumption_sum += consumption;
		}
	});

	// Get values from MIP section, defaulting to 0 if undefined or null
	const mip_used = flt(frm.doc.mip_used) || 0;
	const mip_generate = flt(frm.doc.mip_generate) || 0;
	const process_loss_weight = flt(frm.doc.process_loss_weight) || 0;

	// Get value from main section, defaulting to 0 if undefined or null
	const net_weight = flt(frm.doc.net_weight) || 0;

	// Calculate closing_stock using Hopper & Tray formula:
	// (hopper_add_or_used + SUM(raw material consumption) + mip_used) - (net_weight + mip_generate + process_loss_weight)
	const additions = hopper_add_or_used + raw_material_consumption_sum + mip_used;
	const subtractions = net_weight + mip_generate + process_loss_weight;
	const closing_stock = additions - subtractions;

	console.log("📐 Formula breakdown:");
	console.log(
		"  Additions: add_or_used(" +
			hopper_add_or_used +
			") + raw_mat_consumption(" +
			raw_material_consumption_sum +
			") + mip_used(" +
			mip_used +
			") = " +
			additions
	);
	console.log(
		"  Subtractions: net_weight(" +
			net_weight +
			") + mip_generate(" +
			mip_generate +
			") + process_loss(" +
			process_loss_weight +
			") = " +
			subtractions
	);
	console.log(
		"  Final closing_stock = " + additions + " - " + subtractions + " = " + closing_stock
	);

	// CRITICAL: Update value directly to avoid dirtying the form
	// closing_stock is a calculated field
	row.closing_stock = closing_stock;
	console.log("✅ PRIME item closing_stock updated successfully:", closing_stock);

	// Refresh the grid row to show updated closing_stock
	if (frm.fields_dict.material_consumption && frm.fields_dict.material_consumption.grid) {
		const grid_row = frm.fields_dict.material_consumption.grid.get_row(cdn);
		if (grid_row) {
			grid_row.refresh_field("closing_stock");
		}
	}
}

/**
 * Calculate Hopper & Tray closing quantity.
 * Formula: hopper_closing_qty = (hopper_add_or_used + SUM(consumption of raw material rows) + mip_used) - (net_weight + mip_generate + process_loss_weight)
 *
 * Where:
 * - hopper_add_or_used: from add_or_used field
 * - SUM(consumption): sum of consumption for rows where source_warehouse is not empty (raw materials)
 * - mip_used: from mip_used field
 * - net_weight: from net_weight field
 * - mip_generate: from mip_generate field
 * - process_loss_weight: from process_loss_weight field
 *
 * @param {Object} frm - The form object
 */
function calculate_hopper_closing_qty(frm) {
	// Skip calculation for submitted documents to avoid dirtying the document
	if (frm.doc.docstatus !== 0) {
		return;
	}

	// CRITICAL: Skip if we're in the middle of saving or just saved
	if (frm._is_saving || frm._just_saved) {
		console.log("🚫 calculate_hopper_closing_qty BLOCKED - Save in progress");
		return;
	}

	console.log("⚙️ calculate_hopper_closing_qty RUNNING");

	// Get values from Hopper & Tray section, defaulting to 0 if undefined or null
	const hopper_add_or_used = flt(frm.doc.add_or_used) || 0;

	// Sum consumption for raw material rows (those with source_warehouse filled)
	const material_consumption = frm.doc.material_consumption || [];
	let raw_material_consumption_sum = 0;

	material_consumption.forEach(function (row) {
		// Only sum consumption for raw material rows (identified by source_warehouse not empty)
		// Exclude PRIME items from the sum (PRIME items use their own formula)
		if (row.source_warehouse && row.source_warehouse.trim() !== "" && !is_PRIME_item(row)) {
			const consumption = flt(row.consumption) || 0;
			raw_material_consumption_sum += consumption;
		}
	});

	// Get values from MIP section, defaulting to 0 if undefined or null
	const mip_used = flt(frm.doc.mip_used) || 0;
	const mip_generate = flt(frm.doc.mip_generate) || 0;
	const process_loss_weight = flt(frm.doc.process_loss_weight) || 0;

	// Get value from main section, defaulting to 0 if undefined or null
	const net_weight = flt(frm.doc.net_weight) || 0;

	// Calculate hopper_closing_qty using the new formula:
	// (hopper_add_or_used + SUM(raw material consumption) + mip_used) - (net_weight + mip_generate + process_loss_weight)
	const additions = hopper_add_or_used + raw_material_consumption_sum + mip_used;
	const subtractions = net_weight + mip_generate + process_loss_weight;
	const hopper_closing_qty = additions - subtractions;

	// CRITICAL: Update value without using set_value to avoid dirtying the form
	// This field is read-only and calculated, so we don't need to trigger dirty flag
	frm.doc.closing_qty = hopper_closing_qty;
	frm.refresh_field("closing_qty");
}

/**
 * Calculate MIP closing quantity.
 * Formula: closing_qty_mip = opening_qty_mip + mip_generate - mip_used
 *
 * @param {Object} frm - The form object
 */
function calculate_mip_closing_qty(frm) {
	// Skip calculation for submitted documents
	if (frm.doc.docstatus !== 0) {
		return;
	}

	// CRITICAL: Skip if we're in the middle of saving or just saved
	if (frm._is_saving || frm._just_saved) {
		console.log("🚫 calculate_mip_closing_qty BLOCKED - Save in progress");
		return;
	}

	console.log("⚙️ calculate_mip_closing_qty RUNNING");

	// Get values, defaulting to 0 if undefined or null
	const opening_qty = flt(frm.doc.opening_qty_mip) || 0;
	const mip_generate = flt(frm.doc.mip_generate) || 0;
	const mip_used = flt(frm.doc.mip_used) || 0;

	// Calculate closing_qty_mip: opening_qty + mip_generate - mip_used
	const closing_qty_mip = opening_qty + mip_generate - mip_used;

	// CRITICAL: Update value without using set_value to avoid dirtying the form
	// This field is read-only and calculated, so we don't need to trigger dirty flag
	frm.doc.closing_qty_mip = closing_qty_mip;
	frm.refresh_field("closing_qty_mip");
}

/**
 * Calculate net weight.
 * Formula: net_weight = gross_weight - weight_of_fabric_packing
 *
 * @param {Object} frm - The form object
 */
function calculate_net_weight(frm) {
	// Skip calculation for submitted documents
	if (frm.doc.docstatus !== 0) {
		return;
	}

	// CRITICAL: Skip if we're in the middle of saving or just saved
	if (frm._is_saving || frm._just_saved) {
		console.log("🚫 calculate_net_weight BLOCKED - Save in progress");
		return;
	}

	console.log("⚙️ calculate_net_weight RUNNING");

	// Get values, defaulting to 0 if undefined or null
	const gross_weight = flt(frm.doc.gross_weight) || 0;
	const weight_of_fabric_packing = flt(frm.doc.weight_of_fabric_packing) || 0;

	// Calculate net_weight: gross_weight - weight_of_fabric_packing
	const net_weight = gross_weight - weight_of_fabric_packing;

	// CRITICAL: Update value without using set_value to avoid dirtying the form
	// This field is read-only and calculated, so we don't need to trigger dirty flag
	frm.doc.net_weight = net_weight;
	frm.refresh_field("net_weight");
}

/**
 * Fill opening_opp_in_plant field for all items in material_consumption table
 * based on shift-based priority logic (previous closing_stock).
 *
 * This function:
 * 1. Collects all item_codes from material_consumption table
 * 2. Calls server-side API to get previous closing_stock for each item
 * 3. Sets opp_in_plant field for each row
 *
 * @param {Object} frm - The form object
 */
function fill_opening_stock_for_items(frm) {
	// Check if required fields are present
	if (!frm.doc.production_date || !frm.doc.shift_type) {
		// Cannot fetch opening stock without date and shift
		return;
	}

	// Get all item codes from material_consumption table
	const material_consumption = frm.doc.material_consumption || [];
	if (material_consumption.length === 0) {
		return;
	}

	// Collect unique item codes (only for BOM items, not main/scrap items, and not PRIME items)
	const item_codes = [];
	material_consumption.forEach(function (row) {
		if (row.item_code && row.item_type === "BOM Item" && !is_PRIME_item(row)) {
			item_codes.push(row.item_code);
		}
	});

	if (item_codes.length === 0) {
		return;
	}

	// Call server-side API to get opening stock for all items at once
	frappe.call({
		method: "hexplastics.api.production_log_book.get_opening_stock_for_items",
		args: {
			item_codes: item_codes,
			current_date: frm.doc.production_date,
			current_shift: frm.doc.shift_type,
			exclude_docname: frm.doc.name || null, // Exclude current document if it exists
		},
		callback: function (r) {
			if (r.message && typeof r.message === "object") {
				const opening_stock_map = r.message;

				// Update opp_in_plant for each row (exclude PRIME items - they don't use opening stock)
				material_consumption.forEach(function (row) {
					if (
						row.item_code &&
						row.item_type === "BOM Item" &&
						!is_PRIME_item(row) &&
						opening_stock_map[row.item_code] !== undefined
					) {
						// Only set if value exists in the map
						const opening_stock = flt(opening_stock_map[row.item_code]) || 0;

						// Use frappe.model.set_value to update the field
						frappe.model.set_value(
							row.doctype,
							row.name,
							"opp_in_plant",
							opening_stock
						);
					}
				});

				// Refresh the field to show updated values
				frm.refresh_field("material_consumption");
			}
		},
		error: function (r) {
			// Log error but don't break the form
			console.error("Error fetching opening stock:", r);
		},
	});
}

/**
 * Fill hopper opening quantity on the parent document using the same
 * shift-based priority logic as item-wise opening stock.
 *
 * This uses the previous document's hopper closing_qty as opening.
 *
 * @param {Object} frm - The form object
 */
function fill_hopper_opening_qty(frm) {
	// Require production_date and shift_type
	if (!frm.doc.production_date || !frm.doc.shift_type) {
		return;
	}

	// Call server-side API to get previous hopper closing quantity
	frappe.call({
		method: "hexplastics.api.production_log_book.get_previous_hopper_opening_qty",
		args: {
			current_date: frm.doc.production_date,
			current_shift: frm.doc.shift_type,
			exclude_docname: frm.doc.name || null, // Exclude current document if it exists
		},
		callback: function (r) {
			if (r.message === undefined || r.message === null) {
				return;
			}

			const opening_qty = flt(r.message) || 0;

			// Support both possible fieldnames for hopper opening qty
			const hopper_fields = [
				"hopper_opening_qty", // if a dedicated field exists
				"opening_qty_in_hopper_and_tray", // current fieldname in DocType
			];

			hopper_fields.forEach(function (fieldname) {
				if (frm.fields_dict[fieldname]) {
					const current_value = flt(frm.doc[fieldname]) || 0;

					// Only auto-fill when the field is empty/zero to avoid
					// overwriting user edits after initial fill.
					if (!current_value) {
						frm.set_value(fieldname, opening_qty);
					}
				}
			});
		},
		error: function (r) {
			// Log error but don't break the form
			console.error("Error fetching hopper opening qty:", r);
		},
	});
}

/**
 * Fill MIP opening quantity on the parent document using the same
 * shift-based priority logic as hopper and item-wise opening stock.
 *
 * This uses the previous document's closing_qty_mip as opening.
 *
 * @param {Object} frm - The form object
 */
function fill_mip_opening_qty(frm) {
	// Require production_date and shift_type
	if (!frm.doc.production_date || !frm.doc.shift_type) {
		return;
	}

	frappe.call({
		method: "hexplastics.api.production_log_book.get_previous_mip_opening_qty",
		args: {
			current_date: frm.doc.production_date,
			current_shift: frm.doc.shift_type,
			exclude_docname: frm.doc.name || null,
		},
		callback: function (r) {
			if (r.message === undefined || r.message === null) {
				return;
			}

			const opening_qty = flt(r.message) || 0;

			// Support both possible fieldnames for MIP opening qty
			const mip_fields = ["mip_opening_qty", "opening_qty_mip"];

			mip_fields.forEach(function (fieldname) {
				if (frm.fields_dict[fieldname]) {
					const current_value = flt(frm.doc[fieldname]) || 0;
					// Only auto-fill when empty/zero so user edits are preserved
					if (!current_value) {
						frm.set_value(fieldname, opening_qty);
					}
				}
			});
		},
		error: function (r) {
			console.error("Error fetching MIP opening qty:", r);
		},
	});
}

/**
 * Make closing quantity fields read-only dynamically.
 * This ensures the fields remain read-only even after form refresh or field updates.
 *
 * @param {Object} frm - The form object
 */
function make_closing_qty_fields_readonly(frm) {
	// Make hopper closing_qty read-only
	if (frm.fields_dict.closing_qty) {
		frm.set_df_property("closing_qty", "read_only", 1);
	}

	// Make MIP closing_qty_mip read-only
	if (frm.fields_dict.closing_qty_mip) {
		frm.set_df_property("closing_qty_mip", "read_only", 1);
	}
}

/**
 * Make net_weight field read-only dynamically.
 * This ensures the field remains read-only even after form refresh or field updates.
 *
 * @param {Object} frm - The form object
 */
function make_net_weight_readonly(frm) {
	// Make net_weight read-only
	if (frm.fields_dict.net_weight) {
		frm.set_df_property("net_weight", "read_only", 1);
	}
}

/**
 * Update stock_entry_no field in UI after document submission (direct call version).
 * This function updates the field without making the document dirty.
 *
 * @param {Object} frm - The form object
 */
function update_stock_entry_no_after_submit_direct(frm) {
	// Safety guard: only run if document is actually submitted
	if (frm.doc.docstatus !== 1) {
		return;
	}

	// Safety guard: only update if stock_entry_no field exists
	if (!frm.fields_dict.stock_entry_no) {
		return;
	}

	// Call the whitelisted function to retrieve stock_entry_no from backend
	frappe.call({
		method: "hexplastics.api.production_log_book.get_stock_entry_no",
		args: {
			docname: frm.doc.name,
		},
		callback: function (r) {
			// Safety guard: ensure document is still submitted
			if (frm.doc.docstatus !== 1) {
				return;
			}

			// Safety guard: ensure field still exists
			if (!frm.fields_dict.stock_entry_no) {
				return;
			}

			// Update UI safely without using frm.set_value()
			// This prevents the document from becoming dirty
			if (r.message) {
				// Update the document object in locals (source of truth)
				if (locals["Production Log Book"] && locals["Production Log Book"][frm.doc.name]) {
					locals["Production Log Book"][frm.doc.name].stock_entry_no = r.message;
				}
				// Update frm.doc as well
				frm.doc.stock_entry_no = r.message;
				// Update the field value directly
				frm.fields_dict.stock_entry_no.value = r.message;
				// Refresh the field to ensure UI updates
				frm.refresh_field("stock_entry_no");
			}
		},
		error: function (r) {
			// Log error but don't break the form
			console.error("Error fetching stock_entry_no:", r);
		},
	});
}

/**
 * Update stock_entry_no field in UI after document submission.
 * This function updates the field without making the document dirty.
 *
 * @param {Object} frm - The form object
 */
function update_stock_entry_no_after_submit(frm) {
	// Safety guard: only run if document is actually submitted
	if (frm.doc.docstatus !== 1) {
		return;
	}

	// Safety guard: only update if stock_entry_no field exists
	if (!frm.fields_dict.stock_entry_no) {
		return;
	}

	// Call the whitelisted function to retrieve stock_entry_no from backend
	frappe.call({
		method: "hexplastics.api.production_log_book.get_stock_entry_no",
		args: {
			docname: frm.doc.name,
		},
		callback: function (r) {
			// Safety guard: ensure document is still submitted
			if (frm.doc.docstatus !== 1) {
				return;
			}

			// Safety guard: ensure field still exists
			if (!frm.fields_dict.stock_entry_no) {
				return;
			}

			// Update UI safely without using frm.set_value()
			// This prevents the document from becoming dirty
			if (r.message) {
				// Update the document object in locals (source of truth)
				if (locals["Production Log Book"] && locals["Production Log Book"][frm.doc.name]) {
					locals["Production Log Book"][frm.doc.name].stock_entry_no = r.message;
				}
				// Update frm.doc as well
				frm.doc.stock_entry_no = r.message;
				// Update the field value directly
				frm.fields_dict.stock_entry_no.value = r.message;
				// Refresh the field to ensure UI updates
				frm.refresh_field("stock_entry_no");
			}
		},
		error: function (r) {
			// Log error but don't break the form
			console.error("Error fetching stock_entry_no:", r);
		},
	});
}
