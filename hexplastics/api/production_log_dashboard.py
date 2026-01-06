"""API endpoints for Production Log Book Dashboard."""

import frappe
from frappe import _
from frappe.utils import flt, getdate, add_days


@frappe.whitelist()
def get_dashboard_data(from_date=None, to_date=None, shift=None, manufacturing_item=None):
    """
    Get all dashboard data for Production Log Book Dashboard.
    
    Args:
        from_date: Start date filter
        to_date: End date filter
        shift: Shift type filter (Day/Night/All)
        manufacturing_item: Manufacturing item filter
        
    Returns:
        dict: Dashboard data including overview, log book, entries and process loss data
    """
    try:
        filters = build_filters(from_date, to_date, shift, manufacturing_item)
        
        return {
            "overview": get_overview_data(filters),
            "log_book": get_log_book_data(filters),
            "entries": get_log_book_entries(filters),
            "process_loss": get_process_loss_data(filters)
        }
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching dashboard data")
        )
        return {
            "overview": get_empty_overview(),
            "log_book": get_empty_log_book(),
            "entries": [],
            "process_loss": {"chart_data": [], "table_data": []}
        }


def build_filters(from_date, to_date, shift, manufacturing_item):
    """Build filters dictionary for queries."""
    filters = {"docstatus": 1}  # Only submitted documents
    
    if from_date:
        filters["production_date"] = [">=", getdate(from_date)]
    
    if to_date:
        if "production_date" in filters:
            filters["production_date"] = ["between", [getdate(from_date), getdate(to_date)]]
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
        "total_manufactured_qty": 0,
        "total_net_weight": 0,
        "total_process_loss": 0,
        "total_mip_used": 0
    }


def get_empty_log_book():
    """Return empty log book data structure."""
    return {
        "total_costing": 0,
        "total_prime_used": 0,
        "total_rm_consumption": 0,
        "gross_weight": 0,
        "net_weight": 0
    }


@frappe.whitelist()
def get_overview_data(filters=None):
    """
    Get overview tab data.
    
    Returns:
        dict: {
            total_manufactured_qty: int,
            total_net_weight: float,
            total_process_loss: float,
            total_mip_used: float
        }
    """
    try:
        if isinstance(filters, str):
            filters = frappe.parse_json(filters)
        
        if not filters:
            filters = {"docstatus": 1}
        
        # Get aggregated data from Production Log Book
        data = frappe.db.sql("""
            SELECT 
                COALESCE(SUM(manufactured_qty), 0) as total_manufactured_qty,
                COALESCE(SUM(net_weight), 0) as total_net_weight,
                COALESCE(SUM(process_loss_weight), 0) as total_process_loss,
                COALESCE(SUM(mip_used), 0) as total_mip_used
            FROM `tabProduction Log Book`
            WHERE docstatus = 1
                {date_filter}
                {shift_filter}
                {item_filter}
        """.format(
            date_filter=get_date_filter_sql(filters),
            shift_filter=get_shift_filter_sql(filters),
            item_filter=get_item_filter_sql(filters)
        ), as_dict=True)
        
        if data and len(data) > 0:
            return {
                "total_manufactured_qty": flt(data[0].get("total_manufactured_qty", 0)),
                "total_net_weight": flt(data[0].get("total_net_weight", 0), 2),
                "total_process_loss": flt(data[0].get("total_process_loss", 0), 2),
                "total_mip_used": flt(data[0].get("total_mip_used", 0), 2)
            }
        
        return get_empty_overview()
        
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching overview data")
        )
        return get_empty_overview()


@frappe.whitelist()
def get_log_book_data(filters=None):
    """
    Get log book tab data.
    
    Returns:
        dict: {
            total_costing: float,
            total_prime_used: float,
            total_rm_consumption: float,
            gross_weight: float,
            net_weight: float
        }
    """
    try:
        if isinstance(filters, str):
            filters = frappe.parse_json(filters)
        
        if not filters:
            filters = {"docstatus": 1}
        
        # Get aggregated data
        data = frappe.db.sql("""
            SELECT 
                COALESCE(SUM(gross_weight), 0) as gross_weight,
                COALESCE(SUM(net_weight), 0) as net_weight
            FROM `tabProduction Log Book`
            WHERE docstatus = 1
                {date_filter}
                {shift_filter}
                {item_filter}
        """.format(
            date_filter=get_date_filter_sql(filters),
            shift_filter=get_shift_filter_sql(filters),
            item_filter=get_item_filter_sql(filters)
        ), as_dict=True)
        
        # Calculate total consumption (prime used) from child table
        consumption_data = frappe.db.sql("""
            SELECT 
                COALESCE(SUM(plt.consumption), 0) as total_consumption
            FROM `tabProduction Log Book Table` plt
            INNER JOIN `tabProduction Log Book` pl ON plt.parent = pl.name
            WHERE pl.docstatus = 1
                {date_filter}
                {shift_filter}
                {item_filter}
        """.format(
            date_filter=get_date_filter_sql(filters, "pl"),
            shift_filter=get_shift_filter_sql(filters, "pl"),
            item_filter=get_item_filter_sql(filters, "pl")
        ), as_dict=True)
        
        # Calculate total RM consumption (only Raw Materials - item_type = 'BOM Item')
        rm_consumption_data = frappe.db.sql("""
            SELECT 
                COALESCE(SUM(plt.consumption), 0) as total_rm_consumption
            FROM `tabProduction Log Book Table` plt
            INNER JOIN `tabProduction Log Book` pl ON plt.parent = pl.name
            WHERE pl.docstatus = 1
                AND plt.item_type = 'BOM Item'
                {date_filter}
                {shift_filter}
                {item_filter}
        """.format(
            date_filter=get_date_filter_sql(filters, "pl"),
            shift_filter=get_shift_filter_sql(filters, "pl"),
            item_filter=get_item_filter_sql(filters, "pl")
        ), as_dict=True)
        
        gross_weight = flt(data[0].get("gross_weight", 0), 2) if data else 0
        net_weight = flt(data[0].get("net_weight", 0), 2) if data else 0
        total_consumption = flt(consumption_data[0].get("total_consumption", 0), 2) if consumption_data else 0
        total_rm_consumption = flt(rm_consumption_data[0].get("total_rm_consumption", 0), 2) if rm_consumption_data else 0
        
        # Calculate costing (simplified - can be enhanced based on requirements)
        # For now, using net_weight as a proxy for costing
        total_costing = net_weight
        
        return {
            "total_costing": total_costing,
            "total_prime_used": total_consumption,
            "total_rm_consumption": total_rm_consumption,
            "gross_weight": gross_weight,
            "net_weight": net_weight
        }
        
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching log book data")
        )
        return get_empty_log_book()


@frappe.whitelist()
def get_log_book_entries(filters=None):
    """
    Get log book entries for the table view.
    
    Returns:
        list: List of log book entries with required columns
    """
    try:
        if isinstance(filters, str):
            filters = frappe.parse_json(filters)
        
        if not filters:
            filters = {"docstatus": 1}
        
        entries = frappe.db.sql("""
            SELECT 
                pl.name as production_log_book_id,
                pl.production_date,
                pl.shift_type,
                pl.manufacturing_item,
                pl.manufactured_qty,
                pl.net_weight,
                pl.mip_used,
                pl.process_loss_weight,
                (
                    SELECT COALESCE(SUM(consumption), 0) 
                    FROM `tabProduction Log Book Table` 
                    WHERE parent = pl.name
                ) as total_consumption,
                (
                    SELECT COALESCE(SUM(consumption), 0) 
                    FROM `tabProduction Log Book Table` 
                    WHERE parent = pl.name AND item_type = 'BOM Item'
                ) as prime_used
            FROM `tabProduction Log Book` pl
            WHERE pl.docstatus = 1
                {date_filter}
                {shift_filter}
                {item_filter}
            ORDER BY pl.production_date DESC, pl.production_time DESC
            LIMIT 100
        """.format(
            date_filter=get_date_filter_sql(filters, "pl"),
            shift_filter=get_shift_filter_sql(filters, "pl"),
            item_filter=get_item_filter_sql(filters, "pl")
        ), as_dict=True)
        
        # Calculate per piece rate
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
            title=_("Error fetching log book entries")
        )
        return []


@frappe.whitelist()
def get_process_loss_data(filters=None):
    """
    Get process loss data for chart and table.
    
    Returns:
        dict: {
            chart_data: list of {date, day_weight, night_weight},
            table_data: list of {date, shift_type, weight}
        }
    """
    try:
        if isinstance(filters, str):
            filters = frappe.parse_json(filters)
        
        if not filters:
            filters = {"docstatus": 1}
        
        # Get process loss data grouped by date and shift
        data = frappe.db.sql("""
            SELECT 
                production_date as date,
                shift_type,
                COALESCE(SUM(process_loss_weight), 0) as weight
            FROM `tabProduction Log Book`
            WHERE docstatus = 1
                {date_filter}
                {shift_filter}
                {item_filter}
            GROUP BY production_date, shift_type
            ORDER BY production_date ASC
        """.format(
            date_filter=get_date_filter_sql(filters),
            shift_filter=get_shift_filter_sql(filters),
            item_filter=get_item_filter_sql(filters)
        ), as_dict=True)
        
        # Prepare table data
        table_data = []
        for row in data:
            table_data.append({
                "date": row.get("date"),
                "shift_type": row.get("shift_type"),
                "weight": flt(row.get("weight", 0), 2)
            })
        
        # Prepare chart data (grouped by date with day/night comparison)
        chart_data_map = {}
        for row in data:
            date_str = str(row.get("date"))
            if date_str not in chart_data_map:
                chart_data_map[date_str] = {
                    "date": date_str,
                    "day_weight": 0,
                    "night_weight": 0
                }
            
            shift = row.get("shift_type", "").lower()
            weight = flt(row.get("weight", 0), 2)
            
            if shift == "day":
                chart_data_map[date_str]["day_weight"] = weight
            elif shift == "night":
                chart_data_map[date_str]["night_weight"] = weight
            elif shift == "both":
                # Split evenly for "Both" shift
                chart_data_map[date_str]["day_weight"] += weight / 2
                chart_data_map[date_str]["night_weight"] += weight / 2
        
        chart_data = list(chart_data_map.values())
        chart_data.sort(key=lambda x: x["date"])
        
        return {
            "chart_data": chart_data,
            "table_data": table_data
        }
        
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching process loss data")
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
def get_filter_options():
    """
    Get filter dropdown options.
    
    Returns:
        dict: {
            shifts: list of shift options,
            items: list of manufacturing items
        }
    """
    try:
        # Get unique manufacturing items from Production Log Book
        items = frappe.db.sql("""
            SELECT DISTINCT manufacturing_item
            FROM `tabProduction Log Book`
            WHERE manufacturing_item IS NOT NULL 
                AND manufacturing_item != ''
                AND docstatus = 1
            ORDER BY manufacturing_item
        """, as_dict=True)
        
        return {
            "shifts": ["All", "Day", "Night"],
            "items": [item.get("manufacturing_item") for item in items]
        }
        
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching filter options")
        )
        return {"shifts": ["All", "Day", "Night"], "items": []}

