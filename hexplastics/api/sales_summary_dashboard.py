"""API endpoints for Sales Summary Dashboard."""

import frappe
from frappe import _
from frappe.utils import flt, getdate


@frappe.whitelist()
def get_overview_data(from_date=None, to_date=None, customer=None):
    """
    Get overview tab data for Sales Summary Dashboard.
    
    Args:
        from_date: Start date filter
        to_date: End date filter
        customer: Customer filter
        
    Returns:
        dict: {
            total_sales_orders: int,
            total_sales_invoices: int,
            total_order_value: float,
            total_invoice_value: float
        }
    """
    try:
        # Build date filter for Sales Order
        so_date_filter = get_date_filter_sql(from_date, to_date, "transaction_date")
        si_date_filter = get_date_filter_sql(from_date, to_date, "posting_date")
        customer_filter = get_customer_filter_sql(customer)
        
        # Get Sales Order metrics (only submitted)
        so_data = frappe.db.sql("""
            SELECT 
                COUNT(*) as total_orders,
                COALESCE(SUM(grand_total), 0) as total_value
            FROM `tabSales Order`
            WHERE docstatus = 1
                {date_filter}
                {customer_filter}
        """.format(
            date_filter=so_date_filter,
            customer_filter=customer_filter
        ), as_dict=True)
        
        # Get Sales Invoice metrics (only submitted)
        si_data = frappe.db.sql("""
            SELECT 
                COUNT(*) as total_invoices,
                COALESCE(SUM(grand_total), 0) as total_value
            FROM `tabSales Invoice`
            WHERE docstatus = 1
                {date_filter}
                {customer_filter}
        """.format(
            date_filter=si_date_filter,
            customer_filter=customer_filter
        ), as_dict=True)
        
        return {
            "total_sales_orders": so_data[0].get("total_orders", 0) if so_data else 0,
            "total_sales_invoices": si_data[0].get("total_invoices", 0) if si_data else 0,
            "total_order_value": flt(so_data[0].get("total_value", 0), 2) if so_data else 0,
            "total_invoice_value": flt(si_data[0].get("total_value", 0), 2) if si_data else 0
        }
        
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching overview data")
        )
        return {
            "total_sales_orders": 0,
            "total_sales_invoices": 0,
            "total_order_value": 0,
            "total_invoice_value": 0
        }


@frappe.whitelist()
def get_sales_order_data(from_date=None, to_date=None, customer=None, status=None, order_id=None, item=None):
    """
    Get Sales Order tab data.
    
    Args:
        from_date: Start date filter
        to_date: End date filter
        customer: Customer filter
        status: Status filter
        order_id: Sales Order ID filter
        item: Item Code filter
        
    Returns:
        dict: {
            metrics: {
                total_so_count: int,
                to_deliver_and_bill_count: int,
                partly_delivered_count: int,
                total_value: float
            },
            orders: list of sales orders
        }
    """
    try:
        date_filter = get_date_filter_sql(from_date, to_date, "transaction_date")
        customer_filter = get_customer_filter_sql(customer)
        status_filter = get_so_status_filter_sql(status)
        id_filter = get_id_filter_sql(order_id, "name")
        item_filter = get_item_filter_sql(item, "Sales Order")
        
        # Total SO count (non-cancelled only)
        total_so_data = frappe.db.sql("""
            SELECT COUNT(*) as count
            FROM `tabSales Order`
            WHERE docstatus != 2
                {date_filter}
                {customer_filter}
                {id_filter}
                {item_filter}
        """.format(
            date_filter=date_filter,
            customer_filter=customer_filter,
            id_filter=id_filter,
            item_filter=item_filter
        ), as_dict=True)
        
        # To Deliver and Bill orders
        to_deliver_bill_data = frappe.db.sql("""
            SELECT COUNT(*) as count
            FROM `tabSales Order`
            WHERE docstatus = 1
                AND status = 'To Deliver and Bill'
                {date_filter}
                {customer_filter}
                {id_filter}
                {item_filter}
        """.format(
            date_filter=date_filter,
            customer_filter=customer_filter,
            id_filter=id_filter,
            item_filter=item_filter
        ), as_dict=True)
        
        # Partly Delivered orders
        partly_delivered_data = frappe.db.sql("""
            SELECT COUNT(*) as count
            FROM `tabSales Order`
            WHERE docstatus = 1
                AND status = 'Partially Delivered'
                {date_filter}
                {customer_filter}
                {id_filter}
                {item_filter}
        """.format(
            date_filter=date_filter,
            customer_filter=customer_filter,
            id_filter=id_filter,
            item_filter=item_filter
        ), as_dict=True)
        
        # Total value for non-cancelled orders
        total_value_data = frappe.db.sql("""
            SELECT COALESCE(SUM(grand_total), 0) as total_value
            FROM `tabSales Order`
            WHERE docstatus != 2
                {date_filter}
                {customer_filter}
                {status_filter}
                {id_filter}
                {item_filter}
        """.format(
            date_filter=date_filter,
            customer_filter=customer_filter,
            status_filter=status_filter,
            id_filter=id_filter,
            item_filter=item_filter
        ), as_dict=True)
        
        # Get orders list for table with additional fields
        orders = frappe.db.sql("""
            SELECT 
                so.name,
                so.transaction_date,
                so.delivery_date,
                so.status,
                so.customer,
                so.grand_total
            FROM `tabSales Order` so
            WHERE so.docstatus != 2
                {date_filter}
                {customer_filter}
                {status_filter}
                {id_filter}
                {item_filter}
            ORDER BY so.transaction_date DESC, so.creation DESC
            LIMIT 100
        """.format(
            date_filter=date_filter,
            customer_filter=customer_filter,
            status_filter=status_filter,
            id_filter=id_filter,
            item_filter=item_filter
        ), as_dict=True)
        
        # Enrich orders with lead time, ordered qty, and delivered qty
        for order in orders:
            # Calculate lead time (days between delivery_date and transaction_date)
            if order.get("delivery_date") and order.get("transaction_date"):
                delivery = getdate(order.delivery_date)
                transaction = getdate(order.transaction_date)
                order["lead_time"] = (delivery - transaction).days
            else:
                order["lead_time"] = None
            
            # Get ordered and delivered quantities from Sales Order Item
            item_data = frappe.db.sql("""
                SELECT 
                    COALESCE(SUM(qty), 0) as ordered_qty,
                    COALESCE(SUM(delivered_qty), 0) as delivered_qty
                FROM `tabSales Order Item`
                WHERE parent = %s
            """, (order.name,), as_dict=True)
            
            if item_data and item_data[0]:
                order["ordered_qty"] = flt(item_data[0].get("ordered_qty", 0), 2)
                order["delivered_qty"] = flt(item_data[0].get("delivered_qty", 0), 2)
            else:
                order["ordered_qty"] = 0
                order["delivered_qty"] = 0
        
        return {
            "metrics": {
                "total_so_count": total_so_data[0].get("count", 0) if total_so_data else 0,
                "to_deliver_and_bill_count": to_deliver_bill_data[0].get("count", 0) if to_deliver_bill_data else 0,
                "partly_delivered_count": partly_delivered_data[0].get("count", 0) if partly_delivered_data else 0,
                "total_value": flt(total_value_data[0].get("total_value", 0), 2) if total_value_data else 0
            },
            "orders": orders
        }
        
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching sales order data")
        )
        return {
            "metrics": {
                "total_so_count": 0,
                "to_deliver_and_bill_count": 0,
                "partly_delivered_count": 0,
                "total_value": 0
            },
            "orders": []
        }


@frappe.whitelist()
def get_sales_invoice_data(from_date=None, to_date=None, customer=None, status=None, invoice_id=None, item=None):
    """
    Get Sales Invoice tab data.
    
    Args:
        from_date: Start date filter
        to_date: End date filter
        customer: Customer filter
        status: Status filter
        invoice_id: Sales Invoice ID filter
        item: Item Code filter
        
    Returns:
        dict: {
            metrics: {
                unpaid_count: int,
                draft_count: int,
                overdue_count: int,
                paid_count: int,
                total_value: float
            },
            invoices: list of sales invoices
        }
    """
    try:
        date_filter = get_date_filter_sql(from_date, to_date, "posting_date")
        customer_filter = get_customer_filter_sql(customer)
        status_filter = get_status_filter_sql(status)
        id_filter = get_id_filter_sql(invoice_id, "name")
        item_filter = get_item_filter_sql(item, "Sales Invoice")
        
        # Unpaid invoices count
        unpaid_data = frappe.db.sql("""
            SELECT COUNT(*) as count
            FROM `tabSales Invoice`
            WHERE docstatus = 1
                AND status = 'Unpaid'
                {date_filter}
                {customer_filter}
                {id_filter}
                {item_filter}
        """.format(
            date_filter=date_filter,
            customer_filter=customer_filter,
            id_filter=id_filter,
            item_filter=item_filter
        ), as_dict=True)
        
        # Draft invoices count
        draft_data = frappe.db.sql("""
            SELECT COUNT(*) as count
            FROM `tabSales Invoice`
            WHERE docstatus = 0
                {date_filter}
                {customer_filter}
                {id_filter}
                {item_filter}
        """.format(
            date_filter=date_filter,
            customer_filter=customer_filter,
            id_filter=id_filter,
            item_filter=item_filter
        ), as_dict=True)
        
        # Overdue invoices count
        overdue_data = frappe.db.sql("""
            SELECT COUNT(*) as count
            FROM `tabSales Invoice`
            WHERE docstatus = 1
                AND status = 'Overdue'
                {date_filter}
                {customer_filter}
                {id_filter}
                {item_filter}
        """.format(
            date_filter=date_filter,
            customer_filter=customer_filter,
            id_filter=id_filter,
            item_filter=item_filter
        ), as_dict=True)
        
        # Paid invoices count
        paid_data = frappe.db.sql("""
            SELECT COUNT(*) as count
            FROM `tabSales Invoice`
            WHERE docstatus = 1
                AND status = 'Paid'
                {date_filter}
                {customer_filter}
                {id_filter}
                {item_filter}
        """.format(
            date_filter=date_filter,
            customer_filter=customer_filter,
            id_filter=id_filter,
            item_filter=item_filter
        ), as_dict=True)
        
        # Total value for filtered invoices (non-cancelled)
        total_value_data = frappe.db.sql("""
            SELECT COALESCE(SUM(grand_total), 0) as total_value
            FROM `tabSales Invoice`
            WHERE docstatus != 2
                {date_filter}
                {customer_filter}
                {status_filter}
                {id_filter}
                {item_filter}
        """.format(
            date_filter=date_filter,
            customer_filter=customer_filter,
            status_filter=status_filter,
            id_filter=id_filter,
            item_filter=item_filter
        ), as_dict=True)
        
        # Get invoices list for table (non-cancelled)
        invoices = frappe.db.sql("""
            SELECT 
                name,
                posting_date,
                due_date,
                status,
                customer,
                grand_total
            FROM `tabSales Invoice`
            WHERE docstatus != 2
                {date_filter}
                {customer_filter}
                {status_filter}
                {id_filter}
                {item_filter}
            ORDER BY posting_date DESC, creation DESC
            LIMIT 100
        """.format(
            date_filter=date_filter,
            customer_filter=customer_filter,
            status_filter=status_filter,
            id_filter=id_filter,
            item_filter=item_filter
        ), as_dict=True)
        
        # Get total invoice count (non-cancelled)
        total_invoice_data = frappe.db.sql("""
            SELECT COUNT(*) as count
            FROM `tabSales Invoice`
            WHERE docstatus != 2
                {date_filter}
                {customer_filter}
                {id_filter}
                {item_filter}
        """.format(
            date_filter=date_filter,
            customer_filter=customer_filter,
            id_filter=id_filter,
            item_filter=item_filter
        ), as_dict=True)
        
        return {
            "metrics": {
                "total_invoice_count": total_invoice_data[0].get("count", 0) if total_invoice_data else 0,
                "paid_count": paid_data[0].get("count", 0) if paid_data else 0,
                "unpaid_count": unpaid_data[0].get("count", 0) if unpaid_data else 0,
                "overdue_count": overdue_data[0].get("count", 0) if overdue_data else 0,
                "total_value": flt(total_value_data[0].get("total_value", 0), 2) if total_value_data else 0
            },
            "invoices": invoices
        }
        
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching sales invoice data")
        )
        return {
            "metrics": {
                "total_invoice_count": 0,
                "paid_count": 0,
                "unpaid_count": 0,
                "overdue_count": 0,
                "total_value": 0
            },
            "invoices": []
        }


@frappe.whitelist()
def get_filter_options():
    """
    Get filter dropdown options.
    
    Returns:
        dict: {
            customers: list of customer names,
            items: list of item codes,
            sales_order_ids: list of sales order names,
            sales_invoice_ids: list of sales invoice names
        }
    """
    try:
        # Get unique customers from Sales Order and Sales Invoice
        customers = frappe.db.sql("""
            SELECT DISTINCT customer_name as name
            FROM `tabCustomer`
            WHERE disabled = 0
            ORDER BY customer_name
            LIMIT 200
        """, as_dict=True)
        
        # Get unique items
        items = frappe.db.sql("""
            SELECT DISTINCT item_code
            FROM `tabItem`
            WHERE disabled = 0
                AND is_sales_item = 1
            ORDER BY item_code
            LIMIT 200
        """, as_dict=True)
        
        # Get Sales Order IDs (non-cancelled)
        sales_order_ids = frappe.db.sql("""
            SELECT DISTINCT name
            FROM `tabSales Order`
            WHERE docstatus != 2
            ORDER BY name DESC
            LIMIT 200
        """, as_dict=True)
        
        # Get Sales Invoice IDs (non-cancelled)
        sales_invoice_ids = frappe.db.sql("""
            SELECT DISTINCT name
            FROM `tabSales Invoice`
            WHERE docstatus != 2
            ORDER BY name DESC
            LIMIT 200
        """, as_dict=True)
        
        return {
            "customers": [c.get("name") for c in customers if c.get("name")],
            "items": [i.get("item_code") for i in items if i.get("item_code")],
            "sales_order_ids": [so.get("name") for so in sales_order_ids if so.get("name")],
            "sales_invoice_ids": [si.get("name") for si in sales_invoice_ids if si.get("name")]
        }
        
    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching filter options")
        )
        return {"customers": [], "items": [], "sales_order_ids": [], "sales_invoice_ids": []}


def get_date_filter_sql(from_date, to_date, date_field):
    """Generate SQL date filter clause."""
    filters = []
    
    if from_date:
        from_date_safe = frappe.db.escape(str(getdate(from_date)))
        filters.append(f" AND {date_field} >= {from_date_safe}")
    
    if to_date:
        to_date_safe = frappe.db.escape(str(getdate(to_date)))
        filters.append(f" AND {date_field} <= {to_date_safe}")
    
    return "".join(filters)


def get_customer_filter_sql(customer):
    """Generate SQL customer filter clause."""
    if not customer:
        return ""
    
    customer_safe = frappe.db.escape(customer)
    return f" AND customer = {customer_safe}"


def get_status_filter_sql(status):
    """Generate SQL status filter clause."""
    if not status:
        return ""
    
    # Handle Draft status specially (docstatus = 0)
    if status == "Draft":
        return " AND docstatus = 0"
    
    status_safe = frappe.db.escape(status)
    return f" AND status = {status_safe}"


def get_so_status_filter_sql(status):
    """Generate SQL status filter clause for Sales Order tab."""
    if not status or status == "All":
        return ""
    
    # Handle Pending status - includes "To Deliver and Bill", "To Deliver", "To Bill"
    if status == "Pending":
        return """ AND (
            status = 'To Deliver and Bill' 
            OR status = 'To Deliver' 
            OR status = 'To Bill'
        )"""
    
    # Handle Partially status - includes "Partially Delivered", "Partially Delivered and Billed"
    if status == "Partially":
        return """ AND (
            status = 'Partially Delivered' 
            OR status = 'Partially Delivered and Billed'
        )"""
    
    status_safe = frappe.db.escape(status)
    return f" AND status = {status_safe}"


def get_id_filter_sql(doc_id, field_name):
    """Generate SQL ID filter clause."""
    if not doc_id:
        return ""
    
    doc_id_safe = frappe.db.escape(f"%{doc_id}%")
    return f" AND {field_name} LIKE {doc_id_safe}"


def get_item_filter_sql(item, doctype):
    """Generate SQL item filter clause using subquery."""
    if not item:
        return ""
    
    child_table = f"tab{doctype} Item"
    item_safe = frappe.db.escape(f"%{item}%")
    
    return f""" AND name IN (
        SELECT DISTINCT parent 
        FROM `{child_table}` 
        WHERE item_code LIKE {item_safe}
    )"""
