"""API endpoints for Production Log Book."""

import frappe
from frappe import _
from frappe.utils import flt
from datetime import datetime, timedelta


@frappe.whitelist()
def get_bom_items_only(bom_name):
    """
    Fetch only BOM Items (from BOM Item child table) for populating the Production Log Book Table.

    Args:
        bom_name: Name of the BOM document

    Returns:
        list: List of dictionaries containing item_code, qty, uom, description, item_name
    """
    try:
        if not bom_name:
            return []

        # Validate that BOM exists
        if not frappe.db.exists("BOM", bom_name):
            frappe.throw(_("BOM {0} does not exist").format(bom_name))

        # Fetch BOM items from the BOM Item child table
        bom_items = frappe.get_all(
            "BOM Item",
            filters={"parent": bom_name},
            fields=["item_code", "qty", "uom", "description", "item_name"],
            order_by="idx",
        )

        # Add item_type flag to each BOM item
        for item in bom_items:
            item["item_type"] = "BOM Item"

        return bom_items or []

    except frappe.DoesNotExistError:
        frappe.throw(_("BOM {0} does not exist").format(bom_name))
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(), title=_("Error fetching BOM items")
        )
        frappe.throw(_("Error fetching BOM items"))


@frappe.whitelist()
def get_bom_main_and_scrap_items(bom_name):
    """
    Fetch BOM main item and BOM Scrap Items for populating the Production Log Book Table.
    This is called when manufactured_qty is filled.

    Args:
        bom_name: Name of the BOM document

    Returns:
        dict: {
            "main_item_code": <main item code from BOM> or None,
            "items": [
                {"item_code": "...", "qty": ..., "uom": "...", "description": "...", "item_name": "..."},
                ...
            ]
        }
    """
    try:
        if not bom_name:
            return {"main_item_code": None, "items": []}

        # Validate that BOM exists
        if not frappe.db.exists("BOM", bom_name):
            frappe.throw(_("BOM {0} does not exist").format(bom_name))

        all_items = []
        main_item_code = None

        # 1. Fetch the main item from BOM doctype
        bom_doc = frappe.get_doc("BOM", bom_name)
        if bom_doc.item:
            main_item_code = bom_doc.item
            # Get item details if item exists
            if frappe.db.exists("Item", bom_doc.item):
                item_doc = frappe.get_doc("Item", bom_doc.item)
                main_item = {
                    "item_code": bom_doc.item,
                    "item_name": item_doc.item_name,
                    "qty": bom_doc.quantity or 1,
                    "uom": bom_doc.uom or item_doc.stock_uom,
                    "description": item_doc.description,
                    "item_type": "Main Item",
                }
                all_items.append(main_item)
            else:
                # Item doesn't exist, but still add it with basic info
                main_item = {
                    "item_code": bom_doc.item,
                    "item_name": bom_doc.item,
                    "qty": bom_doc.quantity or 1,
                    "uom": bom_doc.uom or "",
                    "description": "",
                    "item_type": "Main Item",
                }
                all_items.append(main_item)

        # 2. Fetch BOM Scrap Items from the BOM Scrap Item child table
        # Note: BOM Scrap Item has stock_uom (not uom) and no description field
        bom_scrap_items = frappe.get_all(
            "BOM Scrap Item",
            filters={"parent": bom_name},
            fields=["item_code", "stock_qty", "stock_uom", "item_name"],
            order_by="idx",
        )

        # Normalize field names for consistency with BOM Items
        for item in bom_scrap_items:
            # Rename stock_qty to qty for consistency with BOM Items
            if "stock_qty" in item:
                item["qty"] = item.pop("stock_qty")
            # Rename stock_uom to uom for consistency with BOM Items
            if "stock_uom" in item:
                item["uom"] = item.pop("stock_uom")
            # Add description from Item master if item_code exists
            if item.get("item_code") and frappe.db.exists("Item", item["item_code"]):
                item["description"] = (
                    frappe.db.get_value("Item", item["item_code"], "description") or ""
                )
            else:
                item["description"] = ""
            item["item_type"] = "Scrap Item"
            all_items.append(item)

        return {"main_item_code": main_item_code, "items": all_items}

    except frappe.DoesNotExistError:
        frappe.throw(_("BOM {0} does not exist").format(bom_name))
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching BOM main and scrap items"),
        )
        frappe.throw(_("Error fetching BOM main and scrap items"))


@frappe.whitelist()
def get_bom_item_quantities(bom_name, item_codes=None):
    """
    Fetch BOM main quantity and BOM item quantities for given items.

    This is used by Production Log Book to compute:
        base = ( item_quantity_from_BOM_items / BOM_main_quantity )
        issued = base * qty_to_manufacture

    Args:
        bom_name (str): Name of the BOM document
        item_codes (list | str): List of item codes present in the Manufacture Consumption Table.
                                 When coming from JS this may be a JSON string; it will be parsed.

    Returns:
        dict: {
            "bom_qty": <BOM main quantity (float)>,
            "items": [
                {"item_code": "...", "qty": <item quantity from BOM>},
                ...
            ]
        }
    """
    try:
        if not bom_name:
            return {"bom_qty": 0, "items": []}

        # Normalize item_codes (may be JSON string from JS)
        if isinstance(item_codes, str):
            item_codes = frappe.parse_json(item_codes)

        item_codes = item_codes or []

        # Validate that BOM exists
        if not frappe.db.exists("BOM", bom_name):
            frappe.throw(_("BOM {0} does not exist").format(bom_name))

        # Get BOM main quantity (total quantity to produce)
        bom_qty = frappe.db.get_value("BOM", bom_name, "quantity") or 0

        # If no item codes are provided, we can safely return early
        if not item_codes:
            return {"bom_qty": bom_qty or 0, "items": []}

        # Fetch BOM item quantities only for relevant items
        bom_items = frappe.get_all(
            "BOM Item",
            filters={
                "parent": bom_name,
                "item_code": ["in", item_codes],
            },
            fields=["item_code", "qty"],
            order_by="idx",
        )

        return {
            "bom_qty": bom_qty or 0,
            "items": bom_items or [],
        }

    except frappe.DoesNotExistError:
        frappe.throw(_("BOM {0} does not exist").format(bom_name))
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching BOM item quantities"),
        )
        frappe.throw(_("Error fetching BOM item quantities"))


@frappe.whitelist()
def calculate_scrap_in_qty(
    bom_name: str, item_code: str, manufactured_qty: float | int
):
    """
    Calculate in_qty for a scrap item based on BOM Scrap & Process Loss table.

    Formula:
        in_qty = ( scrap_qty_from_BOM / bom_main_qty ) * manufactured_qty

    Where:
        - scrap_qty_from_BOM: stock_qty from BOM Scrap Item for the given item_code
        - bom_main_qty: quantity field on the BOM (parent)
        - manufactured_qty: Production Log Book.manufactured_qty

    If any required value is missing or invalid, in_qty is 0.
    Division by zero is prevented.

    Args:
        bom_name: Name of the BOM document
        item_code: Scrap item code
        manufactured_qty: Manufactured quantity from Production Log Book

    Returns:
        dict: {"in_qty": <calculated float>}
    """
    try:
        # Basic validation
        if not bom_name or not item_code:
            return {"in_qty": 0.0}

        # Normalize manufactured_qty safely
        manufactured_qty = flt(manufactured_qty) or 0.0
        if manufactured_qty <= 0:
            return {"in_qty": 0.0}

        # Ensure BOM exists
        if not frappe.db.exists("BOM", bom_name):
            frappe.throw(_("BOM {0} does not exist").format(bom_name))

        # Fetch BOM main quantity
        bom_main_qty = flt(frappe.db.get_value("BOM", bom_name, "quantity")) or 0.0
        if bom_main_qty <= 0:
            # Avoid division by zero and invalid BOM state
            return {"in_qty": 0.0}

        # Fetch scrap quantity for this item from BOM Scrap Item table
        scrap_rows = frappe.get_all(
            "BOM Scrap Item",
            filters={"parent": bom_name, "item_code": item_code},
            fields=["stock_qty"],
        )

        if not scrap_rows:
            # Item is not present in BOM Scrap table
            return {"in_qty": 0.0}

        # Sum stock_qty in case there are multiple rows for the same item
        scrap_qty_from_bom = sum(flt(row.stock_qty) for row in scrap_rows) or 0.0
        if scrap_qty_from_bom <= 0:
            return {"in_qty": 0.0}

        # Apply formula
        in_qty = (scrap_qty_from_bom / bom_main_qty) * manufactured_qty

        # Ensure non-negative result
        in_qty = max(0.0, flt(in_qty))

        return {"in_qty": in_qty}

    except frappe.DoesNotExistError:
        frappe.throw(_("BOM {0} does not exist").format(bom_name))
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error calculating scrap in_qty"),
        )
        # Return 0 on error to avoid breaking client-side logic
        return {"in_qty": 0.0}


@frappe.whitelist()
def get_previous_closing_stock(
    item_code, current_date, current_shift, exclude_docname=None
):
    """
    Get the previous closing_stock for an item_code based on shift-based priority logic.

    Priority Rules:
    - If current_shift = NIGHT:
        1. Check SAME DATE → DAY shift
        2. If not found, go to PREVIOUS DATE (NIGHT → then DAY), continue backwards
    - If current_shift = DAY:
        1. Go to PREVIOUS DATE (NIGHT → then DAY), continue backwards

    Args:
        item_code (str): Item code to search for
        current_date (str): Current production date (YYYY-MM-DD format)
        current_shift (str): Current shift type ("Day", "Night", or "Both")
        exclude_docname (str, optional): Document name to exclude from search (current document)

    Returns:
        float: closing_stock value from previous entry, or 0 if not found
    """
    try:
        if not item_code or not current_date or not current_shift:
            return 0.0

        # Normalize shift values
        current_shift = current_shift.strip().lower()
        if current_shift == "both":
            # If "Both", treat as DAY for priority logic
            current_shift = "day"

        # Parse current date
        try:
            current_date_obj = frappe.utils.getdate(current_date)
        except Exception:
            frappe.throw(_("Invalid date format: {0}").format(current_date))

        # Convert shift to match database values (Day, Night, Both)
        shift_map = {"day": "Day", "night": "Night", "both": "Both"}
        current_shift_db = shift_map.get(current_shift, "Day")

        # Build list of date-shift combinations to check in priority order
        search_sequence = []

        if current_shift == "night":
            # Step 1: Same date, DAY shift
            search_sequence.append((current_date_obj, "Day"))

            # Step 2: Previous dates (NIGHT → DAY)
            check_date = current_date_obj - timedelta(days=1)
            # Limit search to last 30 days to avoid infinite loops
            max_days_back = 30
            days_checked = 0

            while days_checked < max_days_back:
                search_sequence.append((check_date, "Night"))
                search_sequence.append((check_date, "Day"))
                check_date = check_date - timedelta(days=1)
                days_checked += 1
        else:  # current_shift == "day"
            # Go directly to previous dates (NIGHT → DAY)
            check_date = current_date_obj - timedelta(days=1)
            max_days_back = 30
            days_checked = 0

            while days_checked < max_days_back:
                search_sequence.append((check_date, "Night"))
                search_sequence.append((check_date, "Day"))
                check_date = check_date - timedelta(days=1)
                days_checked += 1

        # Search through the sequence
        for check_date_obj, check_shift in search_sequence:
            # Build filters for Production Log Book
            filters = {
                "production_date": check_date_obj,
                "shift_type": check_shift,
                "docstatus": 1,  # Only submitted documents
            }

            # Exclude current document if provided
            if exclude_docname:
                filters["name"] = ["!=", exclude_docname]

            # Find Production Log Book documents matching date and shift
            plb_docs = frappe.get_all(
                "Production Log Book",
                filters=filters,
                fields=["name"],
                order_by="creation desc",  # Get most recent first
                limit=1,
            )

            if plb_docs:
                plb_name = plb_docs[0].name

                # Search in child table for matching item_code
                child_rows = frappe.get_all(
                    "Production Log Book Table",
                    filters={"parent": plb_name, "item_code": item_code},
                    fields=["closing_stock"],
                    limit=1,
                )

                if child_rows and child_rows[0].closing_stock is not None:
                    closing_stock = flt(child_rows[0].closing_stock) or 0.0
                    return closing_stock

        # Nothing found, return 0
        return 0.0

    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching previous closing stock"),
        )
        # Return 0 on error to avoid breaking the form
        return 0.0


@frappe.whitelist()
def get_opening_stock_for_items(
    item_codes, current_date, current_shift, exclude_docname=None
):
    """
    Get opening stock (previous closing_stock) for multiple items at once.
    This is more efficient than calling get_previous_closing_stock multiple times.

    Args:
        item_codes (list | str): List of item codes (may be JSON string from JS)
        current_date (str): Current production date (YYYY-MM-DD format)
        current_shift (str): Current shift type ("Day", "Night", or "Both")
        exclude_docname (str, optional): Document name to exclude from search

    Returns:
        dict: {item_code: closing_stock_value, ...}
    """
    try:
        # Normalize item_codes
        if isinstance(item_codes, str):
            item_codes = frappe.parse_json(item_codes)

        item_codes = item_codes or []

        if not item_codes:
            return {}

        result = {}

        # Call get_previous_closing_stock for each item
        for item_code in item_codes:
            if item_code:
                result[item_code] = get_previous_closing_stock(
                    item_code, current_date, current_shift, exclude_docname
                )

        return result

    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching opening stock for items"),
        )
        return {}


@frappe.whitelist()
def get_previous_hopper_opening_qty(
    current_date: str, current_shift: str, exclude_docname: str | None = None
) -> float:
    """
    Get the previous hopper closing quantity (used as opening for current doc)
    based on the same shift-based priority logic as item-wise closing stock.

    Priority Rules:
    - If current_shift = NIGHT:
        1. Check SAME DATE → DAY shift
        2. If not found, go to PREVIOUS DATE (NIGHT → then DAY), continue backwards
    - If current_shift = DAY:
        1. Go to PREVIOUS DATE (NIGHT → then DAY), continue backwards

    Args:
        current_date: Current production date (YYYY-MM-DD format)
        current_shift: Current shift type ("Day", "Night", or "Both")
        exclude_docname: Document name to exclude from search (current document)

    Returns:
        float: hopper_closing_qty from previous entry, or 0 if not found
    """
    try:
        if not current_date or not current_shift:
            return 0.0

        # Normalize shift values
        shift_normalized = current_shift.strip().lower()
        if shift_normalized == "both":
            # If "Both", treat as DAY for priority logic
            shift_normalized = "day"

        # Parse current date
        try:
            current_date_obj = frappe.utils.getdate(current_date)
        except Exception:
            frappe.throw(_("Invalid date format: {0}").format(current_date))

        # Build list of date-shift combinations to check in priority order
        search_sequence: list[tuple] = []

        if shift_normalized == "night":
            # Step 1: Same date, DAY shift
            search_sequence.append((current_date_obj, "Day"))

            # Step 2: Previous dates (NIGHT → DAY)
            check_date = current_date_obj - timedelta(days=1)
            # Limit search to last 30 days to avoid infinite loops
            max_days_back = 30
            days_checked = 0

            while days_checked < max_days_back:
                search_sequence.append((check_date, "Night"))
                search_sequence.append((check_date, "Day"))
                check_date = check_date - timedelta(days=1)
                days_checked += 1
        else:  # shift_normalized == "day"
            # Go directly to previous dates (NIGHT → DAY)
            check_date = current_date_obj - timedelta(days=1)
            max_days_back = 30
            days_checked = 0

            while days_checked < max_days_back:
                search_sequence.append((check_date, "Night"))
                search_sequence.append((check_date, "Day"))
                check_date = check_date - timedelta(days=1)
                days_checked += 1

        # Search through the sequence
        for check_date_obj, check_shift in search_sequence:
            filters: dict = {
                "production_date": check_date_obj,
                "shift_type": check_shift,
                "docstatus": 1,  # Only submitted documents
            }

            # Exclude current document if provided
            if exclude_docname:
                filters["name"] = ["!=", exclude_docname]

            # Find Production Log Book documents matching date and shift
            plb_docs = frappe.get_all(
                "Production Log Book",
                filters=filters,
                fields=["name", "closing_qty"],
                order_by="creation desc",  # Get most recent first
                limit=1,
            )

            if plb_docs:
                # Use hopper closing quantity from the parent doc
                closing_qty = plb_docs[0].get("closing_qty")
                return flt(closing_qty) or 0.0

        # Nothing found, return 0
        return 0.0

    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching previous hopper opening qty"),
        )
        # Return 0 on error to avoid breaking the form
        return 0.0


@frappe.whitelist()
def get_previous_mip_opening_qty(
    current_date: str, current_shift: str, exclude_docname: str | None = None
) -> float:
    """
    Get the previous MIP closing quantity (used as opening for current doc)
    based on the same shift-based priority logic as hopper and item-wise stock.

    Priority Rules:
    - If current_shift = NIGHT:
        1. Check SAME DATE → DAY shift
        2. If not found, go to PREVIOUS DATE (NIGHT → then DAY), continue backwards
    - If current_shift = DAY:
        1. Go to PREVIOUS DATE (NIGHT → then DAY), continue backwards

    Args:
        current_date: Current production date (YYYY-MM-DD format)
        current_shift: Current shift type ("Day", "Night", or "Both")
        exclude_docname: Document name to exclude from search (current document)

    Returns:
        float: closing_qty_mip from previous entry, or 0 if not found
    """
    try:
        if not current_date or not current_shift:
            return 0.0

        # Normalize shift values
        shift_normalized = current_shift.strip().lower()
        if shift_normalized == "both":
            shift_normalized = "day"

        # Parse current date
        try:
            current_date_obj = frappe.utils.getdate(current_date)
        except Exception:
            frappe.throw(_("Invalid date format: {0}").format(current_date))

        # Build list of date-shift combinations to check in priority order
        search_sequence: list[tuple] = []

        if shift_normalized == "night":
            # Step 1: Same date, DAY shift
            search_sequence.append((current_date_obj, "Day"))

            # Step 2: Previous dates (NIGHT → DAY)
            check_date = current_date_obj - timedelta(days=1)
            max_days_back = 30
            days_checked = 0

            while days_checked < max_days_back:
                search_sequence.append((check_date, "Night"))
                search_sequence.append((check_date, "Day"))
                check_date = check_date - timedelta(days=1)
                days_checked += 1
        else:
            # Go directly to previous dates (NIGHT → DAY)
            check_date = current_date_obj - timedelta(days=1)
            max_days_back = 30
            days_checked = 0

            while days_checked < max_days_back:
                search_sequence.append((check_date, "Night"))
                search_sequence.append((check_date, "Day"))
                check_date = check_date - timedelta(days=1)
                days_checked += 1

        # Search through the sequence
        for check_date_obj, check_shift in search_sequence:
            filters: dict = {
                "production_date": check_date_obj,
                "shift_type": check_shift,
                "docstatus": 1,
            }

            if exclude_docname:
                filters["name"] = ["!=", exclude_docname]

            # Find Production Log Book documents matching date and shift
            plb_docs = frappe.get_all(
                "Production Log Book",
                filters=filters,
                fields=["name", "closing_qty_mip"],
                order_by="creation desc",
                limit=1,
            )

            if plb_docs:
                closing_qty_mip = plb_docs[0].get("closing_qty_mip")
                return flt(closing_qty_mip) or 0.0

        return 0.0

    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching previous MIP opening qty"),
        )
        return 0.0


@frappe.whitelist()
def get_stock_entry_no(docname: str) -> str | None:
    """
    Fetch the stock_entry_no from the Production Log Book document.

    This is used to update the UI after document submission without
    making the document dirty or changing its status.

    Args:
        docname: Name of the Production Log Book document

    Returns:
        str | None: The stock_entry_no value, or None if not found
    """
    try:
        if not docname:
            return None

        # Validate that document exists
        if not frappe.db.exists("Production Log Book", docname):
            return None

        # Fetch stock_entry_no from database
        stock_entry_no = frappe.db.get_value(
            "Production Log Book", docname, "stock_entry_no"
        )
        return stock_entry_no or None

    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching stock_entry_no"),
        )
        return None
