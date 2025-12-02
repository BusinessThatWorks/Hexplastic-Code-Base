"""API endpoints for Production Log Book."""

import frappe
from frappe import _


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
