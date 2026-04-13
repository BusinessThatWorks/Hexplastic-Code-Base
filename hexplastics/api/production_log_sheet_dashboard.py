"""API endpoints for Production Log Sheet Dashboard."""

import frappe
from frappe import _
from frappe.utils import flt, getdate


@frappe.whitelist()
def get_dashboard_data(
    from_date=None, to_date=None, shift=None, manufacturing_item=None, grade=None
):
    """Get all dashboard data for Production Log Sheet Dashboard."""
    try:
        filters = build_filters(
            from_date, to_date, shift, manufacturing_item, grade=grade
        )

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


def build_filters(from_date, to_date, shift, manufacturing_item, grade=None):
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

    if grade:
        g = normalize_bom_grade(grade)
        if g:
            filters["grade"] = g

    return filters


def normalize_bom_grade(val):
    """Canonical BOM grade for dashboard: treat hyphen and underscore as the same (e.g. G-4 == G_4); display uses underscores."""
    if val is None:
        return ""
    s = str(val).strip()
    if not s:
        return ""
    return s.replace("-", "_")


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

        # Totals: gross / net weight from Finished Good Details (child table), not parent.
        data = frappe.db.sql(
            """
            SELECT
                COALESCE(SUM(COALESCE(fg_w.gross_weight_sum, 0)), 0) AS total_standard_weight,
                COALESCE(SUM(COALESCE(fg_w.net_weight_sum, 0)), 0) AS total_net_weight,
                COALESCE(SUM(pls.process_loss_weight), 0) AS total_process_loss,
                COALESCE(SUM(pls.mip_used), 0) AS total_mip_used
            FROM `tabProduction Log Sheet` pls
            {fg_join}
            WHERE pls.docstatus = 1
                {date_filter}
                {shift_filter}
                {item_filter}
                {grade_filter}
        """.format(
                fg_join=_fg_weights_join_sql(filters),
                date_filter=get_date_filter_sql(filters, "pls"),
                shift_filter=get_shift_filter_sql(filters, "pls"),
                item_filter=get_item_filter_sql(filters, "pls"),
                grade_filter=get_grade_filter_sql(filters, "pls"),
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

        # Gross / net weight from Finished Good Details child table
        data = frappe.db.sql(
            """
            SELECT
                COALESCE(SUM(COALESCE(fg_w.gross_weight_sum, 0)), 0) AS gross_weight,
                COALESCE(SUM(COALESCE(fg_w.net_weight_sum, 0)), 0) AS net_weight,
                COALESCE(SUM(pls.total_rm_consumption), 0) AS total_rm_consumption
            FROM `tabProduction Log Sheet` pls
            {fg_join}
            WHERE pls.docstatus = 1
                {date_filter}
                {shift_filter}
                {item_filter}
                {grade_filter}
        """.format(
                fg_join=_fg_weights_join_sql(filters),
                date_filter=get_date_filter_sql(filters, "pls"),
                shift_filter=get_shift_filter_sql(filters, "pls"),
                item_filter=get_item_filter_sql(filters, "pls"),
                grade_filter=get_grade_filter_sql(filters, "pls"),
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
                {grade_filter}
        """.format(
                date_filter=get_date_filter_sql(filters, "pls"),
                shift_filter=get_shift_filter_sql(filters, "pls"),
                item_filter=get_item_filter_sql(filters, "pls"),
                grade_filter=get_grade_filter_sql(filters, "pls"),
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

        fgd_item_filter = ""
        if filters.get("manufacturing_item"):
            fgd_item_filter = (
                " AND fgd.manufacturing_item = "
                f"{frappe.db.escape(filters.get('manufacturing_item'))}"
            )

        fgd_grade_filter = "1=1"
        if filters.get("grade"):
            fgd_grade_filter = (
                "REPLACE(TRIM(IFNULL(fgd.bom_name, '')), '-', '_') = "
                f"{frappe.db.escape(filters.get('grade'))}"
            )

        # One row per Production Log Sheet. Grade (bom_name) is the same for all FG rows;
        # show once via MAX. Manufactured qty / net weight are summed across Finished Good Details.
        entries = frappe.db.sql(
            """
            SELECT
                pls.name AS production_log_book_id,
                pls.production_date,
                pls.shift_type,
                NULLIF(TRIM(MAX(REPLACE(TRIM(fgd.bom_name), '-', '_'))), '') AS grade,
                COALESCE(SUM(fgd.manufactured_qty), 0) AS manufactured_qty,
                COALESCE(SUM(fgd.net_weight), 0) AS net_weight,
                COALESCE(pls.total_production_weight, 0) AS total_production_weight,
                pls.mip_used,
                pls.process_loss_weight,
                COALESCE(pls.total_rm_consumption, 0) AS total_consumption
            FROM `tabProduction Log Sheet` pls
            INNER JOIN `tabProduction Log Sheet FG Details Table` fgd
                ON fgd.parent = pls.name
                AND fgd.parenttype = 'Production Log Sheet'
                AND fgd.parentfield = 'table_foun'
                AND ({fgd_grade_filter})
            WHERE pls.docstatus = 1
                {date_filter}
                {shift_filter}
                {item_filter}
                {fgd_item_filter}
            GROUP BY
                pls.name,
                pls.production_date,
                pls.production_time,
                pls.shift_type,
                pls.total_production_weight,
                pls.mip_used,
                pls.process_loss_weight,
                pls.total_rm_consumption
            ORDER BY
                (IFNULL(TRIM(MAX(REPLACE(TRIM(fgd.bom_name), '-', '_'))), '') = '') ASC,
                TRIM(MAX(REPLACE(TRIM(fgd.bom_name), '-', '_'))) ASC,
                pls.production_date DESC,
                pls.production_time DESC
            LIMIT 100
        """.format(
                date_filter=get_date_filter_sql(filters, "pls"),
                shift_filter=get_shift_filter_sql(filters, "pls"),
                item_filter=get_item_filter_sql(filters, "pls"),
                fgd_item_filter=fgd_item_filter,
                fgd_grade_filter=fgd_grade_filter,
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
                {grade_filter}
            GROUP BY production_date, shift_type
            ORDER BY production_date ASC
        """.format(
                date_filter=get_date_filter_sql(filters),
                shift_filter=get_shift_filter_sql(filters),
                item_filter=get_item_filter_sql(filters),
                grade_filter=get_grade_filter_sql(filters, None),
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
    """Generate SQL item filter clause.

    Manufacturing item (and gross/net weight) live on Finished Good Details
    (``Production Log Sheet FG Details Table``, parentfield ``table_foun``),
    so filter with EXISTS on the child table instead of a parent column.
    """
    if not filters:
        return ""

    manufacturing_item = filters.get("manufacturing_item")
    if not manufacturing_item:
        return ""

    esc = frappe.db.escape(manufacturing_item)
    parent_ref = f"{table_alias}.name" if table_alias else "`tabProduction Log Sheet`.name"
    return (
        " AND EXISTS ("
        "SELECT 1 FROM `tabProduction Log Sheet FG Details Table` fg_mfg "
        f"WHERE fg_mfg.parent = {parent_ref} "
        "AND fg_mfg.parenttype = 'Production Log Sheet' "
        "AND fg_mfg.parentfield = 'table_foun' "
        f"AND fg_mfg.manufacturing_item = {esc}"
        ")"
    )


def get_grade_filter_sql(filters, table_alias="pls"):
    """Restrict to Production Log Sheets that have a Finished Good Details row with this grade."""
    if not filters or not filters.get("grade"):
        return ""

    esc = frappe.db.escape(filters["grade"])
    parent_ref = f"{table_alias}.name" if table_alias else "`tabProduction Log Sheet`.name"
    return (
        " AND EXISTS ("
        "SELECT 1 FROM `tabProduction Log Sheet FG Details Table` fg_grade "
        f"WHERE fg_grade.parent = {parent_ref} "
        "AND fg_grade.parenttype = 'Production Log Sheet' "
        "AND fg_grade.parentfield = 'table_foun' "
        f"AND REPLACE(TRIM(IFNULL(fg_grade.bom_name, '')), '-', '_') = {esc}"
        ")"
    )


def _fg_weights_join_sql(filters=None):
    """Subquery join: per Production Log Sheet, sum gross/net from Finished Good Details."""
    grade_clause = ""
    if filters and filters.get("grade"):
        esc = frappe.db.escape(filters["grade"])
        grade_clause = (
            " AND REPLACE(TRIM(IFNULL(bom_name, '')), '-', '_') = " + esc
        )
    return """
        LEFT JOIN (
            SELECT
                parent,
                COALESCE(SUM(gross_weight), 0) AS gross_weight_sum,
                COALESCE(SUM(net_weight), 0) AS net_weight_sum
            FROM `tabProduction Log Sheet FG Details Table`
            WHERE parenttype = 'Production Log Sheet'
                AND parentfield = 'table_foun'
                {grade_clause}
            GROUP BY parent
        ) fg_w ON fg_w.parent = pls.name
    """.format(grade_clause=grade_clause)


@frappe.whitelist()
def get_actual_vs_planned_data(filters=None):
    """
    Get actual vs planned comparison data.

    Returns:
        list: List of dicts with grade, actual_manufactured_qty, actual_rm_consumption,
              actual_fg_weight, planned_qty, planned_rm_consumption, planned_fg_weight
    """
    try:
        if isinstance(filters, str):
            filters = frappe.parse_json(filters)

        if not filters:
            filters = {"docstatus": 1}

        # Actuals grouped by grade (BOM Grade = bom_name on Finished Good Details).
        # One sub-row per Production Log Sheet, then summed by grade. RM per document once.
        fg_item_filter = ""
        if filters.get("manufacturing_item"):
            fg_item_filter = (
                " AND fg.manufacturing_item = "
                f"{frappe.db.escape(filters.get('manufacturing_item'))}"
            )

        fg_grade_filter = ""
        if filters.get("grade"):
            fg_grade_filter = (
                " AND REPLACE(TRIM(IFNULL(fg.bom_name, '')), '-', '_') = "
                f"{frappe.db.escape(filters.get('grade'))}"
            )

        actual_data = frappe.db.sql(
            """
            SELECT
                s.grade,
                COALESCE(SUM(s.manufactured_qty), 0) AS actual_manufactured_qty,
                COALESCE(SUM(s.rm_per_doc), 0) AS actual_rm_consumption,
                COALESCE(SUM(s.net_weight), 0) AS actual_fg_weight
            FROM (
                SELECT
                    NULLIF(TRIM(MAX(REPLACE(TRIM(fg.bom_name), '-', '_'))), '') AS grade,
                    pls.name AS doc_name,
                    SUM(fg.manufactured_qty) AS manufactured_qty,
                    SUM(fg.net_weight) AS net_weight,
                    MAX(pls.total_rm_consumption) AS rm_per_doc
                FROM `tabProduction Log Sheet` pls
                INNER JOIN `tabProduction Log Sheet FG Details Table` fg
                    ON fg.parent = pls.name
                    AND fg.parenttype = 'Production Log Sheet'
                    AND fg.parentfield = 'table_foun'
                WHERE pls.docstatus = 1
                    {date_filter}
                    {shift_filter}
                    {item_filter}
                    {fg_item_filter}
                    {fg_grade_filter}
                GROUP BY pls.name
            ) s
            GROUP BY s.grade
        """.format(
                date_filter=get_date_filter_sql(filters, "pls"),
                shift_filter=get_shift_filter_sql(filters, "pls"),
                item_filter=get_item_filter_sql(filters, "pls"),
                fg_item_filter=fg_item_filter,
                fg_grade_filter=fg_grade_filter,
            ),
            as_dict=True,
        )

        actual_grades_map = {}
        for row in actual_data:
            gkey = normalize_bom_grade(row.get("grade"))
            actual_grades_map[gkey] = {
                "actual_manufactured_qty": flt(
                    row.get("actual_manufactured_qty", 0), 2
                ),
                "actual_rm_consumption": flt(
                    row.get("actual_rm_consumption", 0), 2
                ),
                "actual_fg_weight": flt(row.get("actual_fg_weight", 0), 2),
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
                {grade_filter}
        """.format(
                date_filter=get_date_filter_sql(filters, "pls"),
                shift_filter=get_shift_filter_sql(filters, "pls"),
                item_filter=get_item_filter_sql(filters, "pls"),
                grade_filter=get_grade_filter_sql(filters, "pls"),
            ),
            as_dict=True,
        )

        all_plan_items = []
        for plan_row in production_plans:
            production_plan = plan_row.get("production_plan")
            if not production_plan:
                continue

            plan_items = frappe.get_all(
                "Production Plan Item",
                filters={"parent": production_plan, "docstatus": ["!=", 2]},
                fields=[
                    "item_code",
                    "planned_qty",
                    "bom_no",
                    "custom_planned_weight",
                    "custom_bom_name",
                ],
            )
            all_plan_items.extend(plan_items)

        bom_nos = {pi.get("bom_no") for pi in all_plan_items if pi.get("bom_no")}
        bom_grade_map = {}
        if bom_nos:
            for b in frappe.get_all(
                "BOM",
                filters={"name": ["in", list(bom_nos)]},
                fields=["name", "custom_bom_name"],
            ):
                bom_grade_map[b.name] = normalize_bom_grade(b.get("custom_bom_name"))

        planned_grades_map = {}
        mi_filter = filters.get("manufacturing_item")

        for plan_item in all_plan_items:
            item_code = plan_item.get("item_code")
            if not item_code:
                continue
            if mi_filter and item_code != mi_filter:
                continue

            bom_no = plan_item.get("bom_no")
            grade_key = normalize_bom_grade(plan_item.get("custom_bom_name"))
            if not grade_key and bom_no:
                grade_key = bom_grade_map.get(bom_no) or ""

            if filters.get("grade") and grade_key != filters["grade"]:
                continue

            planned_qty = flt(plan_item.get("planned_qty", 0), 2)

            if grade_key not in planned_grades_map:
                planned_grades_map[grade_key] = {
                    "planned_qty": 0,
                    "planned_rm_consumption": 0,
                    "planned_fg_weight": 0,
                }

            planned_grades_map[grade_key]["planned_qty"] += planned_qty

            planned_fg_weight = flt(plan_item.get("custom_planned_weight", 0), 2)
            planned_grades_map[grade_key]["planned_fg_weight"] += planned_fg_weight

            if bom_no:
                bom_data = frappe.db.get_value(
                    "BOM", bom_no, ["quantity", "docstatus"], as_dict=True
                )

                if not bom_data or bom_data.get("docstatus") != 1:
                    continue

                bom_quantity = flt(bom_data.get("quantity", 0), 4)

                if bom_quantity <= 0:
                    continue

                bom_items = frappe.get_all(
                    "BOM Item",
                    filters={"parent": bom_no, "docstatus": ["!=", 2]},
                    fields=["item_code", "qty"],
                )

                planned_rm_for_this_item = 0
                for bom_item in bom_items:
                    bom_item_qty = flt(bom_item.get("qty", 0), 4)

                    if bom_item_qty > 0 and bom_quantity > 0:
                        rm_consumption = (bom_item_qty / bom_quantity) * planned_qty
                        planned_rm_for_this_item += flt(rm_consumption, 4)

                planned_grades_map[grade_key]["planned_rm_consumption"] += flt(
                    planned_rm_for_this_item, 2
                )

        # Combine actual and planned data; sort by grade (blank last)
        result = []

        if filters.get("grade"):
            all_grades = {filters["grade"]}
        else:
            all_grades = set(actual_grades_map.keys()) | set(planned_grades_map.keys())

        def _grade_sort_key(g):
            return (not g, g.lower())

        for gkey in sorted(all_grades, key=_grade_sort_key):
            actual = actual_grades_map.get(gkey, {})
            planned = planned_grades_map.get(gkey, {})

            result.append(
                {
                    "grade": gkey or None,
                    "actual_manufactured_qty": actual.get("actual_manufactured_qty", 0),
                    "actual_rm_consumption": actual.get("actual_rm_consumption", 0),
                    "actual_fg_weight": actual.get("actual_fg_weight", 0),
                    "planned_qty": planned.get("planned_qty", 0),
                    "planned_rm_consumption": flt(
                        planned.get("planned_rm_consumption", 0), 2
                    ),
                    "planned_fg_weight": flt(planned.get("planned_fg_weight", 0), 2),
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
            SELECT DISTINCT fg.manufacturing_item AS manufacturing_item
            FROM `tabProduction Log Sheet FG Details Table` fg
            INNER JOIN `tabProduction Log Sheet` pls ON pls.name = fg.parent
                AND pls.docstatus = 1
            WHERE fg.parenttype = 'Production Log Sheet'
                AND fg.parentfield = 'table_foun'
                AND fg.manufacturing_item IS NOT NULL
                AND fg.manufacturing_item != ''
            ORDER BY manufacturing_item
        """,
            as_dict=True,
        )

        grades = frappe.db.sql(
            """
            SELECT DISTINCT REPLACE(TRIM(IFNULL(fg.bom_name, '')), '-', '_') AS grade
            FROM `tabProduction Log Sheet FG Details Table` fg
            INNER JOIN `tabProduction Log Sheet` pls ON pls.name = fg.parent
                AND pls.docstatus = 1
            WHERE fg.parenttype = 'Production Log Sheet'
                AND fg.parentfield = 'table_foun'
                AND IFNULL(TRIM(fg.bom_name), '') != ''
            ORDER BY grade
        """,
            as_dict=True,
        )

        grade_list = [r.get("grade") for r in grades if r.get("grade")]

        return {
            "shifts": ["All", "Day", "Night"],
            "items": [item.get("manufacturing_item") for item in items],
            "grades": grade_list,
        }

    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching Production Log Sheet filter options"),
        )
        return {"shifts": ["All", "Day", "Night"], "items": [], "grades": []}
