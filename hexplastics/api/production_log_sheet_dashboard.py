"""API endpoints for Production Log Sheet Dashboard."""

import frappe
from frappe import _
from frappe.utils import flt, getdate


@frappe.whitelist()
def get_dashboard_data(
    from_date=None, to_date=None, shift=None, manufacturing_item=None
):
    """Get all dashboard data for Production Log Sheet Dashboard."""
    try:
        filters = build_filters(from_date, to_date, shift, manufacturing_item)

        return {
            "overview": get_overview_data(filters),
            "log_book": get_log_book_data(filters),
            "entries": get_log_book_entries(filters),
            "process_loss": get_process_loss_data(filters),
            "actual_vs_planned": get_actual_vs_planned_data(filters),
        }
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching Production Log Sheet dashboard data"),
        )
        return {
            "overview": get_empty_overview(),
            "log_book": get_empty_log_book(),
            "entries": [],
            "process_loss": {"chart_data": [], "table_data": []},
            "actual_vs_planned": [],
        }


def build_filters(from_date, to_date, shift, manufacturing_item):
    """Build filters dictionary for queries."""
    filters = {"docstatus": 1}  # Only submitted documents

    if from_date:
        filters["production_date"] = [">=", getdate(from_date)]

    if to_date:
        if "production_date" in filters:
            filters["production_date"] = [
                "between",
                [getdate(from_date), getdate(to_date)],
            ]
        else:
            filters["production_date"] = ["<=", getdate(to_date)]

    if shift and shift != "All":
        filters["shift_type"] = shift

    if manufacturing_item:
        filters["manufacturing_item"] = manufacturing_item

    return filters


def get_empty_overview():
    """Return empty overview data structure."""
    return {
        "total_standard_weight": 0,
        "total_net_weight": 0,
        "total_process_loss": 0,
        "total_mip_used": 0,
    }


def get_empty_log_book():
    """Return empty log book data structure."""
    return {
        "total_costing": 0,
        "total_prime_used": 0,
        "total_rm_consumption": 0,
        "gross_weight": 0,
        "net_weight": 0,
    }


@frappe.whitelist()
def get_overview_data(filters=None):
    """
    Get overview tab data using Production Log Sheet.
    """
    try:
        if isinstance(filters, str):
            filters = frappe.parse_json(filters)

        if not filters:
            filters = {"docstatus": 1}

        # Calculate totals from Production Log Sheet
        data = frappe.db.sql(
            """
            SELECT
                COALESCE(SUM(pls.manufactured_qty * COALESCE(i.weight_per_unit, 0)), 0) AS total_standard_weight,
                COALESCE(SUM(pls.net_weight), 0) AS total_net_weight,
                COALESCE(SUM(pls.process_loss_weight), 0) AS total_process_loss,
                COALESCE(SUM(pls.mip_used), 0) AS total_mip_used
            FROM `tabProduction Log Sheet` pls
            LEFT JOIN `tabItem` i ON pls.manufacturing_item = i.name
            WHERE pls.docstatus = 1
                {date_filter}
                {shift_filter}
                {item_filter}
        """.format(
                date_filter=get_date_filter_sql(filters, "pls"),
                shift_filter=get_shift_filter_sql(filters, "pls"),
                item_filter=get_item_filter_sql(filters, "pls"),
            ),
            as_dict=True,
        )

        if data and len(data) > 0:
            return {
                "total_standard_weight": flt(
                    data[0].get("total_standard_weight", 0), 2
                ),
                "total_net_weight": flt(data[0].get("total_net_weight", 0), 2),
                "total_process_loss": flt(data[0].get("total_process_loss", 0), 2),
                "total_mip_used": flt(data[0].get("total_mip_used", 0), 2),
            }

        return get_empty_overview()

    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching Production Log Sheet overview data"),
        )
        return get_empty_overview()


@frappe.whitelist()
def get_log_book_data(filters=None):
    """
    Get log book tab data using Production Log Sheet.
    """
    try:
        if isinstance(filters, str):
            filters = frappe.parse_json(filters)

        if not filters:
            filters = {"docstatus": 1}

        # Aggregates available directly on Production Log Sheet
        data = frappe.db.sql(
            """
            SELECT
                COALESCE(SUM(pls.gross_weight), 0) AS gross_weight,
                COALESCE(SUM(pls.net_weight), 0) AS net_weight,
                COALESCE(SUM(pls.total_rm_consumption), 0) AS total_rm_consumption
            FROM `tabProduction Log Sheet` pls
            WHERE pls.docstatus = 1
                {date_filter}
                {shift_filter}
                {item_filter}
        """.format(
                date_filter=get_date_filter_sql(filters, "pls"),
                shift_filter=get_shift_filter_sql(filters, "pls"),
                item_filter=get_item_filter_sql(filters, "pls"),
            ),
            as_dict=True,
        )

        gross_weight = flt(data[0].get("gross_weight", 0), 2) if data else 0
        net_weight = flt(data[0].get("net_weight", 0), 2) if data else 0
        total_rm_consumption = (
            flt(data[0].get("total_rm_consumption", 0), 2) if data else 0
        )

        # Prime used does not exist on Production Log Sheet; keep card but set to 0
        total_prime_used = 0

        # Get total costing from linked Stock Entry (total_outgoing_value = cost of raw materials consumed)
        costing_data = frappe.db.sql(
            """
            SELECT
                COALESCE(SUM(se.total_outgoing_value), 0) AS total_costing
            FROM `tabProduction Log Sheet` pls
            INNER JOIN `tabStock Entry` se ON se.name = pls.stock_entry_no
            WHERE pls.docstatus = 1
                AND se.docstatus = 1
                AND pls.stock_entry_no IS NOT NULL
                {date_filter}
                {shift_filter}
                {item_filter}
        """.format(
                date_filter=get_date_filter_sql(filters, "pls"),
                shift_filter=get_shift_filter_sql(filters, "pls"),
                item_filter=get_item_filter_sql(filters, "pls"),
            ),
            as_dict=True,
        )

        total_costing = (
            flt(costing_data[0].get("total_costing", 0), 2) if costing_data else 0
        )

        return {
            "total_costing": total_costing,
            "total_prime_used": total_prime_used,
            "total_rm_consumption": total_rm_consumption,
            "gross_weight": gross_weight,
            "net_weight": net_weight,
        }

    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching Production Log Sheet log book data"),
        )
        return get_empty_log_book()


@frappe.whitelist()
def get_log_book_entries(filters=None):
    """
    Get log sheet entries for the table view.
    """
    try:
        if isinstance(filters, str):
            filters = frappe.parse_json(filters)

        if not filters:
            filters = {"docstatus": 1}

        entries = frappe.db.sql(
            """
            SELECT
                pls.name AS production_log_book_id,
                pls.production_date,
                pls.shift_type,
                pls.manufacturing_item,
                pls.manufactured_qty,
                pls.net_weight,
                pls.mip_used,
                pls.process_loss_weight,
                COALESCE(pls.total_rm_consumption, 0) AS total_consumption,
                0 AS prime_used
            FROM `tabProduction Log Sheet` pls
            WHERE pls.docstatus = 1
                {date_filter}
                {shift_filter}
                {item_filter}
            ORDER BY pls.production_date DESC, pls.production_time DESC
            LIMIT 100
        """.format(
                date_filter=get_date_filter_sql(filters, "pls"),
                shift_filter=get_shift_filter_sql(filters, "pls"),
                item_filter=get_item_filter_sql(filters, "pls"),
            ),
            as_dict=True,
        )

        for entry in entries:
            manufactured_qty = flt(entry.get("manufactured_qty", 0))
            net_weight = flt(entry.get("net_weight", 0))

            if manufactured_qty > 0:
                entry["per_piece_rate"] = flt(net_weight / manufactured_qty, 4)
            else:
                entry["per_piece_rate"] = 0

        return entries

    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching Production Log Sheet entries"),
        )
        return []


@frappe.whitelist()
def get_process_loss_data(filters=None):
    """
    Get process loss data for chart and table using Production Log Sheet.
    """
    try:
        if isinstance(filters, str):
            filters = frappe.parse_json(filters)

        if not filters:
            filters = {"docstatus": 1}

        data = frappe.db.sql(
            """
            SELECT
                production_date AS date,
                shift_type,
                COALESCE(SUM(process_loss_weight), 0) AS weight
            FROM `tabProduction Log Sheet`
            WHERE docstatus = 1
                {date_filter}
                {shift_filter}
                {item_filter}
            GROUP BY production_date, shift_type
            ORDER BY production_date ASC
        """.format(
                date_filter=get_date_filter_sql(filters),
                shift_filter=get_shift_filter_sql(filters),
                item_filter=get_item_filter_sql(filters),
            ),
            as_dict=True,
        )

        table_data = []
        for row in data:
            table_data.append(
                {
                    "date": row.get("date"),
                    "shift_type": row.get("shift_type"),
                    "weight": flt(row.get("weight", 0), 2),
                }
            )

        chart_data_map = {}
        for row in data:
            date_str = str(row.get("date"))
            if date_str not in chart_data_map:
                chart_data_map[date_str] = {
                    "date": date_str,
                    "day_weight": 0,
                    "night_weight": 0,
                }

            shift = (row.get("shift_type") or "").lower()
            weight = flt(row.get("weight", 0), 2)

            if shift == "day":
                chart_data_map[date_str]["day_weight"] = weight
            elif shift == "night":
                chart_data_map[date_str]["night_weight"] = weight
            elif shift == "both":
                chart_data_map[date_str]["day_weight"] += weight / 2
                chart_data_map[date_str]["night_weight"] += weight / 2

        chart_data = list(chart_data_map.values())
        chart_data.sort(key=lambda x: x["date"])

        return {"chart_data": chart_data, "table_data": table_data}

    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching Production Log Sheet process loss data"),
        )
        return {"chart_data": [], "table_data": []}


def get_date_filter_sql(filters, table_alias=None):
    """Generate SQL date filter clause."""
    prefix = f"{table_alias}." if table_alias else ""

    if not filters:
        return ""

    date_filter = filters.get("production_date")
    if not date_filter:
        return ""

    if isinstance(date_filter, list):
        if date_filter[0] == "between" and len(date_filter) > 1:
            dates = date_filter[1]
            if isinstance(dates, list) and len(dates) >= 2:
                return f" AND {prefix}production_date BETWEEN '{dates[0]}' AND '{dates[1]}'"
        elif date_filter[0] == ">=" and len(date_filter) > 1:
            return f" AND {prefix}production_date >= '{date_filter[1]}'"
        elif date_filter[0] == "<=" and len(date_filter) > 1:
            return f" AND {prefix}production_date <= '{date_filter[1]}'"

    return ""


def get_shift_filter_sql(filters, table_alias=None):
    """Generate SQL shift filter clause."""
    prefix = f"{table_alias}." if table_alias else ""

    if not filters:
        return ""

    shift_type = filters.get("shift_type")
    if shift_type:
        return f" AND {prefix}shift_type = '{shift_type}'"

    return ""


def get_item_filter_sql(filters, table_alias=None):
    """Generate SQL item filter clause."""
    prefix = f"{table_alias}." if table_alias else ""

    if not filters:
        return ""

    manufacturing_item = filters.get("manufacturing_item")
    if manufacturing_item:
        return f" AND {prefix}manufacturing_item = '{manufacturing_item}'"

    return ""


@frappe.whitelist()
def get_actual_vs_planned_data(filters=None):
    """
    Get actual vs planned comparison data.

    Returns:
        list: List of dicts with item, actual_manufactured_qty, actual_rm_consumption,
              planned_qty, planned_rm_consumption
    """
    try:
        if isinstance(filters, str):
            filters = frappe.parse_json(filters)

        if not filters:
            filters = {"docstatus": 1}

        # Get actual data from Production Log Sheet grouped by item
        # Actual Manufactured Qty is taken from Production Log Sheet FG Table (child table)
        # Actual Raw Material Consumption is taken from header field total_rm_consumption
        actual_data = frappe.db.sql(
            """
            SELECT
                pls.manufacturing_item AS item,
                COALESCE(SUM(fg.manufactured_qty), 0) AS actual_manufactured_qty,
                COALESCE(SUM(pls.total_rm_consumption), 0) AS actual_rm_consumption
            FROM `tabProduction Log Sheet` pls
            LEFT JOIN `tabProduction Log Sheet FG Table` fg
                ON fg.parent = pls.name
                AND fg.item_code = pls.manufacturing_item
            WHERE pls.docstatus = 1
                {date_filter}
                {shift_filter}
                {item_filter}
            GROUP BY pls.manufacturing_item
        """.format(
                date_filter=get_date_filter_sql(filters, "pls"),
                shift_filter=get_shift_filter_sql(filters, "pls"),
                item_filter=get_item_filter_sql(filters, "pls"),
            ),
            as_dict=True,
        )

        # Build item set from actual data
        actual_items_map = {}
        for row in actual_data:
            item = row.get("item")
            if item:
                actual_items_map[item] = {
                    "actual_manufactured_qty": flt(
                        row.get("actual_manufactured_qty", 0), 2
                    ),
                    "actual_rm_consumption": flt(
                        row.get("actual_rm_consumption", 0), 2
                    ),
                }

        # Get planned data from Production Plan
        # First, get all Production Plans linked to Production Log Sheets in the filter range
        production_plans = frappe.db.sql(
            """
            SELECT DISTINCT pls.production_plan
            FROM `tabProduction Log Sheet` pls
            WHERE pls.docstatus = 1
                AND pls.production_plan IS NOT NULL
                {date_filter}
                {shift_filter}
                {item_filter}
        """.format(
                date_filter=get_date_filter_sql(filters, "pls"),
                shift_filter=get_shift_filter_sql(filters, "pls"),
                item_filter=get_item_filter_sql(filters, "pls"),
            ),
            as_dict=True,
        )

        planned_items_map = {}

        for plan_row in production_plans:
            production_plan = plan_row.get("production_plan")
            if not production_plan:
                continue

            # Get Production Plan Items (planned quantities)
            plan_items = frappe.get_all(
                "Production Plan Item",
                filters={"parent": production_plan, "docstatus": ["!=", 2]},
                fields=["item_code", "planned_qty", "bom_no"],
            )

            for plan_item in plan_items:
                item_code = plan_item.get("item_code")
                if not item_code:
                    continue

                planned_qty = flt(plan_item.get("planned_qty", 0), 2)
                bom_no = plan_item.get("bom_no")

                # Initialize if not exists
                if item_code not in planned_items_map:
                    planned_items_map[item_code] = {
                        "planned_qty": 0,
                        "planned_rm_consumption": 0,
                    }

                # Add planned quantity
                planned_items_map[item_code]["planned_qty"] += planned_qty

                # Get raw material consumption from BOM
                if bom_no:
                    bom_items = frappe.get_all(
                        "BOM Item",
                        filters={"parent": bom_no, "docstatus": ["!=", 2]},
                        fields=["item_code", "qty"],
                    )

                    # Calculate total RM consumption for this BOM per unit
                    # Sum all raw material quantities from BOM
                    bom_rm_per_unit = 0
                    for bom_item in bom_items:
                        bom_rm_per_unit += flt(bom_item.get("qty", 0), 4)

                    # Multiply by planned quantity to get total planned RM consumption for this item
                    planned_rm_for_this_item = bom_rm_per_unit * planned_qty
                    planned_items_map[item_code][
                        "planned_rm_consumption"
                    ] += planned_rm_for_this_item

        # Combine actual and planned data
        result = []

        # Get all unique items (from both actual and planned)
        all_items = set(list(actual_items_map.keys()) + list(planned_items_map.keys()))

        for item in sorted(all_items):
            actual = actual_items_map.get(item, {})
            planned = planned_items_map.get(item, {})

            result.append(
                {
                    "item": item,
                    "actual_manufactured_qty": actual.get("actual_manufactured_qty", 0),
                    "actual_rm_consumption": actual.get("actual_rm_consumption", 0),
                    "planned_qty": planned.get("planned_qty", 0),
                    "planned_rm_consumption": flt(
                        planned.get("planned_rm_consumption", 0), 2
                    ),
                }
            )

        return result

    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching actual vs planned data"),
        )
        return []


@frappe.whitelist()
def get_filter_options():
    """
    Get filter dropdown options using Production Log Sheet.
    """
    try:
        items = frappe.db.sql(
            """
            SELECT DISTINCT manufacturing_item
            FROM `tabProduction Log Sheet`
            WHERE manufacturing_item IS NOT NULL
                AND manufacturing_item != ''
                AND docstatus = 1
            ORDER BY manufacturing_item
        """,
            as_dict=True,
        )

        return {
            "shifts": ["All", "Day", "Night"],
            "items": [item.get("manufacturing_item") for item in items],
        }

    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching Production Log Sheet filter options"),
        )
        return {"shifts": ["All", "Day", "Night"], "items": []}
