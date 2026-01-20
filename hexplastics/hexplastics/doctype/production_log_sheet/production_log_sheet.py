# Copyright (c) 2026, beetashoke chakraborty and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt


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
                            "is_finished_item": 1,
                        },
                    )

            if not stock_entry.items:
                frappe.throw(
                    "No valid Stock Entry rows were generated from this Production Log Sheet."
                )

            # Link back to source document for traceability
            stock_entry.production_log_sheet = self.name

            # Insert the Stock Entry
            stock_entry.insert(ignore_permissions=True)

            # Calculate rates for all items - this will set basic_rate from warehouse valuation
            # For source items (raw materials), it gets the valuation rate from the warehouse
            # For finished goods, it calculates from source items
            stock_entry.calculate_rate_and_amount()

            # Manually calculate rates for finished goods if they're still 0
            # ERPNext's calculate_rate_and_amount() may not always set finished good rates properly
            _calculate_finished_item_rates(stock_entry)

            # Save after rate calculation
            stock_entry.save(ignore_permissions=True)

            # Submit the Stock Entry
            stock_entry.submit()

        except Exception as e:
            # Prevent submit and show clear error
            frappe.throw(
                f"Failed to create Manufacture Stock Entry for Production Log Sheet: {frappe.utils.cstr(e)}"
            )


def _calculate_finished_item_rates(stock_entry) -> None:
    """Calculate basic_rate for finished goods based on ERPNext standard logic.

    Priority:
    1. Get valuation rate from target warehouse (Stock Ledger Entry)
    2. Use ERPNext's get_incoming_rate (considers company settings)
    3. Calculate from source items (raw materials) cost

    This ensures finished goods get correct valuation rates per company settings.
    """
    finished_items = [item for item in stock_entry.items if item.is_finished_item]

    if not finished_items:
        return

    # Get all source items (raw materials) to calculate total cost
    source_items = [
        item
        for item in stock_entry.items
        if item.s_warehouse
        and not item.is_finished_item
        and not getattr(item, "is_scrap_item", 0)
    ]

    # Calculate total cost from source items
    total_source_cost = sum(
        flt(item.basic_rate) * flt(item.qty)
        for item in source_items
        if flt(item.basic_rate) > 0
    )

    # Get total finished goods quantity to calculate rate per unit
    total_finished_qty = sum(flt(item.qty) for item in finished_items)

    for finished_item in finished_items:
        if flt(finished_item.basic_rate) == 0:
            # Method 1: Try to get valuation rate from the target warehouse (Stock Ledger Entry)
            if finished_item.t_warehouse:
                try:
                    sle = frappe.get_all(
                        "Stock Ledger Entry",
                        filters={
                            "item_code": finished_item.item_code,
                            "warehouse": finished_item.t_warehouse,
                            "valuation_rate": [">", 0],
                        },
                        fields=["valuation_rate"],
                        order_by="posting_date desc, posting_time desc, creation desc",
                        limit_page_length=1,
                    )

                    if sle and sle[0].get("valuation_rate"):
                        finished_item.basic_rate = flt(sle[0].valuation_rate)
                        finished_item.amount = flt(finished_item.basic_rate) * flt(
                            finished_item.qty
                        )
                        continue
                except Exception:
                    pass

            # Method 2: Use ERPNext's get_incoming_rate (respects company valuation settings)
            if finished_item.t_warehouse:
                try:
                    from erpnext.stock.utils import get_incoming_rate

                    company = stock_entry.company or frappe.defaults.get_user_default(
                        "Company"
                    )
                    incoming_rate = get_incoming_rate(
                        {
                            "item_code": finished_item.item_code,
                            "warehouse": finished_item.t_warehouse,
                            "posting_date": stock_entry.posting_date,
                            "posting_time": stock_entry.posting_time,
                            "qty": finished_item.qty,
                            "serial_no": None,
                            "batch_no": None,
                            "voucher_type": "Stock Entry",
                            "voucher_no": stock_entry.name,
                            "company": company,
                        }
                    )

                    if flt(incoming_rate) > 0:
                        finished_item.basic_rate = flt(incoming_rate)
                        finished_item.amount = flt(finished_item.basic_rate) * flt(
                            finished_item.qty
                        )
                        continue
                except Exception:
                    pass

            # Method 3: Calculate from source items (raw materials) cost
            # Finished goods get rate based on source items cost
            if total_source_cost > 0 and total_finished_qty > 0:
                # Calculate rate per finished unit
                cost_per_finished_unit = total_source_cost / total_finished_qty
                finished_item.basic_rate = cost_per_finished_unit
            elif total_source_cost > 0 and source_items:
                # Fallback: use average rate from source items
                total_source_qty = sum(flt(item.qty) for item in source_items)
                if total_source_qty > 0:
                    avg_source_rate = total_source_cost / total_source_qty
                    finished_item.basic_rate = avg_source_rate

            # Recalculate amount
            if flt(finished_item.basic_rate) > 0:
                finished_item.amount = flt(finished_item.basic_rate) * flt(
                    finished_item.qty
                )
