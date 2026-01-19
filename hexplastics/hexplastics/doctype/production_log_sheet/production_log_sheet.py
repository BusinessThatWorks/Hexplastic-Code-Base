# Copyright (c) 2026, beetashoke chakraborty and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class ProductionLogSheet(Document):
    """Custom logic for Production Log Sheet."""

    def on_submit(self):
        """Create and submit Manufacture Stock Entry on submit.

        Rules:
        - Only create if docstatus == 1 and no stock entry already linked.
        - Map header and item details from this document.
        - Validate required data and prevent submit on errors.
        """
        # Avoid circular imports
        from erpnext.stock.doctype.stock_entry.stock_entry import StockEntry

        # Do not recreate Stock Entry if one already exists
        # Check if a Stock Entry already exists linked to this Production Log Sheet
        existing_stock_entry = frappe.db.exists(
            "Stock Entry", {"production_log_sheet": self.name, "docstatus": ["!=", 2]}
        )
        if existing_stock_entry:
            return

        # Basic validations
        if not self.production_date or not self.production_time:
            frappe.throw(
                "Production Date and Production Time are required to create Stock Entry."
            )

        if not self.raw_material_consumption:
            frappe.throw(
                "Raw Material Consumption table is empty. Cannot create Stock Entry."
            )

        # Validate at least one non-zero quantity in consumption
        if not any(
            d.consumption and d.consumption > 0 for d in self.raw_material_consumption
        ):
            frappe.throw(
                "No raw material consumption quantity found. Cannot create Stock Entry."
            )

        # Validate finished goods: either production_details has items OR main manufacturing_item has quantity
        has_production_details = self.production_details and any(
            d.manufactured_qty and d.manufactured_qty > 0
            for d in self.production_details
        )
        has_main_manufacturing_item = (
            self.manufacturing_item
            and self.manufactured_qty
            and self.manufactured_qty > 0
        )

        if not has_production_details and not has_main_manufacturing_item:
            frappe.throw(
                "No finished goods found. Either Production Details table must have items with quantities, "
                "or Manufacturing Item with Manufactured Qty must be set. Cannot create Stock Entry."
            )

        try:
            stock_entry = frappe.new_doc("Stock Entry")
            stock_entry.stock_entry_type = "Manufacture"

            # Header mapping: ensure Stock Entry uses Production Log Sheet date/time
            stock_entry.posting_date = self.production_date
            stock_entry.posting_time = self.production_time
            # In ERPNext, posting_time is only honored if this flag is set
            if hasattr(stock_entry, "set_posting_time"):
                stock_entry.set_posting_time = 1

            # Custom fields on Stock Entry (if present in your instance)
            for fieldname, value in [
                ("shift_type", getattr(self, "shift_type", None)),
                ("machine_used", getattr(self, "machine_used", None)),
                ("operator", getattr(self, "operator_id", None)),
                ("supervisor", getattr(self, "supervisor_id", None)),
            ]:
                if hasattr(stock_entry, fieldname) and value:
                    stock_entry.set(fieldname, value)

            # Map raw material consumption rows (Source / Consumption)
            for row in self.raw_material_consumption:
                if not row.item_code:
                    continue

                if not row.source_warehouse:
                    frappe.throw(
                        f"Source Warehouse is required for raw material row with item {row.item_code}."
                    )

                if not row.consumption or row.consumption <= 0:
                    continue

                stock_entry.append(
                    "items",
                    {
                        "s_warehouse": row.source_warehouse,
                        "t_warehouse": None,
                        "item_code": row.item_code,
                        "qty": row.consumption,
                        "uom": row.stock_uom,
                        "stock_uom": row.stock_uom,
                        "conversion_factor": 1,
                        "basic_rate": 0,
                    },
                )

            # Track items already added from production_details to avoid duplicates
            added_finished_items = set()

            # Map finished goods / scrap rows from production_details table (Target)
            if self.production_details:
                for row in self.production_details:
                    if not row.item_code:
                        continue

                    if not row.target_warehouse:
                        frappe.throw(
                            f"Target Warehouse is required for finished / scrap row with item {row.item_code}."
                        )

                    if not row.manufactured_qty or row.manufactured_qty <= 0:
                        continue

                    # Get UOM for the item
                    item_uom = row.stock_uom
                    if not item_uom:
                        # Fetch UOM from Item master if not available
                        item_uom = frappe.db.get_value(
                            "Item", row.item_code, "stock_uom"
                        )
                        if not item_uom:
                            frappe.throw(
                                f"Stock UOM not found for item {row.item_code}."
                            )

                    stock_entry.append(
                        "items",
                        {
                            "s_warehouse": None,
                            "t_warehouse": row.target_warehouse,
                            "item_code": row.item_code,
                            "qty": row.manufactured_qty,
                            "uom": item_uom,
                            "stock_uom": item_uom,
                            "conversion_factor": 1,
                            "basic_rate": 0,
                            "is_finished_item": 1,
                        },
                    )
                    added_finished_items.add(row.item_code)

            # Also include main manufacturing_item if it exists and has quantity
            # (in case it's not already in production_details table)
            if (
                self.manufacturing_item
                and self.manufactured_qty
                and self.manufactured_qty > 0
            ):
                if self.manufacturing_item not in added_finished_items:
                    # Get default warehouse for finished goods
                    # Try to get from first production_details row, or use default
                    default_fg_warehouse = None
                    if self.production_details:
                        first_row = self.production_details[0]
                        if first_row.target_warehouse:
                            default_fg_warehouse = first_row.target_warehouse

                    if not default_fg_warehouse:
                        # Try to get from Item's default warehouse or use a standard default
                        default_fg_warehouse = (
                            frappe.db.get_value(
                                "Item", self.manufacturing_item, "default_warehouse"
                            )
                            or "Finished Good - Hex"
                        )

                    # Get UOM for manufacturing item
                    item_uom = frappe.db.get_value(
                        "Item", self.manufacturing_item, "stock_uom"
                    )
                    if not item_uom:
                        frappe.throw(
                            f"Stock UOM not found for manufacturing item {self.manufacturing_item}."
                        )

                    stock_entry.append(
                        "items",
                        {
                            "s_warehouse": None,
                            "t_warehouse": default_fg_warehouse,
                            "item_code": self.manufacturing_item,
                            "qty": self.manufactured_qty,
                            "uom": item_uom,
                            "stock_uom": item_uom,
                            "conversion_factor": 1,
                            "basic_rate": 0,
                            "is_finished_item": 1,
                        },
                    )

            if not stock_entry.items:
                frappe.throw(
                    "No valid Stock Entry rows were generated from this Production Log Sheet."
                )

            # Link back to source document for traceability
            stock_entry.production_log_sheet = self.name

            # Save and submit
            stock_entry.insert(ignore_permissions=True)
            stock_entry.submit()

        except Exception as e:
            # Prevent submit and show clear error
            frappe.throw(
                f"Failed to create Manufacture Stock Entry for Production Log Sheet: {frappe.utils.cstr(e)}"
            )
