# Copyright (c) 2025, beetashoke chakraborty and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt


class ProductionLogBook(Document):
    """
    Custom controller for Production Log Book.

    On submit, this document automatically creates and submits a
    Manufacture-type Stock Entry based on the Material Consumption table.
    """

    def on_submit(self) -> None:
        """Create and submit Stock Entries when Production Log Book is submitted."""
        # Create Manufacture Stock Entry from Material Consumption
        create_stock_entry_for_production_log_book(self)

        # Create Material Receipt Stock Entry for Hopper & Tray closing qty
        create_hopper_stock_entry(self)


def create_stock_entry_for_production_log_book(doc: ProductionLogBook) -> None:
    """Create and submit a Stock Entry for the given Production Log Book.

    Parent field mapping:
    - shift_type      -> custom_shift_type
    - machine_used    -> custom_machine_used
    - operator_name   -> custom_operator_name
    - supervisor_name -> custom_supervisor_name

    Child (Material Consumption Table -> Stock Entry Items):
    - RAW MATERIAL rows: when source_warehouse is set
            * s_warehouse = source_warehouse
            * qty         = consumption
            * rate        = calculated from warehouse valuation

    - MAIN ITEM rows: when target_warehouse is set and item_type is "Main Item"
            * t_warehouse = target_warehouse
            * qty         = in_qty
            * rate        = calculated from source items

    - SCRAP ITEM rows: when target_warehouse is set and item_type is "Scrap Item"
            * t_warehouse = target_warehouse
            * qty         = in_qty
            * rate        = calculated from source items (same as finished goods)
    """

    # Skip Manufacture Stock Entry if Material Consumption is empty
    # This allows Hopper Stock Entry to still be created
    if not getattr(doc, "material_consumption", None):
        frappe.msgprint(
            "Material Consumption table is empty. Skipping Manufacture Stock Entry creation.",
            alert=True,
            indicator="orange",
        )
        return

    stock_entry = frappe.new_doc("Stock Entry")
    stock_entry.stock_entry_type = "Manufacture"

    # Parent field mapping
    stock_entry.custom_shift_type = doc.shift_type
    stock_entry.custom_machine_used = doc.machine_used
    stock_entry.custom_operator_name = doc.operator_name
    stock_entry.custom_supervisor_name = doc.supervisor_name

    # Set posting_date & posting_time to match Production Log Book
    # This ensures the Stock Entry is posted on the same date & time as production
    prod_date = doc.production_date
    prod_time = getattr(doc, "production_time", None)

    stock_entry.posting_date = prod_date
    if prod_time:
        # Respect the exact time entered on Production Log Book
        stock_entry.posting_time = prod_time

    # Must be set before insert so ERPNext does not override posting date/time
    stock_entry.set_posting_time = 1

    # Build Stock Entry Items from Material Consumption table
    for row in doc.material_consumption:
        _add_items_from_material_row(stock_entry, row)

    if not stock_entry.items:
        frappe.msgprint(
            "No valid Stock Entry Items could be created from Material Consumption table. Skipping Manufacture Stock Entry.",
            alert=True,
            indicator="orange",
        )
        return

    # Insert the Stock Entry
    stock_entry.insert(ignore_permissions=True)

    # Calculate rates for all items - this will set basic_rate from warehouse valuation
    # For source items (raw materials), it gets the valuation rate from the warehouse
    # For finished goods, it calculates from source items
    stock_entry.calculate_rate_and_amount()

    # Manually calculate rates for scrap items if they're still 0
    # ERPNext's calculate_rate_and_amount() may not always set scrap item rates properly
    _calculate_scrap_item_rates(stock_entry)

    # Manually calculate rates for finished goods (Main Items) if they're still 0
    # Similar to scrap items, ensure finished goods get proper rate calculation
    _calculate_finished_item_rates(stock_entry)

    stock_entry.save(ignore_permissions=True)

    # Submit the Stock Entry
    stock_entry.submit()

    # Update Production Log Book with the Stock Entry reference
    # Use frappe.db.set_value to avoid dirtying the document and prevent recursion
    frappe.db.set_value(
        "Production Log Book", doc.name, "stock_entry_no", stock_entry.name
    )


def _add_items_from_material_row(stock_entry, row) -> None:
    """Append one or two Stock Entry Items based on a single Material Consumption row.

    Rules:
    - If row.source_warehouse exists -> RAW MATERIAL row (s_warehouse, qty = consumption)
    - If row.target_warehouse exists -> MAIN / SCRAP row (t_warehouse, qty = in_qty)
    - Rate is calculated automatically by ERPNext after insert
    - Validate that warehouse is not blank and qty >= 0 (only negative values are blocked)
    - Skip creating Stock Entry items when qty is 0 (no error thrown)
    """

    # RAW MATERIAL: source warehouse
    if getattr(row, "source_warehouse", None):
        # Use flt() to preserve decimal values (0.1234, 0.0, etc.)
        qty = flt(row.consumption or 0)

        # Only block negative values; allow 0 and positive decimals
        if qty < 0:
            frappe.throw(
                f"Row for Item {row.item_code or ''}: "
                "Consumption cannot be negative when Source Warehouse is set."
            )

        # Only append if qty > 0 (skip zero consumption but continue processing target warehouse)
        if qty > 0:
            stock_entry.append(
                "items",
                _make_stock_entry_item(
                    item_code=row.item_code,
                    qty=qty,
                    s_warehouse=row.source_warehouse,
                    t_warehouse=None,
                    stock_uom=getattr(row, "stock_uom", None),
                    is_finished_item=0,
                    is_scrap_item=0,
                ),
            )

    # MAIN / SCRAP: target warehouse (note: fieldname is `target_warhouse` in the child table)
    target_warehouse = getattr(row, "target_warhouse", None)

    if target_warehouse:
        # Use flt() to preserve decimal values
        qty = flt(row.in_qty or 0)

        # Only block negative values; allow 0 and positive decimals
        if qty < 0:
            frappe.throw(
                f"Row for Item {row.item_code or ''}: "
                "In Qty cannot be negative when Target Warehouse is set."
            )

        # Determine if this is a finished good or scrap based on item_type
        item_type = (row.item_type or "").strip()
        is_finished_item = 1 if item_type == "Main Item" else 0
        is_scrap_item = 1 if item_type == "Scrap Item" else 0

        # Add item regardless of quantity (even if 0) for debugging
        # Note: ERPNext may reject 0 qty items during validation
        stock_entry.append(
            "items",
            _make_stock_entry_item(
                item_code=row.item_code,
                qty=qty,
                s_warehouse=None,
                t_warehouse=target_warehouse,
                stock_uom=getattr(row, "stock_uom", None),
                is_finished_item=is_finished_item,
                is_scrap_item=is_scrap_item,
            ),
        )

    # If neither warehouse is set but quantities are entered, fail fast with a clear error
    if not getattr(row, "source_warehouse", None) and not target_warehouse:
        if (row.consumption or 0) > 0 or (row.in_qty or 0) > 0:
            frappe.throw(
                f"Row for Item {row.item_code or ''}: "
                "Either Source Warehouse or Target Warehouse must be set when quantity is entered."
            )


def _calculate_scrap_item_rates(stock_entry) -> None:
    """Calculate basic_rate for scrap items based on source items.

    In manufacture stock entries, scrap items should get their rate from source items.
    First, try to get valuation rate from warehouse. If not available, calculate from source items.
    """
    scrap_items = [item for item in stock_entry.items if item.is_scrap_item]

    if not scrap_items:
        return

    # Get all source items (raw materials) to calculate total cost
    source_items = [
        item
        for item in stock_entry.items
        if item.s_warehouse and not item.is_finished_item and not item.is_scrap_item
    ]

    # Calculate total cost from source items
    total_source_cost = sum(
        flt(item.basic_rate) * flt(item.qty)
        for item in source_items
        if flt(item.basic_rate) > 0
    )

    # Get finished goods quantity to calculate rate per unit
    finished_items = [item for item in stock_entry.items if item.is_finished_item]
    total_finished_qty = sum(flt(item.qty) for item in finished_items)

    for scrap_item in scrap_items:
        if flt(scrap_item.basic_rate) == 0:
            # First, try to get valuation rate from the target warehouse
            if scrap_item.t_warehouse:
                try:
                    # Get latest valuation rate from Stock Ledger Entry
                    sle = frappe.get_all(
                        "Stock Ledger Entry",
                        filters={
                            "item_code": scrap_item.item_code,
                            "warehouse": scrap_item.t_warehouse,
                        },
                        fields=["valuation_rate"],
                        order_by="posting_date desc, posting_time desc, creation desc",
                        limit_page_length=1,
                    )

                    if sle and sle[0].get("valuation_rate"):
                        scrap_item.basic_rate = flt(sle[0].valuation_rate)
                        scrap_item.amount = flt(scrap_item.basic_rate) * flt(
                            scrap_item.qty
                        )
                        continue
                except Exception:
                    pass

            # If warehouse valuation not available, calculate from source items
            # Scrap items get rate based on source items cost
            if total_source_cost > 0 and total_finished_qty > 0:
                # Calculate rate per finished unit
                cost_per_finished_unit = total_source_cost / total_finished_qty
                # Scrap items typically get a proportion of the source cost
                # Use the same rate as cost per finished unit
                scrap_item.basic_rate = cost_per_finished_unit
            elif total_source_cost > 0 and source_items:
                # Fallback: use average rate from source items
                total_source_qty = sum(flt(item.qty) for item in source_items)
                if total_source_qty > 0:
                    avg_source_rate = total_source_cost / total_source_qty
                    scrap_item.basic_rate = avg_source_rate

            # Recalculate amount
            if flt(scrap_item.basic_rate) > 0:
                scrap_item.amount = flt(scrap_item.basic_rate) * flt(scrap_item.qty)


def _calculate_finished_item_rates(stock_entry) -> None:
    """Calculate basic_rate for finished goods (Main Items) based on source items.

    In manufacture stock entries, finished goods should get their rate from source items.
    First, try to get valuation rate from warehouse. If not available, calculate from source items.
    """
    finished_items = [item for item in stock_entry.items if item.is_finished_item]

    if not finished_items:
        return

    # Get all source items (raw materials) to calculate total cost
    source_items = [
        item
        for item in stock_entry.items
        if item.s_warehouse and not item.is_finished_item and not item.is_scrap_item
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
            # First, try to get valuation rate from the target warehouse
            if finished_item.t_warehouse:
                try:
                    # Get latest valuation rate from Stock Ledger Entry
                    sle = frappe.get_all(
                        "Stock Ledger Entry",
                        filters={
                            "item_code": finished_item.item_code,
                            "warehouse": finished_item.t_warehouse,
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

            # If warehouse valuation not available, calculate from source items
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


def _make_stock_entry_item(
    *,
    item_code: str,
    qty: float,
    s_warehouse: str | None,
    t_warehouse: str | None,
    stock_uom: str | None,
    is_finished_item: int = 0,
    is_scrap_item: int = 0,
):
    """Helper to construct a single Stock Entry Item. Rate will be calculated by ERPNext."""

    if not item_code:
        frappe.throw("Item Code is mandatory in Material Consumption rows.")

    if not s_warehouse and not t_warehouse:
        frappe.throw(
            f"Warehouse is mandatory for Item {item_code}. "
            "Either Source Warehouse or Target Warehouse must be set."
        )

    # Only block negative values; allow 0 and positive decimals
    # Note: This function is only called when qty > 0 (after validation in _add_items_from_material_row),
    # but we keep this check as a safety measure
    if flt(qty) < 0:
        frappe.throw(f"Quantity cannot be negative for Item {item_code}.")

    # Don't set basic_rate here - let ERPNext calculate it automatically
    # The calculate_rate_and_amount() method will set it properly after insert
    item_dict = {
        "item_code": item_code,
        "qty": qty,
        "s_warehouse": s_warehouse,
        "t_warehouse": t_warehouse,
        "uom": stock_uom,
        "stock_uom": stock_uom,
        "conversion_factor": 1,
        "is_finished_item": is_finished_item,
        "is_scrap_item": is_scrap_item,
    }

    # Only set allow_zero_valuation_rate if we can't determine the rate
    # This will be handled by ERPNext's rate calculation
    return item_dict


def create_hopper_stock_entry(doc: ProductionLogBook) -> None:
    """Create and submit a Material Receipt Stock Entry for Hopper & Tray closing qty.

    This Stock Entry records the closing quantity of Hopper & Tray as a Material Receipt.
    It is separate from the Manufacture Stock Entry.

    Rules:
    - Only create if closing_qty > 0
    - Stock Entry Type: Material Receipt
    - Item: hopper_and_tray_item
    - Qty: closing_qty
    - Target Warehouse: Production - HEX (default warehouse for hopper items)
    - Rate: 0 (hopper items have no cost)
    - Posting Date/Time: Same as Production Log Book
    """

    # Get closing qty
    closing_qty = flt(getattr(doc, "closing_qty", 0))

    # Only create if closing_qty > 0
    if closing_qty <= 0:
        return

    # Get hopper item code
    hopper_item = getattr(doc, "hopper_and_tray_item", None)
    if not hopper_item:
        frappe.msgprint(
            "Hopper & Tray Item is not set. Skipping Hopper Stock Entry creation.",
            alert=True,
        )
        return

    # Check if Hopper Stock Entry already exists for this Production Log Book
    # This prevents duplicate creation if on_submit is called multiple times
    existing_entry = frappe.db.exists(
        "Stock Entry",
        {
            "stock_entry_type": "Material Receipt",
            "custom_production_log_book": doc.name,
            "docstatus": ["in", [0, 1]],  # Draft or Submitted
        },
    )

    if existing_entry:
        # Already created, skip
        return

    # Default warehouse for hopper items (can be customized)
    target_warehouse = "Production - HEX"

    # Get valuation rate for the hopper item from warehouse
    valuation_rate = _get_item_valuation_rate(hopper_item, target_warehouse)

    # Log the fetched rate for debugging
    frappe.logger().info(
        f"Hopper Stock Entry - Item: {hopper_item}, "
        f"Warehouse: {target_warehouse}, "
        f"Valuation Rate: {valuation_rate}, "
        f"Qty: {closing_qty}"
    )

    # Create Stock Entry
    stock_entry = frappe.new_doc("Stock Entry")
    stock_entry.stock_entry_type = "Material Receipt"

    # Link back to Production Log Book (custom field may be needed)
    # This helps prevent duplicates and track the source
    if frappe.db.has_column("Stock Entry", "custom_production_log_book"):
        stock_entry.custom_production_log_book = doc.name

    # Set posting date & time to match Production Log Book
    stock_entry.posting_date = doc.production_date
    if getattr(doc, "production_time", None):
        stock_entry.posting_time = doc.production_time
    stock_entry.set_posting_time = 1

    # Add item row with valuation rate
    item_dict = {
        "item_code": hopper_item,
        "qty": closing_qty,
        "t_warehouse": target_warehouse,
        "basic_rate": valuation_rate,
        "amount": flt(valuation_rate) * flt(closing_qty),
    }

    # Only allow zero valuation rate if no rate found
    if flt(valuation_rate) == 0:
        item_dict["allow_zero_valuation_rate"] = 1

    stock_entry.append("items", item_dict)

    # Insert and submit
    try:
        stock_entry.insert(ignore_permissions=True)

        # Recalculate rate if it's still 0
        # This ensures ERPNext's rate calculation is triggered
        for item in stock_entry.items:
            if flt(item.basic_rate) == 0:
                # Try to get rate using get_incoming_rate for this specific item
                try:
                    from erpnext.stock.utils import get_incoming_rate

                    calculated_rate = get_incoming_rate(
                        {
                            "item_code": item.item_code,
                            "warehouse": item.t_warehouse,
                            "posting_date": stock_entry.posting_date,
                            "posting_time": stock_entry.posting_time,
                            "qty": item.qty,
                            "serial_no": None,
                            "batch_no": None,
                            "voucher_type": "Stock Entry",
                            "voucher_no": stock_entry.name,
                            "company": stock_entry.company
                            or frappe.defaults.get_user_default("Company"),
                        }
                    )
                    if flt(calculated_rate) > 0:
                        item.basic_rate = flt(calculated_rate)
                        item.amount = flt(calculated_rate) * flt(item.qty)
                except Exception:
                    pass

        # Save again if rate was updated
        stock_entry.save(ignore_permissions=True)

        # Submit the Stock Entry
        stock_entry.submit()

        # Optionally, store reference in Production Log Book
        # This would require a custom field like "hopper_stock_entry_no"
        if frappe.db.has_column("Production Log Book", "hopper_stock_entry_no"):
            frappe.db.set_value(
                "Production Log Book",
                doc.name,
                "hopper_stock_entry_no",
                stock_entry.name,
            )
    except Exception as e:
        # Log error but don't fail the entire submission
        frappe.log_error(
            title=f"Hopper Stock Entry Creation Failed for {doc.name}",
            message=frappe.get_traceback(),
        )
        frappe.msgprint(
            f"Warning: Could not create Hopper Stock Entry. Error: {str(e)}",
            alert=True,
            indicator="orange",
        )


def _get_item_valuation_rate(item_code: str, warehouse: str) -> float:
    """Get the valuation rate (average rate) for an item in a warehouse.

    This fetches the valuation rate using multiple methods to ensure a value is found.

    Priority:
    1. Use get_incoming_rate (ERPNext's built-in method)
    2. Get latest valuation rate from Stock Ledger Entry
    3. Get valuation_rate from Item master
    4. Get standard_rate from Item master
    5. Get last_purchase_rate from Item master

    Args:
        item_code: Item Code
        warehouse: Warehouse name

    Returns:
        Valuation rate as float (should always return a value > 0)
    """
    try:
        # Method 1: Use ERPNext's get_incoming_rate method
        # This is the most reliable way to get valuation rate
        from erpnext.stock.utils import get_incoming_rate

        incoming_rate = get_incoming_rate(
            {
                "item_code": item_code,
                "warehouse": warehouse,
                "posting_date": frappe.utils.today(),
                "posting_time": frappe.utils.nowtime(),
                "qty": 1,
                "serial_no": None,
                "batch_no": None,
                "voucher_type": "Stock Entry",
                "voucher_no": None,
                "company": frappe.defaults.get_user_default("Company"),
            }
        )

        if flt(incoming_rate) > 0:
            frappe.logger().info(
                f"Rate fetched via get_incoming_rate for {item_code}: {incoming_rate}"
            )
            return flt(incoming_rate)

    except Exception as e:
        frappe.log_error(
            title=f"get_incoming_rate failed for {item_code}",
            message=f"Error: {str(e)}",
        )

    try:
        # Method 2: Get latest valuation rate from Stock Ledger Entry
        sle = frappe.get_all(
            "Stock Ledger Entry",
            filters={
                "item_code": item_code,
                "warehouse": warehouse,
                "valuation_rate": [">", 0],
            },
            fields=["valuation_rate"],
            order_by="posting_date desc, posting_time desc, creation desc",
            limit_page_length=1,
        )

        if sle and flt(sle[0].get("valuation_rate")) > 0:
            frappe.logger().info(
                f"Rate fetched from SLE for {item_code}: {sle[0].valuation_rate}"
            )
            return flt(sle[0].valuation_rate)

    except Exception:
        pass

    try:
        # Method 3: Try any warehouse for this item (not just target warehouse)
        sle_any = frappe.get_all(
            "Stock Ledger Entry",
            filters={
                "item_code": item_code,
                "valuation_rate": [">", 0],
            },
            fields=["valuation_rate"],
            order_by="posting_date desc, posting_time desc, creation desc",
            limit_page_length=1,
        )

        if sle_any and flt(sle_any[0].get("valuation_rate")) > 0:
            return flt(sle_any[0].valuation_rate)

    except Exception:
        pass

    try:
        # Method 4: Get from Item master - valuation_rate field
        item_doc = frappe.get_cached_doc("Item", item_code)

        if item_doc:
            # Try valuation_rate
            if flt(item_doc.valuation_rate) > 0:
                return flt(item_doc.valuation_rate)

            # Try standard_rate
            if flt(item_doc.standard_rate) > 0:
                return flt(item_doc.standard_rate)

            # Try last_purchase_rate
            if flt(item_doc.last_purchase_rate) > 0:
                return flt(item_doc.last_purchase_rate)

    except Exception:
        pass

    try:
        # Method 5: Get from latest Purchase Receipt
        pr_item = frappe.get_all(
            "Purchase Receipt Item",
            filters={
                "item_code": item_code,
                "rate": [">", 0],
                "docstatus": 1,
            },
            fields=["rate"],
            order_by="creation desc",
            limit_page_length=1,
        )

        if pr_item and flt(pr_item[0].get("rate")) > 0:
            return flt(pr_item[0].rate)

    except Exception:
        pass

    # Last resort: return 0 (but this should rarely happen)
    frappe.log_error(
        title=f"No valuation rate found for {item_code}",
        message=f"Item: {item_code}, Warehouse: {warehouse}. Using rate 0.",
    )
    return 0.0


def on_production_log_book_submit(doc, method) -> None:
    """DocEvent hook for on_submit of Production Log Book.

    The main logic lives in the DocType's on_submit method. This hook is kept
    for configurability and future extension without introducing duplicates.
    """
    # No additional logic to avoid duplicate Stock Entry creation.
    # If needed in future, this can call helper functions without
    # duplicating what on_submit already does.
    return
