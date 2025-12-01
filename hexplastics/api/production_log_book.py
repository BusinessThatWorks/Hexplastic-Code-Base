"""API endpoints for Production Log Book."""

import frappe
from frappe import _


@frappe.whitelist()
def get_bom_items(bom_name):
    """
    Fetch all items from a BOM and return them for populating the Production Log Book Table.

    Args:
        bom_name: Name of the BOM document

    Returns:
        list: List of dictionaries containing item_code, qty, uom, and description
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

        # Return the items
        return bom_items

    except frappe.DoesNotExistError:
        frappe.throw(_("BOM {0} does not exist").format(bom_name))
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(), title=_("Error fetching BOM items")
        )
        frappe.throw(_("Error fetching BOM items"))


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
