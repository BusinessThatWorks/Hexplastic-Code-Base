"""API endpoints for Daily Rejection Dashboard."""

import frappe
from frappe import _
from frappe.utils import flt, getdate, get_first_day, get_last_day
from datetime import datetime, timedelta
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
        # Current month (last 30 days)
        start_date = today - timedelta(days=29)
        conditions.append(f"rejection_date >= '{start_date}'")
        conditions.append(f"rejection_date <= '{today}'")
    elif period == "Yearly":
        # Current year (last 12 months)
        start_date = today - timedelta(days=364)
        conditions.append(f"rejection_date >= '{start_date}'")
        conditions.append(f"rejection_date <= '{today}'")
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
    Get rejection percentage data for current month (30 days - daily breakdown).
    
    Args:
        shift: "Day", "Night", or "All"
        date_from: Not used for Monthly (kept for consistency)
        date_to: Not used for Monthly (kept for consistency)
    
    Returns:
        dict: {
            labels: list of day labels,
            values: list of rejection percentages per day
        }
    """
    records = get_filtered_records("Monthly", shift, date_from, date_to)
    
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
        
        # Create label: "MMM DD"
        label = day_data["date"].strftime("%b %d")
        
        labels.append(label)
        values.append(flt(rejection_pct, 2))
    
    return {"labels": labels, "values": values}


def get_yearly_data(shift="All", date_from=None, date_to=None):
    """
    Get rejection percentage data for current year (12 months - monthly breakdown).
    
    Args:
        shift: "Day", "Night", or "All"
        date_from: Not used for Yearly (kept for consistency)
        date_to: Not used for Yearly (kept for consistency)
    
    Returns:
        dict: {
            labels: list of month names,
            values: list of rejection percentages per month
        }
    """
    records = get_filtered_records("Yearly", shift, date_from, date_to)
    
    if not records:
        return {"labels": [], "values": []}
    
    # Group by month
    monthly_data = {}
    
    for record in records:
        rejection_date = getdate(record.get("rejection_date"))
        month_key = f"{rejection_date.year}-{rejection_date.month:02d}"
        
        if month_key not in monthly_data:
            monthly_data[month_key] = {
                "year": rejection_date.year,
                "month": rejection_date.month,
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
    
    # Calculate rejection percentage per month and create labels
    labels = []
    values = []
    
    # Sort by month key
    sorted_months = sorted(monthly_data.items(), key=lambda x: (x[1]["year"], x[1]["month"]))
    
    for month_key, month_data in sorted_months:
        # Calculate weighted rejection percentage
        rejection_pct = 0.0
        if month_data["total_box_checked"] > 0:
            rejection_pct = (month_data["total_rejection"] / month_data["total_box_checked"]) * 100
        
        # Create label: "MMM YYYY"
        month_name = calendar.month_abbr[month_data["month"]]
        label = f"{month_name} {month_data['year']}"
        
        labels.append(label)
        values.append(flt(rejection_pct, 2))
    
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


