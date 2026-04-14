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

    If no dates are provided, returns *all* data (no date filter).
    If only one date is provided, the other is left open-ended.

    Returns:
        dict: {
            production: { ... },
            dispatch:   { ... },
            mip:        { ... }
        }
    """
    from_dt = getdate(from_date) if from_date else None
    to_dt = getdate(to_date) if to_date else None

    # Yesterday comparison is only meaningful when viewing a single day
    yesterday = add_days(from_dt, -1) if (from_dt and to_dt and from_dt == to_dt) else None

    try:
        return {
            "sheet_line": _get_sheet_line_table(from_dt, to_dt),
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
            "sheet_line": [],
            "production": _empty_production(),
            "dispatch": _empty_dispatch(),
            "mip": _empty_mip(),
        }


@frappe.whitelist()
def get_default_dashboard_date():
    """Return latest Production Log Sheet date for default filter."""
    try:
        latest_date = frappe.db.sql(
            """
            SELECT MAX(production_date) AS latest_date
            FROM `tabProduction Log Sheet`
            WHERE docstatus = 1
            """,
            as_dict=True,
        )
        date_value = (latest_date[0] or {}).get("latest_date") if latest_date else None
        return {"default_date": str(date_value) if date_value else nowdate()}
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Default Dashboard Date Error"),
        )
        return {"default_date": nowdate()}


def _get_sheet_line_table(from_date, to_date):
    """Return rows for Sheet Line and EXIDE BOXES tables.

    Default behavior (no date filters): show latest production date rows only.
    If date range is provided: show rows in that range.
    """
    try:
        params = []
        if from_date and to_date:
            where_sql = "pls.production_date BETWEEN %s AND %s"
            params = [from_date, to_date]
        elif from_date:
            where_sql = "pls.production_date >= %s"
            params = [from_date]
        elif to_date:
            where_sql = "pls.production_date <= %s"
            params = [to_date]
        else:
            where_sql = (
                "pls.production_date = ("
                "SELECT MAX(x.production_date) "
                "FROM `tabProduction Log Sheet` x "
                "WHERE x.docstatus = 1)"
            )

        has_range_filter = bool(from_date or to_date)

        if has_range_filter:
            pls_rows = frappe.db.sql(
                f"""
                SELECT
                    %s AS date,
                    COALESCE(pls.shift_type, '') AS shift,
                    COALESCE(SUM(pls.manufactured_qty), 0) AS produced,
                    GROUP_CONCAT(DISTINCT pls.production_plan) AS production_plans
                FROM `tabProduction Log Sheet` pls
                WHERE pls.docstatus = 1
                  AND {where_sql}
                GROUP BY pls.shift_type
                ORDER BY pls.shift_type ASC
                """,
                [
                    f"{from_date or 'Start'} to {to_date or 'Latest'}",
                    *params,
                ],
                as_dict=True,
            )
        else:
            pls_rows = frappe.db.sql(
                f"""
                SELECT
                    pls.production_date AS date,
                    COALESCE(pls.shift_type, '') AS shift,
                    COALESCE(SUM(pls.manufactured_qty), 0) AS produced,
                    GROUP_CONCAT(DISTINCT pls.production_plan) AS production_plans
                FROM `tabProduction Log Sheet` pls
                WHERE pls.docstatus = 1
                  AND {where_sql}
                GROUP BY pls.production_date, pls.shift_type
                ORDER BY pls.production_date DESC, pls.shift_type ASC
                LIMIT 200
                """,
                params,
                as_dict=True,
            )

        # Planned qty map from Production Plan Item (target column)
        plan_names = set()
        for row in pls_rows:
            plans = (row.get("production_plans") or "").split(",")
            for p in plans:
                p = (p or "").strip()
                if p:
                    plan_names.add(p)

        plan_qty_map = {}
        if plan_names:
            plan_rows = frappe.db.sql(
                """
                SELECT parent, COALESCE(SUM(planned_qty), 0) AS planned_qty
                FROM `tabProduction Plan Item`
                WHERE docstatus != 2
                  AND parent IN %(plans)s
                GROUP BY parent
                """,
                {"plans": tuple(plan_names)},
                as_dict=True,
            )
            plan_qty_map = {
                r.get("parent"): flt(r.get("planned_qty", 0), 0) for r in plan_rows
            }

        # Rejection map from Daily Rejection Data
        rej_cond, rej_params = _date_condition("rejection_date", from_date, to_date)
        rejection_rows = frappe.db.sql(
            f"""
            SELECT
                rejection_date,
                COALESCE(total_rejected_in_day_shift, 0) AS day_rejected,
                COALESCE(total_rejected_in_night_shift, 0) AS night_rejected
            FROM `tabDaily Rejection Data`
            WHERE docstatus = 1
              AND {rej_cond}
            """,
            rej_params,
            as_dict=True,
        )
        rejection_map = {
            r.get("rejection_date"): {
                "day": flt(r.get("day_rejected", 0), 0),
                "night": flt(r.get("night_rejected", 0), 0),
            }
            for r in rejection_rows
        }
        total_day_rejected = flt(
            sum(r.get("day_rejected", 0) for r in rejection_rows),
            0,
        )
        total_night_rejected = flt(
            sum(r.get("night_rejected", 0) for r in rejection_rows),
            0,
        )

        return [
            {
                "date": r.get("date"),
                "shift": r.get("shift") or "-",
                "target": flt(
                    sum(
                        plan_qty_map.get(p.strip(), 0)
                        for p in (r.get("production_plans") or "").split(",")
                        if p and p.strip()
                    ),
                    0,
                ),
                "produced": flt(r.get("produced", 0), 0),
                "rejected": flt(
                    total_night_rejected
                    if has_range_filter and "night" in (r.get("shift") or "").strip().lower()
                    else total_day_rejected
                    if has_range_filter
                    else (
                        rejection_map.get(r.get("date"), {}).get("night", 0)
                        if "night" in (r.get("shift") or "").strip().lower()
                        else rejection_map.get(r.get("date"), {}).get("day", 0)
                    ),
                    0,
                ),
            }
            for r in pls_rows
        ]
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Sheet Line Table Error"),
        )
        return []


def _date_condition(date_col, from_date, to_date):
    """Return (sql_fragment, params_tuple) for an optional date range.

    * Both dates given  → ``date_col BETWEEN %s AND %s``
    * Only from_date    → ``date_col >= %s``
    * Only to_date      → ``date_col <= %s``
    * Neither           → ``1=1`` (no filter)
    """
    if from_date and to_date:
        return f"{date_col} BETWEEN %s AND %s", (from_date, to_date)
    if from_date:
        return f"{date_col} >= %s", (from_date,)
    if to_date:
        return f"{date_col} <= %s", (to_date,)
    return "1=1", ()


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
    dcond, dparams = _date_condition("pls.production_date", from_date, to_date)
    data = frappe.db.sql(
        f"""
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
          AND {dcond}
        GROUP BY category
        """,
        dparams,
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
        dcond_rej, dparams_rej = _date_condition("rejection_date", from_date, to_date)
        box_rej = frappe.db.sql(
            f"""
            SELECT COALESCE(SUM(total_rejection), 0) AS total
            FROM `tabDaily Rejection Data`
            WHERE docstatus = 1
              AND {dcond_rej}
            """,
            dparams_rej,
            as_dict=True,
        )
        boxes_rejected = int(flt(box_rej[0].get("total", 0))) if box_rej else 0

        # Sheet rejection — use process_loss_weight from Production Log Sheet
        # for items in the "Sheet" group, expressed in kg (displayed as-is)
        dcond_pls, dparams_pls = _date_condition("pls.production_date", from_date, to_date)
        sheet_rej = frappe.db.sql(
            f"""
            SELECT COALESCE(SUM(pls.process_loss_weight), 0) AS total
            FROM `tabProduction Log Sheet` pls
            LEFT JOIN `tabItem` i ON pls.manufacturing_item = i.name
            WHERE pls.docstatus = 1
              AND {dcond_pls}
              AND LOWER(i.item_group) LIKE '%%sheet%%'
            """,
            dparams_pls,
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
    dcond, dparams = _date_condition("pls.production_date", from_date, to_date)
    rows = frappe.db.sql(
        f"""
        SELECT
            pls.manufacturing_item                    AS item_code,
            COALESCE(i.item_name, pls.manufacturing_item) AS item_name,
            pls.production_plan                       AS production_plan,
            COALESCE(SUM(pls.manufactured_qty), 0) AS manufactured_qty
        FROM `tabProduction Log Sheet` pls
        LEFT JOIN `tabItem` i ON i.name = pls.manufacturing_item
        WHERE pls.docstatus = 1
          AND {dcond}
          AND pls.manufacturing_item IS NOT NULL
        GROUP BY pls.manufacturing_item, i.item_name, pls.production_plan
        ORDER BY manufactured_qty DESC
        LIMIT 20
        """,
        dparams,
        as_dict=True,
    )

    return [
        {
            "item_code": r.item_code,
            "item_name": r.item_name,
            "production_plan": r.production_plan,
            "manufactured_qty": flt(r.manufactured_qty, 0),
        }
        for r in rows
    ]


def _get_rejection_overview(from_date, to_date):
    """Return rows for Rejection Overview table.

    Fetch Rejection Id (Daily Rejection Data `name`) and its rejection metrics.
    """
    rows = frappe.db.sql(
        f"""
        SELECT
            r.name AS rejection_id,
            COALESCE(r.total_rejection, 0) AS rejected_qty,
            COALESCE(r.rejection_in_, 0) AS rejection_pct
        FROM `tabDaily Rejection Data` r
        WHERE r.docstatus = 1
          AND { _date_condition("r.rejection_date", from_date, to_date)[0] }
        ORDER BY r.rejection_date DESC, r.name DESC
        LIMIT 20
        """,
        _date_condition("r.rejection_date", from_date, to_date)[1],
        as_dict=True,
    )

    return [
        {
            "rejection_id": r.rejection_id,
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
    """Dispatch table rows for Sheet Line from Sales Invoice.

    Sheet Line rows are fetched from submitted Sales Invoice Items where
    item grade matches PP HOLLOW SHEET. Qty is returned with its UOM.
    Shift does not exist in Sales Invoice, so it is kept as "-".
    """
    try:
        dcond, dparams = _date_condition("si.posting_date", from_date, to_date)
        has_range_filter = bool(from_date or to_date)
        if has_range_filter:
            range_label = f"{from_date or 'Start'} to {to_date or 'Latest'}"
            data = frappe.db.sql(
                f"""
                SELECT
                    %s AS date,
                    '-' AS shift,
                    COALESCE(sii.uom, '') AS uom,
                    COALESCE(SUM(sii.qty), 0) AS qty
                FROM `tabSales Invoice Item` sii
                INNER JOIN `tabSales Invoice` si ON si.name = sii.parent
                LEFT JOIN `tabItem` i ON i.name = sii.item_code
                WHERE si.docstatus = 1
                  AND {dcond}
                  AND (
                        UPPER(TRIM(COALESCE(i.item_group, ''))) = 'PP HOLLOW SHEETS'
                      )
                GROUP BY sii.uom
                ORDER BY sii.uom ASC
                LIMIT 200
                """,
                [range_label, *dparams],
                as_dict=True,
            )
        else:
            data = frappe.db.sql(
                """
                SELECT
                    si.posting_date AS date,
                    '-' AS shift,
                    COALESCE(sii.uom, '') AS uom,
                    COALESCE(SUM(sii.qty), 0) AS qty
                FROM `tabSales Invoice Item` sii
                INNER JOIN `tabSales Invoice` si ON si.name = sii.parent
                LEFT JOIN `tabItem` i ON i.name = sii.item_code
                WHERE si.docstatus = 1
                  AND si.posting_date = (
                        SELECT MAX(sx.posting_date)
                        FROM `tabSales Invoice` sx
                        WHERE sx.docstatus = 1
                    )
                  AND (
                        UPPER(TRIM(COALESCE(i.item_group, ''))) = 'PP HOLLOW SHEETS'
                      )
                GROUP BY si.posting_date, sii.uom
                ORDER BY si.posting_date DESC, sii.uom ASC
                LIMIT 200
                """,
                as_dict=True,
            )

        return {
            "sheet_line_rows": [
                {
                    "date": row.get("date"),
                    "shift": "-",
                    "qty": flt(row.get("qty", 0), 0),
                    "uom": row.get("uom") or "",
                }
                for row in data
            ]
        }
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Dispatch Summary Error"),
        )
        return _empty_dispatch()


def _empty_dispatch():
    return {"sheet_line_rows": []}


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
        has_range_filter = bool(from_date or to_date)
        if has_range_filter:
            dcond, dparams = _date_condition("pls.production_date", from_date, to_date)
            range_label = f"{from_date or 'Start'} to {to_date or 'Latest'}"
            rows = frappe.db.sql(
                f"""
                SELECT
                    %s AS date,
                    COALESCE(pls.shift_type, '') AS shift,
                    COALESCE(SUM(pls.closing_qty_for_mip), 0) AS total_issued,
                    COALESCE(SUM(pls.mip_used), 0) AS total_consumed
                FROM `tabProduction Log Sheet` pls
                WHERE pls.docstatus = 1
                  AND {dcond}
                GROUP BY pls.shift_type
                ORDER BY pls.shift_type ASC
                LIMIT 200
                """,
                [range_label, *dparams],
                as_dict=True,
            )
        else:
            rows = frappe.db.sql(
                """
                SELECT
                    pls.production_date AS date,
                    COALESCE(pls.shift_type, '') AS shift,
                    COALESCE(SUM(pls.closing_qty_for_mip), 0) AS total_issued,
                    COALESCE(SUM(pls.mip_used), 0) AS total_consumed
                FROM `tabProduction Log Sheet` pls
                WHERE pls.docstatus = 1
                  AND pls.production_date = (
                        SELECT MAX(x.production_date)
                        FROM `tabProduction Log Sheet` x
                        WHERE x.docstatus = 1
                  )
                GROUP BY pls.production_date, pls.shift_type
                ORDER BY pls.shift_type ASC
                """,
                as_dict=True,
            )

        total_issued = flt(sum(r.get("total_issued", 0) for r in rows), 2)
        total_consumed = flt(sum(r.get("total_consumed", 0) for r in rows), 2)
        return {
            "total_generated": total_issued,
            "total_consumed": total_consumed,
            "rows": [
                {
                    "date": r.get("date"),
                    "shift": r.get("shift") or "-",
                    "total_issued": flt(r.get("total_issued", 0), 2),
                    "total_consumed": flt(r.get("total_consumed", 0), 2),
                    "net_balance": flt(r.get("total_issued", 0), 2)
                    - flt(r.get("total_consumed", 0), 2),
                }
                for r in rows
            ],
        }
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("MIP Summary Error"),
        )
        return _empty_mip()


def _empty_mip():
    return {"total_consumed": 0, "total_generated": 0, "rows": []}
