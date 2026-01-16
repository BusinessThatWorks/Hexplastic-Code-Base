"""API endpoints for Customer Dashboard."""

import frappe
from frappe import _
from frappe.utils import flt, getdate
from datetime import date, datetime
import calendar


@frappe.whitelist()
def get_customer_turnover_data(state=None, customer=None, item=None, year=None, mode="Quantity"):
    """
    Get customer-wise turnover data by financial month.
    
    Args:
        state: Place of Supply filter
        customer: Customer filter
        item: Item Code filter
        year: Fiscal Year name (e.g., "25-26")
        mode: "Quantity" or "Value"
        
    Returns:
        dict: {
            months: list of month labels (Apr 2025, May 2025, ...),
            data: list of {
                customer: str,
                months: dict of {month_key: value},
                total: float
            },
            grand_totals: dict of {month_key: total_value}
        }
    """
    try:
        # Get financial year dates - year is now required (no default to "All")
        if year:
            fy_start, fy_end = get_fiscal_year_dates(year)
        else:
            # If no year provided, use current fiscal year
            fy_start, fy_end = get_current_financial_year()
        
        # Generate all financial year months
        financial_months = get_financial_year_months(fy_start, fy_end)
        month_labels = [m["label"] for m in financial_months]
        month_keys = [m["key"] for m in financial_months]
        
        # Build filters
        state_filter = get_state_filter_sql(state)
        customer_filter = get_customer_filter_sql(customer)
        item_filter = get_item_filter_sql(item)
        
        # Query Sales Invoice Items with filters
        # Only submitted invoices (docstatus = 1), exclude cancelled
        query = """
            SELECT 
                si.customer,
                si.posting_date,
                sii.item_code,
                sii.qty,
                COALESCE(sii.base_amount, sii.amount, sii.base_net_amount, sii.net_amount, 0) as amount
            FROM `tabSales Invoice` si
            INNER JOIN `tabSales Invoice Item` sii ON sii.parent = si.name
            WHERE si.docstatus = 1
                AND si.posting_date >= %s
                AND si.posting_date <= %s
                {state_filter}
                {customer_filter}
                {item_filter}
        """.format(
            state_filter=state_filter,
            customer_filter=customer_filter,
            item_filter=item_filter
        )
        
        # Prepare query parameters
        params = [fy_start, fy_end]
        
        # Execute query
        records = frappe.db.sql(query, params, as_dict=True)
        
        # Aggregate data by customer and financial month
        customer_data = {}
        
        for record in records:
            customer_name = record.get("customer")
            posting_date = getdate(record.get("posting_date"))
            
            # Determine which financial month this record belongs to
            month_key = get_financial_month_key(posting_date, fy_start)
            
            if month_key not in month_keys:
                continue  # Skip if outside financial year
            
            if customer_name not in customer_data:
                customer_data[customer_name] = {
                    "customer": customer_name,
                    "months": {key: 0.0 for key in month_keys},
                    "total": 0.0
                }
            
            # Calculate value based on mode
            if mode == "Quantity":
                value = flt(record.get("qty", 0), 2)
            else:  # Value mode
                # Use amount field (preferentially base_amount, then amount, etc.)
                value = flt(record.get("amount", 0), 2)
            
            # Add to month total
            customer_data[customer_name]["months"][month_key] += value
            customer_data[customer_name]["total"] += value
        
        # Convert to list and sort by customer name
        data_list = sorted(customer_data.values(), key=lambda x: x["customer"])
        
        # Calculate grand totals for each month
        grand_totals = {key: 0.0 for key in month_keys}
        for customer_row in data_list:
            for month_key, value in customer_row["months"].items():
                grand_totals[month_key] += value
        
        # Calculate grand total (sum of all month totals)
        grand_total_sum = sum(grand_totals.values())
        
        return {
            "months": month_labels,
            "month_keys": month_keys,
            "data": data_list,
            "grand_totals": grand_totals,
            "grand_total": flt(grand_total_sum, 2)
        }
        
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching customer turnover data")
        )
        # Return empty structure
        try:
            if year:
                fy_start, fy_end = get_fiscal_year_dates(year)
            else:
                fy_start, fy_end = get_current_financial_year()
        except Exception:
            fy_start, fy_end = get_current_financial_year()
        
        financial_months = get_financial_year_months(fy_start, fy_end)
        month_labels = [m["label"] for m in financial_months]
        month_keys = [m["key"] for m in financial_months]
        
        return {
            "months": month_labels,
            "month_keys": month_keys,
            "data": [],
            "grand_totals": {key: 0.0 for key in month_keys},
            "grand_total": 0.0
        }


@frappe.whitelist()
def get_filter_options():
    """
    Get filter dropdown options.
    
    Returns:
        dict: {
            states: list of unique Place of Supply values,
            customers: list of customer names,
            items: list of item codes
        }
    """
    try:
        # Get unique Place of Supply values from Sales Invoice
        states = frappe.db.sql("""
            SELECT DISTINCT place_of_supply
            FROM `tabSales Invoice`
            WHERE docstatus = 1
                AND place_of_supply IS NOT NULL
                AND place_of_supply != ''
            ORDER BY place_of_supply
            LIMIT 200
        """, as_dict=True)
        
        # Get unique customers
        customers = frappe.db.sql("""
            SELECT DISTINCT customer_name as name
            FROM `tabCustomer`
            WHERE disabled = 0
            ORDER BY customer_name
            LIMIT 500
        """, as_dict=True)
        
        # Get unique items from Sales Invoice Items
        items = frappe.db.sql("""
            SELECT DISTINCT sii.item_code
            FROM `tabSales Invoice Item` sii
            INNER JOIN `tabSales Invoice` si ON si.name = sii.parent
            WHERE si.docstatus = 1
                AND sii.item_code IS NOT NULL
            ORDER BY sii.item_code
            LIMIT 500
        """, as_dict=True)
        
        # Get fiscal years from Fiscal Year doctype
        fiscal_years = frappe.db.sql("""
            SELECT name
            FROM `tabFiscal Year`
            WHERE disabled = 0
            ORDER BY year_start_date DESC
            LIMIT 20
        """, as_dict=True)
        
        # Get current fiscal year name
        current_fiscal_year_name = get_current_fiscal_year_name()
        
        return {
            "states": [s.get("place_of_supply") for s in states if s.get("place_of_supply")],
            "customers": [c.get("name") for c in customers if c.get("name")],
            "items": [i.get("item_code") for i in items if i.get("item_code")],
            "fiscal_years": [{"name": fy.get("name")} for fy in fiscal_years if fy.get("name")],
            "current_fiscal_year": current_fiscal_year_name
        }
        
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching filter options")
        )
        return {"states": [], "customers": [], "items": [], "fiscal_years": [], "current_fiscal_year": None}


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


def get_financial_year_months(fy_start, fy_end):
    """
    Get all months in financial year with labels and keys.
    
    Args:
        fy_start: Financial year start date (April 1)
        fy_end: Financial year end date (March 31)
        
    Returns:
        list: [
            {"key": "2025-04", "label": "Apr 2025", "month": 4, "year": 2025},
            ...
        ]
    """
    months = []
    fy_year = fy_start.year
    
    # Financial year months: April (4) to March (3)
    financial_year_months = list(range(4, 13)) + list(range(1, 4))
    
    for month_num in financial_year_months:
        if month_num >= 4:
            year = fy_year
        else:
            year = fy_year + 1
        
        month_key = f"{year}-{month_num:02d}"
        month_name = calendar.month_abbr[month_num]
        month_label = f"{month_name} {year}"
        
        months.append({
            "key": month_key,
            "label": month_label,
            "month": month_num,
            "year": year
        })
    
    return months


def get_financial_month_key(posting_date, fy_start):
    """
    Get financial month key for a given date.
    
    Args:
        posting_date: Date to get month key for
        fy_start: Financial year start date
        
    Returns:
        str: Month key in format "YYYY-MM"
    """
    posting = getdate(posting_date)
    month_num = posting.month
    year = posting.year
    
    # Simply return the year-month combination
    # The financial year context is already handled by filtering dates
    return f"{year}-{month_num:02d}"


def get_state_filter_sql(state):
    """Generate SQL state filter clause."""
    if not state:
        return ""
    
    state_safe = frappe.db.escape(state)
    return f" AND si.place_of_supply = {state_safe}"


def get_customer_filter_sql(customer):
    """Generate SQL customer filter clause."""
    if not customer:
        return ""
    
    customer_safe = frappe.db.escape(customer)
    return f" AND si.customer = {customer_safe}"


def get_item_filter_sql(item):
    """Generate SQL item filter clause."""
    if not item:
        return ""
    
    item_safe = frappe.db.escape(item)
    return f" AND sii.item_code = {item_safe}"


def get_fiscal_year_dates(fiscal_year_name):
    """
    Get start and end dates for a given fiscal year name.
    
    Args:
        fiscal_year_name: Name of the fiscal year (e.g., "25-26")
        
    Returns:
        tuple: (start_date, end_date) for the fiscal year
        
    Raises:
        frappe.DoesNotExistError: If fiscal year not found
    """
    try:
        fiscal_year = frappe.get_doc("Fiscal Year", fiscal_year_name)
        return getdate(fiscal_year.year_start_date), getdate(fiscal_year.year_end_date)
    except frappe.DoesNotExistError:
        # If fiscal year not found, fall back to current financial year
        frappe.log_error(
            message=f"Fiscal Year '{fiscal_year_name}' not found. Falling back to current financial year.",
            title=_("Fiscal Year Not Found")
        )
        return get_current_financial_year()


def get_current_fiscal_year_name():
    """
    Get the name of the current fiscal year from Fiscal Year doctype.
    
    Returns:
        str: Name of current fiscal year (e.g., "25-26") or None if not found
    """
    try:
        fy_start, fy_end = get_current_financial_year()
        
        # Find fiscal year that matches current dates
        fiscal_year = frappe.db.sql("""
            SELECT name
            FROM `tabFiscal Year`
            WHERE disabled = 0
                AND year_start_date = %s
                AND year_end_date = %s
            LIMIT 1
        """, (fy_start, fy_end), as_dict=True)
        
        if fiscal_year and len(fiscal_year) > 0:
            return fiscal_year[0].get("name")
        
        # If exact match not found, find fiscal year that contains today's date
        today = getdate()
        fiscal_year = frappe.db.sql("""
            SELECT name
            FROM `tabFiscal Year`
            WHERE disabled = 0
                AND year_start_date <= %s
                AND year_end_date >= %s
            ORDER BY year_start_date DESC
            LIMIT 1
        """, (today, today), as_dict=True)
        
        if fiscal_year and len(fiscal_year) > 0:
            return fiscal_year[0].get("name")
        
        return None
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching current fiscal year name")
        )
        return None
