"""API endpoints for Procurement Tracker Dashboard."""

import frappe
from frappe import _
from frappe.utils import flt, getdate


@frappe.whitelist()
def get_overview_metrics(from_date=None, to_date=None, supplier=None):
    """
    Get overview tab metrics for Procurement Tracker Dashboard.

    Args:
        from_date: Start date filter
        to_date: End date filter
        supplier: Supplier filter

    Returns:
        dict: {
            total_material_requests: int,
            total_purchase_orders: int,
            total_purchase_receipts: int,
            total_purchase_invoices: int
        }
    """
    try:
        # Build date filters
        mr_date_filter = get_date_filter_sql(from_date, to_date, "transaction_date")
        po_date_filter = get_date_filter_sql(from_date, to_date, "transaction_date")
        pr_date_filter = get_date_filter_sql(from_date, to_date, "posting_date")
        pi_date_filter = get_date_filter_sql(from_date, to_date, "posting_date")
        supplier_filter = get_supplier_filter_sql(supplier)

        # Get Material Request count (submitted)
        mr_data = frappe.db.sql(
            """
            SELECT COUNT(*) as total_count
            FROM `tabMaterial Request`
            WHERE docstatus = 1
                {date_filter}
                {supplier_filter}
        """.format(
                date_filter=mr_date_filter, supplier_filter=supplier_filter
            ),
            as_dict=True,
        )

        # Get Purchase Order count (submitted)
        po_data = frappe.db.sql(
            """
            SELECT COUNT(*) as total_count
            FROM `tabPurchase Order`
            WHERE docstatus = 1
                {date_filter}
                {supplier_filter}
        """.format(
                date_filter=po_date_filter, supplier_filter=supplier_filter
            ),
            as_dict=True,
        )

        # Get Purchase Receipt count (submitted)
        pr_data = frappe.db.sql(
            """
            SELECT COUNT(*) as total_count
            FROM `tabPurchase Receipt`
            WHERE docstatus = 1
                {date_filter}
                {supplier_filter}
        """.format(
                date_filter=pr_date_filter, supplier_filter=supplier_filter
            ),
            as_dict=True,
        )

        # Get Purchase Invoice count (submitted)
        pi_data = frappe.db.sql(
            """
            SELECT COUNT(*) as total_count
            FROM `tabPurchase Invoice`
            WHERE docstatus = 1
                {date_filter}
                {supplier_filter}
        """.format(
                date_filter=pi_date_filter, supplier_filter=supplier_filter
            ),
            as_dict=True,
        )

        return {
            "total_material_requests": (
                mr_data[0].get("total_count", 0) if mr_data else 0
            ),
            "total_purchase_orders": po_data[0].get("total_count", 0) if po_data else 0,
            "total_purchase_receipts": (
                pr_data[0].get("total_count", 0) if pr_data else 0
            ),
            "total_purchase_invoices": (
                pi_data[0].get("total_count", 0) if pi_data else 0
            ),
        }

    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(), title=_("Error fetching overview metrics")
        )
        return {
            "total_material_requests": 0,
            "total_purchase_orders": 0,
            "total_purchase_receipts": 0,
            "total_purchase_invoices": 0,
        }


@frappe.whitelist()
def get_material_request_data(
    from_date=None, to_date=None, supplier=None, status=None, mr_id=None, item=None
):
    """
    Get Material Request tab data.

    Args:
        from_date: Start date filter
        to_date: End date filter
        supplier: Supplier filter
        status: Workflow Status filter
        mr_id: Material Request ID filter
        item: Item Code filter

    Returns:
        dict: {
            metrics: {
                total_count: int,
                pending_count: int,
                partially_received_count: int,
                partially_ordered_count: int
            },
            material_requests: list of material requests
        }
    """
    try:
        date_filter = get_date_filter_sql(from_date, to_date, "transaction_date")
        supplier_filter = get_supplier_filter_sql(supplier)
        status_filter = get_status_filter_sql(status)
        id_filter = get_id_filter_sql(mr_id, "name")
        item_filter = get_item_filter_sql(item, "Material Request")

        # Total Material Requests (exclude cancelled only)
        total_data = frappe.db.sql(
            """
            SELECT COUNT(*) as count
            FROM `tabMaterial Request`
            WHERE docstatus != 2
                {date_filter}
                {supplier_filter}
                {id_filter}
                {item_filter}
        """.format(
                date_filter=date_filter,
                supplier_filter=supplier_filter,
                id_filter=id_filter,
                item_filter=item_filter,
            ),
            as_dict=True,
        )

        # Pending Material Requests
        pending_data = frappe.db.sql(
            """
            SELECT COUNT(*) as count
            FROM `tabMaterial Request`
            WHERE docstatus = 1
                AND status IN ('Pending', 'Not Started')
                {date_filter}
                {supplier_filter}
                {id_filter}
                {item_filter}
        """.format(
                date_filter=date_filter,
                supplier_filter=supplier_filter,
                id_filter=id_filter,
                item_filter=item_filter,
            ),
            as_dict=True,
        )

        # Partially Received Material Requests
        partially_received_data = frappe.db.sql(
            """
            SELECT COUNT(*) as count
            FROM `tabMaterial Request`
            WHERE docstatus = 1
                AND status = 'Partially Received'
                {date_filter}
                {supplier_filter}
                {id_filter}
                {item_filter}
        """.format(
                date_filter=date_filter,
                supplier_filter=supplier_filter,
                id_filter=id_filter,
                item_filter=item_filter,
            ),
            as_dict=True,
        )

        # Partially Ordered Material Requests
        # Material Requests where ordered_qty > 0 AND ordered_qty < requested_qty
        # This means at least one item has some ordered quantity but not all requested quantity is ordered
        # Build date filter for MR table
        mr_date_filter = get_date_filter_sql(from_date, to_date, "mr.transaction_date")
        mr_supplier_filter = get_supplier_filter_sql(supplier)
        if mr_supplier_filter:
            mr_supplier_filter = mr_supplier_filter.replace("supplier", "mr.supplier")
        mr_id_filter = get_id_filter_sql(mr_id, "mr.name")

        # Build item filter for partially ordered
        if item:
            item_safe = frappe.db.escape(f"%{item}%")
            mr_item_filter = f" AND mri.item_code LIKE {item_safe}"
        else:
            mr_item_filter = ""

        partially_ordered_data = frappe.db.sql(
            """
            SELECT COUNT(DISTINCT mr.name) as count
            FROM `tabMaterial Request` mr
            INNER JOIN `tabMaterial Request Item` mri ON mri.parent = mr.name
            WHERE mr.docstatus != 2
                AND mr.status = 'Partially Ordered'
                AND mri.ordered_qty > 0
                AND mri.ordered_qty < mri.qty
                {date_filter}
                {supplier_filter}
                {id_filter}
                {item_filter}
        """.format(
                date_filter=mr_date_filter,
                supplier_filter=mr_supplier_filter,
                id_filter=mr_id_filter,
                item_filter=mr_item_filter,
            ),
            as_dict=True,
        )

        # Get Material Requests list for table
        # Join with Material Request Item to get Total Qty and UOM
        # Build date filter for MR table in join query
        mr_date_filter_join = get_date_filter_sql(
            from_date, to_date, "mr.transaction_date"
        )
        mr_supplier_filter_join = get_supplier_filter_sql(supplier)
        if mr_supplier_filter_join:
            mr_supplier_filter_join = mr_supplier_filter_join.replace(
                "supplier", "mr.supplier"
            )

        # Build status filter for join query - need to handle different cases
        if status:
            if status == "Draft":
                mr_status_filter_join = " AND mr.docstatus = 0"
            elif status == "Partially Ordered":
                mr_status_filter_join = """ AND mr.status = 'Partially Ordered'
                    AND mr.name IN (
                        SELECT DISTINCT parent 
                        FROM `tabMaterial Request Item` 
                        WHERE ordered_qty > 0 AND ordered_qty < qty
                    )"""
            else:
                status_safe = frappe.db.escape(status)
                mr_status_filter_join = f" AND mr.status = {status_safe}"
        else:
            mr_status_filter_join = ""

        mr_id_filter_join = get_id_filter_sql(mr_id, "mr.name")

        # Build item filter for join query - use subquery to filter MRs, not items
        # This ensures Total Qty sums ALL items in the MR, not just filtered items
        if item:
            item_safe = frappe.db.escape(f"%{item}%")
            mr_item_filter_join = f""" AND mr.name IN (
                SELECT DISTINCT parent 
                FROM `tabMaterial Request Item` 
                WHERE item_code LIKE {item_safe}
            )"""
        else:
            mr_item_filter_join = ""

        material_requests = frappe.db.sql(
            """
            SELECT 
                mr.name,
                mr.transaction_date,
                mr.schedule_date as required_by,
                COALESCE(SUM(mri.qty), 0) as total_qty,
                COALESCE(MAX(mri.stock_uom), '') as uom,
                mr.status
            FROM `tabMaterial Request` mr
            LEFT JOIN `tabMaterial Request Item` mri ON mri.parent = mr.name
            WHERE mr.docstatus = 1
                {date_filter}
                {supplier_filter}
                {status_filter}
                {id_filter}
                {item_filter}
            GROUP BY mr.name, mr.transaction_date, mr.schedule_date, mr.status
            ORDER BY mr.transaction_date DESC, mr.creation DESC
            LIMIT 100
        """.format(
                date_filter=mr_date_filter_join,
                supplier_filter=mr_supplier_filter_join,
                status_filter=mr_status_filter_join,
                id_filter=mr_id_filter_join,
                item_filter=mr_item_filter_join,
            ),
            as_dict=True,
        )

        return {
            "metrics": {
                "total_count": (total_data[0].get("count", 0) if total_data else 0),
                "pending_count": pending_data[0].get("count", 0) if pending_data else 0,
                "partially_received_count": (
                    partially_received_data[0].get("count", 0)
                    if partially_received_data
                    else 0
                ),
                "partially_ordered_count": (
                    partially_ordered_data[0].get("count", 0)
                    if partially_ordered_data
                    else 0
                ),
            },
            "material_requests": material_requests,
        }

    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching material request data"),
        )
        return {
            "metrics": {
                "total_count": 0,
                "pending_count": 0,
                "partially_received_count": 0,
                "partially_ordered_count": 0,
            },
            "material_requests": [],
        }


@frappe.whitelist()
def get_purchase_order_data(
    from_date=None, to_date=None, supplier=None, status=None, po_id=None, item=None
):
    """
    Get Purchase Order tab data.

    Args:
        from_date: Start date filter
        to_date: End date filter
        supplier: Supplier filter
        status: Workflow Status filter
        po_id: Purchase Order ID filter
        item: Item Code filter

    Returns:
        dict: {
            metrics: {
                approved_count: int
            },
            purchase_orders: list of purchase orders
        }
    """
    try:
        date_filter = get_date_filter_sql(from_date, to_date, "transaction_date")
        supplier_filter = get_supplier_filter_sql(supplier)
        id_filter = get_id_filter_sql(po_id, "name")
        item_filter = get_item_filter_sql(item, "Purchase Order")

        # Check if workflow_state field exists in Purchase Order
        po_meta = frappe.get_meta("Purchase Order")
        has_workflow_state = "workflow_state" in [f.fieldname for f in po_meta.fields]

        # Build status filter for table query - check both workflow_state and status if workflow exists
        if status:
            if status == "Draft":
                status_filter = " AND docstatus = 0"
            else:
                status_safe = frappe.db.escape(status)
                if has_workflow_state:
                    # Check both workflow_state and status fields
                    status_filter = f" AND (workflow_state = {status_safe} OR status = {status_safe})"
                else:
                    status_filter = f" AND status = {status_safe}"
        else:
            status_filter = ""

        # Build status filter for approved count - only apply if status is "Approved" or empty
        if status == "Approved":
            status_safe = frappe.db.escape(status)
            if has_workflow_state:
                approved_status_filter = (
                    f" AND (workflow_state = {status_safe} OR status = {status_safe})"
                )
            else:
                approved_status_filter = f" AND status = {status_safe}"
        else:
            # If status is "Pending Approval" or empty, don't filter approved count by status
            approved_status_filter = ""

        # Build status filter for pending approval count - only apply if status is "Pending Approval" or empty
        if status == "Pending Approval":
            if has_workflow_state:
                pending_approval_status_filter = " AND (workflow_state = 'Pending Approval' OR (docstatus = 0 AND workflow_state IS NULL))"
            else:
                pending_approval_status_filter = " AND docstatus = 0"
        else:
            # If status is "Approved" or empty, don't filter pending approval count by status
            pending_approval_status_filter = ""

        # Build approval condition
        # Approved Purchase Orders = all submitted documents (docstatus = 1) excluding cancelled
        # If workflow is used: also check workflow_state = 'Approved' OR docstatus = 1
        # This ensures we capture all approved/submitted POs regardless of workflow state
        if has_workflow_state:
            # If workflow field exists, include:
            # 1. Documents explicitly approved via workflow (workflow_state = 'Approved')
            # 2. All submitted documents (docstatus = 1) - this covers all submitted POs
            # The OR with docstatus = 1 ensures we get all submitted documents
            approval_condition = "(workflow_state = 'Approved' OR docstatus = 1)"
        else:
            # If workflow is not enabled, use docstatus = 1 for approved/submitted
            approval_condition = "docstatus = 1"

        # Build cancellation exclusion condition
        # Exclude both docstatus = 2 (cancelled) and workflow_state = 'Cancelled'
        if has_workflow_state:
            cancellation_exclusion = "AND docstatus != 2 AND (workflow_state IS NULL OR workflow_state != 'Cancelled')"
        else:
            cancellation_exclusion = "AND docstatus != 2"

        # Build status field selection
        # Show workflow_state as status if workflow exists, otherwise use status field
        if has_workflow_state:
            status_field = "COALESCE(workflow_state, status) as status"
        else:
            status_field = "status"

        # Approved Purchase Orders
        # Approval condition: workflow_state = 'Approved' OR docstatus = 1 (if workflow not used)
        # Exclude cancelled: docstatus != 2 AND workflow_state != 'Cancelled'
        # Apply status filter only if status is "Approved" or empty
        approved_data = frappe.db.sql(
            """
            SELECT COUNT(*) as count
            FROM `tabPurchase Order`
            WHERE {approval_condition}
                {cancellation_exclusion}
                {date_filter}
                {supplier_filter}
                {approved_status_filter}
                {id_filter}
                {item_filter}
        """.format(
                approval_condition=approval_condition,
                cancellation_exclusion=cancellation_exclusion,
                date_filter=date_filter,
                supplier_filter=supplier_filter,
                approved_status_filter=approved_status_filter,
                id_filter=id_filter,
                item_filter=item_filter,
            ),
            as_dict=True,
        )

        # Pending Approval Purchase Orders
        # Pending approval = documents with workflow_state = 'Pending Approval' OR (docstatus = 0 AND workflow_state IS NULL)
        # Exclude cancelled: docstatus != 2 AND workflow_state != 'Cancelled'
        if has_workflow_state:
            pending_approval_condition = "(workflow_state = 'Pending Approval' OR (docstatus = 0 AND workflow_state IS NULL))"
        else:
            # If workflow is not enabled, use docstatus = 0 for draft/pending
            pending_approval_condition = "docstatus = 0"

        # Apply status filter only if status is "Pending Approval" or empty
        pending_approval_data = frappe.db.sql(
            """
            SELECT COUNT(*) as count
            FROM `tabPurchase Order`
            WHERE {pending_approval_condition}
                {cancellation_exclusion}
                {date_filter}
                {supplier_filter}
                {pending_approval_status_filter}
                {id_filter}
                {item_filter}
        """.format(
                pending_approval_condition=pending_approval_condition,
                cancellation_exclusion=cancellation_exclusion,
                date_filter=date_filter,
                supplier_filter=supplier_filter,
                pending_approval_status_filter=pending_approval_status_filter,
                id_filter=id_filter,
                item_filter=item_filter,
            ),
            as_dict=True,
        )

        # Get Purchase Orders list for table
        # Show POs based on status filter:
        # - If status is "Approved" or empty: show approved POs
        # - If status is "Pending Approval": show pending approval POs
        # - If status is "Draft": show draft POs
        # Status column shows workflow_state if available, otherwise shows status field

        # Build table condition based on status filter
        if status == "Pending Approval":
            # Show pending approval POs
            table_condition = pending_approval_condition
            # Remove status filter from WHERE clause since it's already in the condition
            table_status_filter = ""
        elif status == "Draft":
            # Show draft POs
            table_condition = "docstatus = 0"
            table_status_filter = ""
        else:
            # Show approved POs (default behavior)
            table_condition = approval_condition
            # Apply status filter if status is "Approved" or empty
            if status == "Approved":
                table_status_filter = approved_status_filter
            else:
                table_status_filter = ""

        purchase_orders = frappe.db.sql(
            """
            SELECT
                name,
                transaction_date,
                {status_field},
                supplier,
                grand_total
            FROM `tabPurchase Order`
            WHERE {table_condition}
                {cancellation_exclusion}
                {date_filter}
                {supplier_filter}
                {table_status_filter}
                {id_filter}
                {item_filter}
            ORDER BY transaction_date DESC, creation DESC
            LIMIT 100
        """.format(
                status_field=status_field,
                table_condition=table_condition,
                cancellation_exclusion=cancellation_exclusion,
                date_filter=date_filter,
                supplier_filter=supplier_filter,
                table_status_filter=table_status_filter,
                id_filter=id_filter,
                item_filter=item_filter,
            ),
            as_dict=True,
        )

        return {
            "metrics": {
                "approved_count": (
                    approved_data[0].get("count", 0) if approved_data else 0
                ),
                "pending_approval_count": (
                    pending_approval_data[0].get("count", 0)
                    if pending_approval_data
                    else 0
                ),
            },
            "purchase_orders": purchase_orders,
        }

    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching purchase order data"),
        )
        return {
            "metrics": {"approved_count": 0, "pending_approval_count": 0},
            "purchase_orders": [],
        }


@frappe.whitelist()
def get_purchase_receipt_data(
    from_date=None, to_date=None, supplier=None, status=None, pr_id=None, item=None
):
    """
    Get Purchase Receipt tab data.

    Args:
        from_date: Start date filter
        to_date: End date filter
        supplier: Supplier filter
        status: Workflow Status filter
        pr_id: Purchase Receipt ID filter
        item: Item Code filter

    Returns:
        dict: {
            metrics: {
                total_pr_count: int,
                completed_count: int,
                total_receipt_value: float
            },
            purchase_receipts: list of purchase receipts
        }
    """
    try:
        date_filter = get_date_filter_sql(from_date, to_date, "posting_date")
        supplier_filter = get_supplier_filter_sql(supplier)
        status_filter = get_status_filter_sql(status)
        id_filter = get_id_filter_sql(pr_id, "name")
        item_filter = get_item_filter_sql(item, "Purchase Receipt")

        # Total PR - Count all Purchase Receipts excluding cancelled (docstatus != 2)
        # Apply only global filters: from_date, to_date, supplier
        total_pr_data = frappe.db.sql(
            """
            SELECT COUNT(*) as count
            FROM `tabPurchase Receipt`
            WHERE docstatus != 2
                {date_filter}
                {supplier_filter}
        """.format(
                date_filter=date_filter,
                supplier_filter=supplier_filter,
            ),
            as_dict=True,
        )

        # Completed Purchase Receipts
        completed_data = frappe.db.sql(
            """
            SELECT COUNT(*) as count
            FROM `tabPurchase Receipt`
            WHERE docstatus = 1
                AND status = 'Completed'
                {date_filter}
                {supplier_filter}
                {id_filter}
                {item_filter}
        """.format(
                date_filter=date_filter,
                supplier_filter=supplier_filter,
                id_filter=id_filter,
                item_filter=item_filter,
            ),
            as_dict=True,
        )

        # Total Receipt Value
        total_value_data = frappe.db.sql(
            """
            SELECT COALESCE(SUM(grand_total), 0) as total_value
            FROM `tabPurchase Receipt`
            WHERE docstatus = 1
                {date_filter}
                {supplier_filter}
                {status_filter}
                {id_filter}
                {item_filter}
        """.format(
                date_filter=date_filter,
                supplier_filter=supplier_filter,
                status_filter=status_filter,
                id_filter=id_filter,
                item_filter=item_filter,
            ),
            as_dict=True,
        )

        # Get Purchase Receipts list for table
        purchase_receipts = frappe.db.sql(
            """
            SELECT 
                name,
                posting_date,
                status,
                supplier,
                grand_total
            FROM `tabPurchase Receipt`
            WHERE docstatus = 1
                {date_filter}
                {supplier_filter}
                {status_filter}
                {id_filter}
                {item_filter}
            ORDER BY posting_date DESC, creation DESC
            LIMIT 100
        """.format(
                date_filter=date_filter,
                supplier_filter=supplier_filter,
                status_filter=status_filter,
                id_filter=id_filter,
                item_filter=item_filter,
            ),
            as_dict=True,
        )

        return {
            "metrics": {
                "total_pr_count": (
                    total_pr_data[0].get("count", 0) if total_pr_data else 0
                ),
                "completed_count": (
                    completed_data[0].get("count", 0) if completed_data else 0
                ),
                "total_receipt_value": (
                    flt(total_value_data[0].get("total_value", 0), 2)
                    if total_value_data
                    else 0
                ),
            },
            "purchase_receipts": purchase_receipts,
        }

    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching purchase receipt data"),
        )
        return {
            "metrics": {
                "total_pr_count": 0,
                "completed_count": 0,
                "total_receipt_value": 0,
            },
            "purchase_receipts": [],
        }


@frappe.whitelist()
def get_purchase_invoice_data(
    from_date=None, to_date=None, supplier=None, status=None, pi_id=None, item=None
):
    """
    Get Purchase Invoice tab data.

    Args:
        from_date: Start date filter
        to_date: End date filter
        supplier: Supplier filter
        status: Workflow Status filter
        pi_id: Purchase Invoice ID filter
        item: Item Code filter

    Returns:
        dict: {
            metrics: {
                total_pi_count: int,
                paid_count: int,
                overdue_count: int,
                total_invoice_value: float
            },
            purchase_invoices: list of purchase invoices
        }
    """
    try:
        date_filter = get_date_filter_sql(from_date, to_date, "posting_date")
        supplier_filter = get_supplier_filter_sql(supplier)
        id_filter = get_id_filter_sql(pi_id, "name")
        item_filter = get_item_filter_sql(item, "Purchase Invoice")

        # Total Purchase Invoices (exclude cancelled only, apply only global filters)
        total_pi_data = frappe.db.sql(
            """
            SELECT COUNT(*) as count
            FROM `tabPurchase Invoice`
            WHERE docstatus != 2
                {date_filter}
                {supplier_filter}
        """.format(
                date_filter=date_filter,
                supplier_filter=supplier_filter,
            ),
            as_dict=True,
        )

        # Paid Purchase Invoices (exclude cancelled)
        paid_data = frappe.db.sql(
            """
            SELECT COUNT(*) as count
            FROM `tabPurchase Invoice`
            WHERE docstatus != 2
                AND status = 'Paid'
                {date_filter}
                {supplier_filter}
                {id_filter}
                {item_filter}
        """.format(
                date_filter=date_filter,
                supplier_filter=supplier_filter,
                id_filter=id_filter,
                item_filter=item_filter,
            ),
            as_dict=True,
        )

        # Overdue Purchase Invoices (exclude cancelled)
        overdue_data = frappe.db.sql(
            """
            SELECT COUNT(*) as count
            FROM `tabPurchase Invoice`
            WHERE docstatus = 1
                AND status = 'Overdue'
                {date_filter}
                {supplier_filter}
                {id_filter}
                {item_filter}
        """.format(
                date_filter=date_filter,
                supplier_filter=supplier_filter,
                id_filter=id_filter,
                item_filter=item_filter,
            ),
            as_dict=True,
        )

        # Build table query based on status filter
        # When "Overdue" is selected: show overdue invoices and exclude cancelled
        # When "Paid" is selected: show paid invoices and exclude cancelled
        # When "All" is selected: show all invoices (excluding cancelled)
        if status == "Overdue":
            # Show overdue invoices, exclude cancelled (docstatus != 2)
            table_condition = "docstatus IN (0, 1) AND status = 'Overdue'"
            table_status_filter = ""
        elif status == "Paid":
            # Show paid invoices, exclude cancelled (docstatus != 2)
            table_condition = "docstatus IN (0, 1) AND status = 'Paid'"
            table_status_filter = ""
        else:
            # Show all invoices (default behavior, exclude cancelled)
            table_condition = "docstatus IN (0, 1)"
            table_status_filter = ""

        # Total Invoice Value (only count non-cancelled invoices)
        total_value_data = frappe.db.sql(
            """
            SELECT COALESCE(SUM(grand_total), 0) as total_value
            FROM `tabPurchase Invoice`
            WHERE {table_condition}
                {date_filter}
                {supplier_filter}
                {table_status_filter}
                {id_filter}
                {item_filter}
        """.format(
                table_condition=table_condition,
                date_filter=date_filter,
                supplier_filter=supplier_filter,
                table_status_filter=table_status_filter,
                id_filter=id_filter,
                item_filter=item_filter,
            ),
            as_dict=True,
        )

        # Get Purchase Invoices list for table
        purchase_invoices = frappe.db.sql(
            """
            SELECT 
                name,
                posting_date,
                due_date,
                status,
                supplier,
                grand_total
            FROM `tabPurchase Invoice`
            WHERE {table_condition}
                {date_filter}
                {supplier_filter}
                {table_status_filter}
                {id_filter}
                {item_filter}
            ORDER BY posting_date DESC, creation DESC
            LIMIT 100
        """.format(
                table_condition=table_condition,
                date_filter=date_filter,
                supplier_filter=supplier_filter,
                table_status_filter=table_status_filter,
                id_filter=id_filter,
                item_filter=item_filter,
            ),
            as_dict=True,
        )

        return {
            "metrics": {
                "total_pi_count": (
                    total_pi_data[0].get("count", 0) if total_pi_data else 0
                ),
                "paid_count": paid_data[0].get("count", 0) if paid_data else 0,
                "overdue_count": overdue_data[0].get("count", 0) if overdue_data else 0,
                "total_invoice_value": (
                    flt(total_value_data[0].get("total_value", 0), 2)
                    if total_value_data
                    else 0
                ),
            },
            "purchase_invoices": purchase_invoices,
        }

    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching purchase invoice data"),
        )
        return {
            "metrics": {
                "total_pi_count": 0,
                "paid_count": 0,
                "overdue_count": 0,
                "total_invoice_value": 0,
            },
            "purchase_invoices": [],
        }


@frappe.whitelist()
def get_item_wise_tracker_data(
    from_date=None, to_date=None, supplier=None, po_no=None, item=None
):
    """
    Get Item Wise Tracker tab data.

    Args:
        from_date: Start date filter
        to_date: End date filter
        supplier: Supplier filter
        po_no: Purchase Order No filter
        item: Item Code filter

    Returns:
        dict: {
            metrics: {
                tracked_items_count: int
            },
            items: list of tracked items with PO details
        }
    """
    try:
        date_filter = get_date_filter_sql(from_date, to_date, "transaction_date")
        supplier_filter = get_supplier_filter_sql(supplier)

        # Build PO filter
        if po_no:
            po_no_safe = frappe.db.escape(f"%{po_no}%")
            po_filter = f" AND po.name LIKE {po_no_safe}"
        else:
            po_filter = ""

        # Build item filter - need to filter on PO items
        if item:
            item_safe = frappe.db.escape(f"%{item}%")
            item_filter = f" AND poi.item_code LIKE {item_safe}"
        else:
            item_filter = ""

        # Get tracked items from Purchase Order Items
        items_query = """
            SELECT 
                po.name as po_no,
                poi.item_code as item_name,
                po.schedule_date as due_date,
                poi.qty,
                poi.uom,
                COALESCE(SUM(pr_item.received_qty), 0) as received_qty,
                CASE 
                    WHEN poi.qty > 0 THEN 
                        ROUND((COALESCE(SUM(pr_item.received_qty), 0) / poi.qty) * 100, 2)
                    ELSE 0 
                END as received_percent
            FROM `tabPurchase Order Item` poi
            INNER JOIN `tabPurchase Order` po ON poi.parent = po.name
            LEFT JOIN `tabPurchase Receipt Item` pr_item ON pr_item.purchase_order_item = poi.name
            LEFT JOIN `tabPurchase Receipt` pr ON pr_item.parent = pr.name AND pr.docstatus = 1
            WHERE po.docstatus = 1
                {date_filter}
                {supplier_filter}
                {po_filter}
                {item_filter}
            GROUP BY poi.name, po.name, poi.item_code, po.schedule_date, poi.qty, poi.uom
            ORDER BY po.name DESC, poi.idx
            LIMIT 200
        """.format(
            date_filter=date_filter,
            supplier_filter=supplier_filter,
            po_filter=po_filter,
            item_filter=item_filter,
        )

        items = frappe.db.sql(items_query, as_dict=True)

        return {"metrics": {"tracked_items_count": len(items)}, "items": items}

    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=_("Error fetching item wise tracker data"),
        )
        return {"metrics": {"tracked_items_count": 0}, "items": []}


@frappe.whitelist()
def get_filter_options():
    """
    Get filter dropdown options.

    Returns:
        dict: {
            suppliers: list of supplier names,
            items: list of item codes
        }
    """
    try:
        # Get unique suppliers
        suppliers = frappe.db.sql(
            """
            SELECT DISTINCT supplier_name as name
            FROM `tabSupplier`
            WHERE disabled = 0
            ORDER BY supplier_name
            LIMIT 200
        """,
            as_dict=True,
        )

        # Get unique items
        items = frappe.db.sql(
            """
            SELECT DISTINCT item_code
            FROM `tabItem`
            WHERE disabled = 0
                AND is_purchase_item = 1
            ORDER BY item_code
            LIMIT 200
        """,
            as_dict=True,
        )

        return {
            "suppliers": [s.get("name") for s in suppliers if s.get("name")],
            "items": [i.get("item_code") for i in items if i.get("item_code")],
        }

    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(), title=_("Error fetching filter options")
        )
        return {"suppliers": [], "items": []}


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


def get_supplier_filter_sql(supplier):
    """Generate SQL supplier filter clause."""
    if not supplier:
        return ""

    supplier_safe = frappe.db.escape(supplier)
    return f" AND supplier = {supplier_safe}"


def get_status_filter_sql(status):
    """Generate SQL status filter clause."""
    if not status:
        return ""

    # Handle Draft status specially (docstatus = 0)
    if status == "Draft":
        return " AND docstatus = 0"

    # Handle Partially Ordered status specially - use subquery to find MRs with partially ordered items
    # AND status must be 'Partially Ordered' (not 'Stopped' or other statuses)
    if status == "Partially Ordered":
        return """ AND status = 'Partially Ordered'
            AND name IN (
                SELECT DISTINCT parent 
                FROM `tabMaterial Request Item` 
                WHERE ordered_qty > 0 AND ordered_qty < qty
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
