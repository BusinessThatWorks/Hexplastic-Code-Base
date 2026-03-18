"""API endpoints for Daily Production Dashboard (Gaurav's Dashboard).

Provides three sections:
  1. Production Summary – sheets/boxes produced & rejected today
  2. Dispatch Summary   – delivery-note quantities dispatched today
  3. MIP               – material consumed vs generated today
"""

import frappe
from frappe import _
from frappe.utils import flt, getdate, nowdate, add_days


# ──────────────────────────────────────────────────────────────────
#  Main endpoint
# ──────────────────────────────────────────────────────────────────
@frappe.whitelist()
def get_daily_production_data(from_date=None, to_date=None):
    """Return all three dashboard sections for the given date range.

    If no dates are provided, defaults to today's date for both.

    Returns:
        dict: {
            production: { ... },
            dispatch:   { ... },
            mip:        { ... }
        }
    """
    if not from_date and not to_date:
        target = getdate(nowdate())
        from_dt = to_dt = target
    else:
        from_dt = getdate(from_date) if from_date else getdate(nowdate())
        to_dt = getdate(to_date) if to_date else from_dt

    # Yesterday comparison is only meaningful when viewing a single day
    yesterday = add_days(from_dt, -1) if from_dt == to_dt else None

    try:
        return {
            "production": _get_production_summary(from_dt, to_dt, yesterday),
            "dispatch": _get_dispatch_summary(from_dt, to_dt),
            "mip": _get_mip_summary(from_dt, to_dt),
        }
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Daily Production Dashboard Error"),
        )
        return {
            "production": _empty_production(),
            "dispatch": _empty_dispatch(),
            "mip": _empty_mip(),
        }


# ──────────────────────────────────────────────────────────────────
#  Section 1 – Production Summary
# ──────────────────────────────────────────────────────────────────
def _get_production_summary(from_date, to_date, yesterday=None):
    """Sheets / boxes produced & rejected for the selected range.

    Production data comes from **Production Log Sheet** (docstatus=1).
    Items whose Item-master ``item_group`` contains the word **Sheet**
    are treated as sheets; those containing **Box** as boxes.

    Rejection data comes from **Daily Rejection Data** (docstatus=1).
    """
    try:
        # ── Selected period production ──────────────────────────
        period_data = _production_by_group(from_date, to_date)

        # ── Yesterday (only for single-day view) ───────────────
        if yesterday:
            yesterday_data = _production_by_group(yesterday, yesterday)
        else:
            yesterday_data = {"sheets": 0, "boxes": 0}

        # ── Rejection ───────────────────────────────────────────
        rejection = _get_rejection_data(from_date, to_date)

        # ── Production Plan Overview (table) ────────────────────
        plan_rows = _get_production_plan_overview(from_date, to_date)

        # ── Rejection Overview (table) ──────────────────────────
        rejection_rows = _get_rejection_overview(from_date, to_date)

        return {
            "sheets_produced": period_data.get("sheets", 0),
            # Business rule (for now): no box-related data is maintained,
            # so keep Boxes Produced static at 0
            "boxes_produced": 0,
            "sheets_produced_yesterday": yesterday_data.get("sheets", 0),
            "boxes_produced_yesterday": 0,
            "sheets_rejected": rejection.get("sheets_rejected", 0),
            "boxes_rejected": 0,
            "plan_overview": plan_rows,
            "rejection_overview": rejection_rows,
        }
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Production Summary Error"),
        )
        return _empty_production()


def _production_by_group(from_date, to_date):
    """Return {sheets: int, boxes: int} for a date range."""
    data = frappe.db.sql(
        """
        SELECT
            CASE
                WHEN LOWER(i.item_group) LIKE '%%sheet%%' THEN 'sheets'
                WHEN LOWER(i.item_group) LIKE '%%box%%'   THEN 'boxes'
                ELSE 'other'
            END AS category,
            COALESCE(SUM(pls.manufactured_qty), 0) AS qty
        FROM `tabProduction Log Sheet` pls
        LEFT JOIN `tabItem` i ON pls.manufacturing_item = i.name
        WHERE pls.docstatus = 1
          AND pls.production_date BETWEEN %s AND %s
        GROUP BY category
        """,
        (from_date, to_date),
        as_dict=True,
    )

    result = {"sheets": 0, "boxes": 0}
    for row in data:
        cat = row.get("category", "other")
        if cat in result:
            result[cat] = int(flt(row.get("qty", 0)))
    return result


def _get_rejection_data(from_date, to_date):
    """Return sheet and box rejection counts for the selected range.

    Uses Daily Rejection Data (submitted).  ``total_rejection`` is treated
    as *boxes* rejected (the child table tracks box-rejection reasons).
    Sheet rejection is derived from Production Log Sheet's
    ``process_loss_weight`` (converted to units via weight_per_unit).
    """
    try:
        # Box rejection from Daily Rejection Data
        box_rej = frappe.db.sql(
            """
            SELECT COALESCE(SUM(total_rejection), 0) AS total
            FROM `tabDaily Rejection Data`
            WHERE docstatus = 1
              AND rejection_date BETWEEN %s AND %s
            """,
            (from_date, to_date),
            as_dict=True,
        )
        boxes_rejected = int(flt(box_rej[0].get("total", 0))) if box_rej else 0

        # Sheet rejection — use process_loss_weight from Production Log Sheet
        # for items in the "Sheet" group, expressed in kg (displayed as-is)
        sheet_rej = frappe.db.sql(
            """
            SELECT COALESCE(SUM(pls.process_loss_weight), 0) AS total
            FROM `tabProduction Log Sheet` pls
            LEFT JOIN `tabItem` i ON pls.manufacturing_item = i.name
            WHERE pls.docstatus = 1
              AND pls.production_date BETWEEN %s AND %s
              AND LOWER(i.item_group) LIKE '%%sheet%%'
            """,
            (from_date, to_date),
            as_dict=True,
        )
        sheets_rejected = int(flt(sheet_rej[0].get("total", 0))) if sheet_rej else 0

        return {
            "sheets_rejected": sheets_rejected,
            "boxes_rejected": boxes_rejected,
        }
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Rejection Data Error"),
        )
        return {"sheets_rejected": 0, "boxes_rejected": 0}


def _get_production_plan_overview(from_date, to_date):
    """Return rows for Production Plan Overview table."""
    rows = frappe.db.sql(
        """
        SELECT
            pls.manufacturing_item AS item_name,
            pls.production_plan     AS production_plan,
            COALESCE(SUM(pls.manufactured_qty), 0) AS manufactured_qty
        FROM `tabProduction Log Sheet` pls
        WHERE pls.docstatus = 1
          AND pls.production_date BETWEEN %s AND %s
          AND pls.manufacturing_item IS NOT NULL
        GROUP BY pls.manufacturing_item, pls.production_plan
        ORDER BY manufactured_qty DESC
        LIMIT 20
        """,
        (from_date, to_date),
        as_dict=True,
    )

    return [
        {
            "item_name": r.item_name,
            "production_plan": r.production_plan,
            "manufactured_qty": flt(r.manufactured_qty, 0),
        }
        for r in rows
    ]


def _get_rejection_overview(from_date, to_date):
    """Return rows for Rejection Overview table.

    Note: current Daily Rejection setup is box-oriented, so we show
    aggregate box rejection per document as "Total Rejection".
    """
    rows = frappe.db.sql(
        """
        SELECT
            name           AS docname,
            rejection_date AS rejection_date,
            COALESCE(total_rejection, 0) AS rejected_qty,
            COALESCE(rejection_in_, 0) AS rejection_pct
        FROM `tabDaily Rejection Data`
        WHERE docstatus = 1
          AND rejection_date BETWEEN %s AND %s
        ORDER BY rejection_date DESC, name DESC
        LIMIT 20
        """,
        (from_date, to_date),
        as_dict=True,
    )

    return [
        {
            "item_name": "Boxes",  # we only track box rejection here
            "rejected_qty": int(flt(r.rejected_qty, 0)),
            "rejection_pct": flt(r.rejection_pct, 2),
        }
        for r in rows
    ]


def _empty_production():
    return {
        "sheets_produced": 0,
        "boxes_produced": 0,
        "sheets_produced_yesterday": 0,
        "boxes_produced_yesterday": 0,
        "sheets_rejected": 0,
        "boxes_rejected": 0,
    }


# ──────────────────────────────────────────────────────────────────
#  Section 2 – Dispatch Summary
# ──────────────────────────────────────────────────────────────────
def _get_dispatch_summary(from_date, to_date):
    """Sheets and EXIDE quantities dispatched in the selected range.

    Data comes from **Delivery Note Item** (parent DN is submitted and
    ``posting_date`` = *target_date*).  Items whose ``item_group``
    contains **Sheet** count as sheets; those whose group or name
    contains **EXIDE** as EXIDE.
    """
    try:
        data = frappe.db.sql(
            """
            SELECT
                CASE
                    WHEN LOWER(i.item_group) LIKE '%%sheet%%'
                         OR LOWER(i.item_name) LIKE '%%sheet%%'
                        THEN 'sheets'
                    WHEN LOWER(i.item_group) LIKE '%%exide%%'
                         OR LOWER(i.item_name) LIKE '%%exide%%'
                         OR LOWER(i.name) LIKE '%%exide%%'
                        THEN 'exide'
                    ELSE 'other'
                END AS category,
                COALESCE(SUM(dni.qty), 0) AS qty
            FROM `tabDelivery Note Item` dni
            INNER JOIN `tabDelivery Note` dn ON dn.name = dni.parent
            LEFT  JOIN `tabItem` i         ON dni.item_code = i.name
            WHERE dn.docstatus = 1
              AND dn.posting_date BETWEEN %s AND %s
            GROUP BY category
            """,
            (from_date, to_date),
            as_dict=True,
        )

        result = {"sheets_dispatched": 0, "exide_dispatched": 0}
        for row in data:
            cat = row.get("category", "other")
            qty = int(flt(row.get("qty", 0)))
            if cat == "sheets":
                result["sheets_dispatched"] = qty
            elif cat == "exide":
                result["exide_dispatched"] = qty
        return result
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Dispatch Summary Error"),
        )
        return _empty_dispatch()


def _empty_dispatch():
    return {"sheets_dispatched": 0, "exide_dispatched": 0}


# ──────────────────────────────────────────────────────────────────
#  Section 3 – MIP (Material / Inventory Position)
# ──────────────────────────────────────────────────────────────────
def _get_mip_summary(from_date, to_date):
    """Total consumed vs total generated for the selected range.

    Business rule (per Gaurav):
    * **Total Consumed**  = SUM of ``mip_used``  from Production Log Sheet
    * **Total Generated** = SUM of ``closing_qty_for_mip`` from Production Log Sheet
    """
    try:
        data = frappe.db.sql(
            """
            SELECT
                COALESCE(SUM(pls.mip_used), 0)             AS total_consumed,
                COALESCE(SUM(pls.closing_qty_for_mip), 0)  AS total_generated
            FROM `tabProduction Log Sheet` pls
            WHERE pls.docstatus = 1
              AND pls.production_date BETWEEN %s AND %s
            """,
            (from_date, to_date),
            as_dict=True,
        )

        if data:
            return {
                "total_consumed": flt(data[0].get("total_consumed", 0), 2),
                "total_generated": flt(data[0].get("total_generated", 0), 2),
            }
        return _empty_mip()
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("MIP Summary Error"),
        )
        return _empty_mip()


def _empty_mip():
    return {"total_consumed": 0, "total_generated": 0}
