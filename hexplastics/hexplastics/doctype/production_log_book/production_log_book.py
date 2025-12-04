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
        """Create and submit a Stock Entry when Production Log Book is submitted."""
        create_stock_entry_for_production_log_book(self)


def create_stock_entry_for_production_log_book(doc: ProductionLogBook) -> None:
    """Create and submit a Stock Entry for the given Production Log Book.

    Parent field mapping:
    - shift_type   -> shift_type
    - machine_used -> machine_used

    Child (Material Consumption Table -> Stock Entry Items):
    - RAW MATERIAL rows: when source_warehouse is set
            * s_warehouse = source_warehouse
            * qty         = consumption
            * rate        = 0

    - MAIN / SCRAP rows: when target_warehouse is set
            * t_warehouse = target_warehouse
            * qty         = in_qty
            * rate        = 0
    """

    if not getattr(doc, "material_consumption", None):
        frappe.throw(
            "Material Consumption table cannot be empty to create Stock Entry."
        )

    stock_entry = frappe.new_doc("Stock Entry")
    stock_entry.stock_entry_type = "Manufacture"

    # Parent field mapping
    stock_entry.shift_type = doc.shift_type
    stock_entry.machine_used = doc.machine_used

    # Optional: align posting date with production date if present
    if getattr(doc, "production_date", None):
        stock_entry.posting_date = doc.production_date

    # Build Stock Entry Items from Material Consumption table
    for row in doc.material_consumption:
        _add_items_from_material_row(stock_entry, row)

    if not stock_entry.items:
        frappe.throw(
            "No valid Stock Entry Items could be created from Material Consumption table."
        )

    # Insert and submit the Stock Entry
    stock_entry.insert(ignore_permissions=True)
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
    - Always set rate to 0
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

        # Skip creating Stock Entry item if consumption is 0 (but don't throw error)
        if qty == 0:
            return

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

        # Skip creating Stock Entry item if in_qty is 0 (but don't throw error)
        if qty == 0:
            return

        # Determine if this is a finished good or scrap based on item_type
        item_type = (row.item_type or "").strip()
        is_finished_item = 1 if item_type == "Main Item" else 0
        is_scrap_item = 1 if item_type == "Scrap Item" else 0

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
    """Helper to construct a single Stock Entry Item with rate fixed to 0."""

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

    return {
        "item_code": item_code,
        "qty": qty,
        "s_warehouse": s_warehouse,
        "t_warehouse": t_warehouse,
        "uom": stock_uom,
        "stock_uom": stock_uom,
        "conversion_factor": 1,
        "basic_rate": 0,  # Ensure rate is always 0
        "allow_zero_valuation_rate": 1,  # Explicitly allow zero valuation
        "is_finished_item": is_finished_item,
        "is_scrap_item": is_scrap_item,
    }


def on_production_log_book_submit(doc, method) -> None:
    """DocEvent hook for on_submit of Production Log Book.

    The main logic lives in the DocType's on_submit method. This hook is kept
    for configurability and future extension without introducing duplicates.
    """
    # No additional logic to avoid duplicate Stock Entry creation.
    # If needed in future, this can call helper functions without
    # duplicating what on_submit already does.
    return
