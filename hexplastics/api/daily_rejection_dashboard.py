"""API endpoints for Daily Rejection Dashboard."""

import frappe
from frappe import _
from frappe.utils import flt, getdate, get_first_day, get_last_day
from datetime import datetime, timedelta, date
import calendar


@frappe.whitelist()
def get_overview_metrics(period="Weekly", shift="All", date_from=None, date_to=None):
    """
    Get overview KPI metrics: Total Box Checked, Total Rejection, Rejection %.
    
    Args:
        period: "Weekly", "Monthly", "Yearly", or "Custom"
        shift: "Day", "Night", or "All"
        date_from: Start date for custom range
        date_to: End date for custom range
        
    Returns:
        dict: {
            total_box_checked: int,
            total_rejection: int,
            rejection_percentage: float
        }
    """
    try:
        # Get filtered records based on period and shift
        records = get_filtered_records(period, shift, date_from, date_to)
        
        if not records:
            return {
                "total_box_checked": 0,
                "total_rejection": 0,
                "rejection_percentage": 0.0
            }
        
        # Calculate aggregated metrics
        total_box_checked = 0
        total_rejection = 0
        
        for record in records:
            total_box_checked += flt(record.get("total_box_checked", 0))
            
            # Add shift-specific rejection
            if shift == "Day":
                total_rejection += flt(record.get("total_rejected_in_day_shift", 0))
            elif shift == "Night":
                total_rejection += flt(record.get("total_rejected_in_night_shift", 0))
            else:  # All
                total_rejection += flt(record.get("total_rejection", 0))
        
        # Calculate weighted rejection percentage
        rejection_percentage = 0.0
        if total_box_checked > 0:
            rejection_percentage = (total_rejection / total_box_checked) * 100
        
        return {
            "total_box_checked": int(total_box_checked),
            "total_rejection": int(total_rejection),
            "rejection_percentage": flt(rejection_percentage, 2)
        }
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching overview metrics")
        )
        return {
            "total_box_checked": 0,
            "total_rejection": 0,
            "rejection_percentage": 0.0
        }


@frappe.whitelist()
def get_rejection_graph_data(period="Weekly", shift="All", date_from=None, date_to=None):
    """
    Get rejection percentage trend data for graph.
    
    Args:
        period: "Weekly", "Monthly", "Yearly", or "Custom"
        shift: "Day", "Night", or "All"
        date_from: Start date for custom range
        date_to: End date for custom range
        
    Returns:
        dict: {
            labels: list of period labels,
            values: list of rejection percentages
        }
    """
    try:
        if period == "Weekly":
            return get_weekly_data(shift, date_from, date_to)
        elif period == "Monthly":
            return get_monthly_data(shift, date_from, date_to)
        elif period == "Yearly":
            return get_yearly_data(shift, date_from, date_to)
        elif period == "Custom":
            return get_custom_date_range_data(shift, date_from, date_to)
        else:
            return {"labels": [], "values": []}
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching graph data")
        )
        return {"labels": [], "values": []}


@frappe.whitelist()
def get_rejection_table_data(period="Weekly", shift="All", date_from=None, date_to=None):
    """
    Get detailed rejection table data.
    
    Args:
        period: "Weekly", "Monthly", "Yearly", or "Custom"
        shift: "Day", "Night", or "All"
        date_from: Start date for custom range
        date_to: End date for custom range
        
    Returns:
        list: List of records with detailed rejection information
    """
    try:
        records = get_filtered_records(period, shift, date_from, date_to)
        
        if not records:
            return []
        
        # Format records for table display
        table_data = []
        for record in records:
            total_box_checked = flt(record.get("total_box_checked", 0))
            day_rejection = flt(record.get("total_rejected_in_day_shift", 0))
            night_rejection = flt(record.get("total_rejected_in_night_shift", 0))
            total_rejection = flt(record.get("total_rejection", 0))
            
            # Calculate shift-specific rejection for display
            if shift == "Day":
                display_rejection = day_rejection
            elif shift == "Night":
                display_rejection = night_rejection
            else:
                display_rejection = total_rejection
            
            # Calculate rejection percentage
            rejection_pct = 0.0
            if total_box_checked > 0:
                rejection_pct = (display_rejection / total_box_checked) * 100
            
            table_data.append({
                "id": record.get("name"),
                "rejection_date": record.get("rejection_date"),
                "total_box_checked": int(total_box_checked),
                "day_shift_rejection": int(day_rejection),
                "night_shift_rejection": int(night_rejection),
                "total_rejection": int(display_rejection),
                "rejection_percentage": flt(rejection_pct, 2)
            })
        
        return table_data
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching table data")
        )
        return []


def get_current_financial_year():
    """
    Get current financial year range (April to March).
    
    Returns:
        tuple: (start_date, end_date) for current financial year
    """
    today = getdate()
    current_year = today.year
    current_month = today.month
    
    # Financial year starts in April (month 4)
    if current_month >= 4:
        # Current financial year: April current_year to March (current_year + 1)
        fy_start = date(current_year, 4, 1)
        fy_end = date(current_year + 1, 3, 31)
    else:
        # Current financial year: April (current_year - 1) to March current_year
        fy_start = date(current_year - 1, 4, 1)
        fy_end = date(current_year, 3, 31)
    
    return fy_start, fy_end


def get_filtered_records(period, shift, date_from=None, date_to=None):
    """
    Get filtered Daily Rejection Data records based on period and shift.
    
    Args:
        period: "Weekly", "Monthly", "Yearly", or "Custom"
        shift: "Day", "Night", or "All"
        date_from: Start date for custom range
        date_to: End date for custom range
        
    Returns:
        list: Filtered records
    """
    # Build base query
    query = """
        SELECT 
            name,
            rejection_date,
            total_box_checked,
            total_rejected_in_day_shift,
            total_rejected_in_night_shift,
            total_rejection,
            rejection_in_
        FROM `tabDaily Rejection Data`
        WHERE docstatus = 1
            AND rejection_date IS NOT NULL
    """
    
    # Add period filter
    conditions = []
    today = getdate()
    
    if period == "Weekly":
        # Current week (last 7 days)
        start_date = today - timedelta(days=6)
        conditions.append(f"rejection_date >= '{start_date}'")
        conditions.append(f"rejection_date <= '{today}'")
    elif period == "Monthly":
        # Current financial year (April to March)
        fy_start, fy_end = get_current_financial_year()
        conditions.append(f"rejection_date >= '{fy_start}'")
        conditions.append(f"rejection_date <= '{fy_end}'")
    elif period == "Yearly":
        # Get all records - we'll filter by year in get_yearly_data
        # No date filter here, we need to find the first year with data
        pass
    elif period == "Custom":
        # Custom date range
        if date_from:
            conditions.append(f"rejection_date >= '{date_from}'")
        if date_to:
            conditions.append(f"rejection_date <= '{date_to}'")
    
    if conditions:
        query += " AND " + " AND ".join(conditions)
    
    query += " ORDER BY rejection_date ASC"
    
    return frappe.db.sql(query, as_dict=True)


def get_weekly_data(shift="All", date_from=None, date_to=None):
    """
    Get rejection percentage data for current week (7 days - daily breakdown).
    
    Args:
        shift: "Day", "Night", or "All"
        date_from: Not used for Weekly (kept for consistency)
        date_to: Not used for Weekly (kept for consistency)
    
    Returns:
        dict: {
            labels: list of day labels,
            values: list of rejection percentages per day
        }
    """
    records = get_filtered_records("Weekly", shift, date_from, date_to)
    
    if not records:
        return {"labels": [], "values": []}
    
    # Group by day
    daily_data = {}
    
    for record in records:
        rejection_date = getdate(record.get("rejection_date"))
        date_key = str(rejection_date)
        
        if date_key not in daily_data:
            daily_data[date_key] = {
                "date": rejection_date,
                "total_box_checked": 0,
                "total_rejection": 0
            }
        
        # Aggregate totals for proper percentage calculation
        daily_data[date_key]["total_box_checked"] += flt(record.get("total_box_checked", 0))
        
        # Add shift-specific rejection
        if shift == "Day":
            daily_data[date_key]["total_rejection"] += flt(record.get("total_rejected_in_day_shift", 0))
        elif shift == "Night":
            daily_data[date_key]["total_rejection"] += flt(record.get("total_rejected_in_night_shift", 0))
        else:  # All
            daily_data[date_key]["total_rejection"] += flt(record.get("total_rejection", 0))
    
    # Calculate rejection percentage per day and create labels
    labels = []
    values = []
    
    # Sort by date
    sorted_days = sorted(daily_data.items(), key=lambda x: x[1]["date"])
    
    for date_key, day_data in sorted_days:
        # Calculate weighted rejection percentage
        rejection_pct = 0.0
        if day_data["total_box_checked"] > 0:
            rejection_pct = (day_data["total_rejection"] / day_data["total_box_checked"]) * 100
        
        # Create label: "Day Name, MMM DD"
        label = day_data["date"].strftime("%a, %b %d")
        
        labels.append(label)
        values.append(flt(rejection_pct, 2))
    
    return {"labels": labels, "values": values}


def get_monthly_data(shift="All", date_from=None, date_to=None):
    """
    Get rejection percentage data for all months of current financial year (April to March).
    
    Args:
        shift: "Day", "Night", or "All"
        date_from: Not used for Monthly (kept for consistency)
        date_to: Not used for Monthly (kept for consistency)
    
    Returns:
        dict: {
            labels: list of month labels (Apr, May, ..., Mar),
            values: list of rejection percentages per month
        }
    """
    # Get current financial year range
    fy_start, fy_end = get_current_financial_year()
    
    # Get all records for the financial year
    records = get_filtered_records("Monthly", shift, date_from, date_to)
    
    # Group by month (within financial year)
    monthly_data = {}
    
    for record in records:
        rejection_date = getdate(record.get("rejection_date"))
        # Only process records within financial year
        if rejection_date < fy_start or rejection_date > fy_end:
            continue
            
        month_key = rejection_date.month
        
        if month_key not in monthly_data:
            monthly_data[month_key] = {
                "month": month_key,
                "total_box_checked": 0,
                "total_rejection": 0
            }
        
        # Aggregate totals for proper percentage calculation
        monthly_data[month_key]["total_box_checked"] += flt(record.get("total_box_checked", 0))
        
        # Add shift-specific rejection
        if shift == "Day":
            monthly_data[month_key]["total_rejection"] += flt(record.get("total_rejected_in_day_shift", 0))
        elif shift == "Night":
            monthly_data[month_key]["total_rejection"] += flt(record.get("total_rejected_in_night_shift", 0))
        else:  # All
            monthly_data[month_key]["total_rejection"] += flt(record.get("total_rejection", 0))
    
    # Create labels and values for all 12 months in financial year order (Apr-Mar)
    labels = []
    values = []
    
    # Financial year months: April (4) to March (3)
    financial_year_months = list(range(4, 13)) + list(range(1, 4))
    
    for month_num in financial_year_months:
        # Get month abbreviation
        month_name = calendar.month_abbr[month_num]
        labels.append(month_name)
        
        # Calculate rejection percentage for this month
        if month_num in monthly_data:
            month_data = monthly_data[month_num]
            rejection_pct = 0.0
            if month_data["total_box_checked"] > 0:
                rejection_pct = (month_data["total_rejection"] / month_data["total_box_checked"]) * 100
            values.append(flt(rejection_pct, 2))
        else:
            # No data for this month - show 0
            values.append(0.0)
    
    return {"labels": labels, "values": values}


def get_yearly_data(shift="All", date_from=None, date_to=None):
    """
    Get rejection percentage data from first year with rejection data to current year (max 10 years).
    
    Args:
        shift: "Day", "Night", or "All"
        date_from: Not used for Yearly (kept for consistency)
        date_to: Not used for Yearly (kept for consistency)
    
    Returns:
        dict: {
            labels: list of year labels,
            values: list of rejection percentages per year
        }
    """
    # First, find the earliest year with rejection data
    earliest_year_query = """
        SELECT MIN(YEAR(rejection_date)) as min_year
        FROM `tabDaily Rejection Data`
        WHERE docstatus = 1
            AND rejection_date IS NOT NULL
    """
    
    earliest_result = frappe.db.sql(earliest_year_query, as_dict=True)
    if not earliest_result or not earliest_result[0].get("min_year"):
        return {"labels": [], "values": []}
    
    earliest_year = earliest_result[0]["min_year"]
    current_year = getdate().year
    
    # Limit to last 10 years
    start_year = max(earliest_year, current_year - 9)
    
    # Get all records for the year range
    query = """
        SELECT 
            name,
            rejection_date,
            total_box_checked,
            total_rejected_in_day_shift,
            total_rejected_in_night_shift,
            total_rejection,
            rejection_in_
        FROM `tabDaily Rejection Data`
        WHERE docstatus = 1
            AND rejection_date IS NOT NULL
            AND YEAR(rejection_date) >= %s
            AND YEAR(rejection_date) <= %s
        ORDER BY rejection_date ASC
    """
    
    records = frappe.db.sql(query, (start_year, current_year), as_dict=True)
    
    if not records:
        return {"labels": [], "values": []}
    
    # Group by year
    yearly_data = {}
    
    for record in records:
        rejection_date = getdate(record.get("rejection_date"))
        year_key = rejection_date.year
        
        if year_key not in yearly_data:
            yearly_data[year_key] = {
                "year": year_key,
                "total_box_checked": 0,
                "total_rejection": 0
            }
        
        # Aggregate totals for proper percentage calculation
        yearly_data[year_key]["total_box_checked"] += flt(record.get("total_box_checked", 0))
        
        # Add shift-specific rejection
        if shift == "Day":
            yearly_data[year_key]["total_rejection"] += flt(record.get("total_rejected_in_day_shift", 0))
        elif shift == "Night":
            yearly_data[year_key]["total_rejection"] += flt(record.get("total_rejected_in_night_shift", 0))
        else:  # All
            yearly_data[year_key]["total_rejection"] += flt(record.get("total_rejection", 0))
    
    # Create labels and values for all years from start_year to current_year
    labels = []
    values = []
    
    for year in range(start_year, current_year + 1):
        labels.append(str(year))
        
        # Calculate rejection percentage for this year
        if year in yearly_data:
            year_data = yearly_data[year]
            rejection_pct = 0.0
            if year_data["total_box_checked"] > 0:
                rejection_pct = (year_data["total_rejection"] / year_data["total_box_checked"]) * 100
            values.append(flt(rejection_pct, 2))
        else:
            # No data for this year - show 0
            values.append(0.0)
    
    return {"labels": labels, "values": values}


def get_custom_date_range_data(shift="All", date_from=None, date_to=None):
    """
    Get rejection percentage data for custom date range (daily breakdown).
    
    Args:
        shift: "Day", "Night", or "All"
        date_from: Start date
        date_to: End date
    
    Returns:
        dict: {
            labels: list of day labels,
            values: list of rejection percentages per day
        }
    """
    if not date_from or not date_to:
        return {"labels": [], "values": []}
    
    records = get_filtered_records("Custom", shift, date_from, date_to)
    
    if not records:
        return {"labels": [], "values": []}
    
    # Group by day
    daily_data = {}
    
    for record in records:
        rejection_date = getdate(record.get("rejection_date"))
        date_key = str(rejection_date)
        
        if date_key not in daily_data:
            daily_data[date_key] = {
                "date": rejection_date,
                "total_box_checked": 0,
                "total_rejection": 0
            }
        
        # Aggregate totals for proper percentage calculation
        daily_data[date_key]["total_box_checked"] += flt(record.get("total_box_checked", 0))
        
        # Add shift-specific rejection
        if shift == "Day":
            daily_data[date_key]["total_rejection"] += flt(record.get("total_rejected_in_day_shift", 0))
        elif shift == "Night":
            daily_data[date_key]["total_rejection"] += flt(record.get("total_rejected_in_night_shift", 0))
        else:  # All
            daily_data[date_key]["total_rejection"] += flt(record.get("total_rejection", 0))
    
    # Calculate rejection percentage per day and create labels
    labels = []
    values = []
    
    # Sort by date
    sorted_days = sorted(daily_data.items(), key=lambda x: x[1]["date"])
    
    for date_key, day_data in sorted_days:
        # Calculate weighted rejection percentage
        rejection_pct = 0.0
        if day_data["total_box_checked"] > 0:
            rejection_pct = (day_data["total_rejection"] / day_data["total_box_checked"]) * 100
        
        # Create label: "MMM DD, YYYY"
        label = day_data["date"].strftime("%b %d, %Y")
        
        labels.append(label)
        values.append(flt(rejection_pct, 2))
    
    return {"labels": labels, "values": values}


