# Copyright (c) 2026, beetashoke chakraborty and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt


class ProductionLogSheet(Document):
    """Custom logic for Production Log Sheet."""

    def validate(self):
        """Round calculated fields to their defined precision before save/submit.

        This prevents floating-point precision drift that causes "Cannot Update After Submit" errors.
        All fields with precision 4 are rounded to 4 decimal places.
        """
        # Round total_rm_consumption to 4 decimal places (precision: 4)
        if self.get("total_rm_consumption") is not None:
            self.total_rm_consumption = round(flt(self.total_rm_consumption), 4)

        # Round closing_qty_for_mip to 4 decimal places (precision: 4)
        if self.get("closing_qty_for_mip") is not None:
            self.closing_qty_for_mip = round(flt(self.closing_qty_for_mip), 4)

        # Round net_weight to 4 decimal places (precision: 4)
        if self.get("net_weight") is not None:
            self.net_weight = round(flt(self.net_weight), 4)

        # Round closing_stock in raw_material_consumption child table rows (precision: 4)
        if self.get("raw_material_consumption"):
            for row in self.raw_material_consumption:
                if row.get("closing_stock") is not None:
                    row.closing_stock = round(flt(row.closing_stock), 4)

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

        # Validate finished goods: production_details table must have items with quantities
        has_production_details = self.production_details and any(
            d.manufactured_qty and d.manufactured_qty > 0
            for d in self.production_details
        )

        if not has_production_details:
            frappe.throw(
                "Production Details table must have items with quantities. Cannot create Stock Entry."
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

            # Custom fields on Stock Entry: Map from Production Log Sheet
            # Map: Shift Type, Machine Used (fetch from Machine Master), Operator Name, Supervisor Name

            # Get machine name from Machine Master if machine_used is set
            # Transform to match Stock Entry Select field options (e.g., "Machine 1" → "Machine No 1")
            machine_name_for_stock_entry = None
            if self.machine_used:
                machine_name = frappe.db.get_value(
                    "Machine Master", self.machine_used, "machine_name"
                )
                if machine_name:
                    # Valid options for Stock Entry custom_machine_used Select field
                    valid_options = [
                        "Machine No 1",
                        "Machine No 2",
                        "Machine No 3",
                        "Machine No 4",
                    ]

                    if machine_name in valid_options:
                        # Already in correct format
                        machine_name_for_stock_entry = machine_name
                    else:
                        # Transform "Machine 1" → "Machine No 1", "Machine 2" → "Machine No 2", etc.
                        import re

                        match = re.match(
                            r"Machine\s*(\d+)", machine_name, re.IGNORECASE
                        )
                        if match:
                            transformed = f"Machine No {match.group(1)}"
                            if transformed in valid_options:
                                machine_name_for_stock_entry = transformed

            # Map fields to Stock Entry
            for fieldname, value in [
                ("custom_shift_type", getattr(self, "shift_type", None)),
                ("custom_machine_used", machine_name_for_stock_entry),
                ("custom_operator_name", getattr(self, "operator_name", None)),
                ("custom_supervisor_name", getattr(self, "supervisor_name", None)),
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
                        "is_finished_item": 0,  # Raw materials are never finished items
                    },
                )

            # Map finished goods / scrap rows from production_details table (Target)
            # At least one item must be marked as is_finished_item = 1 (ERPNext validation requirement)
            # Prefer marking manufacturing_item if it exists in production_details, otherwise mark first item
            finished_item_marked = False
            if self.production_details:
                # First pass: mark manufacturing_item as finished if it exists
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

                    # Mark as finished item if:
                    # 1. It's the manufacturing_item, OR
                    # 2. No finished item has been marked yet (mark first valid item)
                    is_main_item = row.item_code == self.manufacturing_item
                    should_mark_finished = is_main_item or not finished_item_marked

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
                            "is_finished_item": 1 if should_mark_finished else 0,
                        },
                    )

                    if should_mark_finished:
                        finished_item_marked = True

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

            # Populate stock_entry_no field after successful Stock Entry creation and submission
            # Use db_set to update the field without changing the document's submitted status
            self.db_set("stock_entry_no", stock_entry.name, update_modified=False)

        except Exception as e:
            # Prevent submit and show clear error
            # Do NOT populate stock_entry_no if Stock Entry creation fails
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
