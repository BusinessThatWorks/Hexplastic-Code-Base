frappe.query_reports["Item Wise Stock Balance"] = {
	filters: [
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
			default: frappe.defaults.get_default("company"),
			reqd: 1,
		},
		{
			fieldname: "from_date",
			label: __("From Date"),
			fieldtype: "Date",
			default: frappe.datetime.add_months(frappe.datetime.get_today(), -1),
			reqd: 1,
		},
		{
			fieldname: "to_date",
			label: __("To Date"),
			fieldtype: "Date",
			default: frappe.datetime.get_today(),
			reqd: 1,
		},
		{
			fieldname: "item_group",
			label: __("Item Group"),
			fieldtype: "Link",
			options: "Item Group",
		},
		{
			fieldname: "item_code",
			label: __("Items"),
			fieldtype: "MultiSelectList",
			options: "Item",
			get_data: async function (txt) {
				let item_group = frappe.query_report.get_filter_value("item_group");
				let filters = {
					...(item_group && { item_group }),
					is_stock_item: 1,
				};

				let { message: data } = await frappe.call({
					method: "erpnext.controllers.queries.item_query",
					args: {
						doctype: "Item",
						txt: txt,
						searchfield: "name",
						start: 0,
						page_len: 10,
						filters: filters,
						as_dict: 1,
					},
				});

				return (data || []).map(({ name, ...rest }) => ({
					value: name,
					description: Object.values(rest),
				}));
			},
		},
		{
			fieldname: "warehouse",
			label: __("Warehouses"),
			fieldtype: "MultiSelectList",
			options: "Warehouse",
			get_data: (txt) => {
				let warehouse_type = frappe.query_report.get_filter_value("warehouse_type");
				let company = frappe.query_report.get_filter_value("company");
				let filters = {
					...(warehouse_type && { warehouse_type }),
					...(company && { company }),
				};
				return frappe.db.get_link_options("Warehouse", txt, filters);
			},
		},
		{
			fieldname: "warehouse_type",
			label: __("Warehouse Type"),
			fieldtype: "Link",
			options: "Warehouse Type",
		},
		{
			fieldname: "ignore_closing_balance",
			label: __("Ignore Closing Balance"),
			fieldtype: "Check",
			default: 0,
		},
		{
			fieldname: "include_zero_stock_items",
			label: __("Include Zero Stock Items"),
			fieldtype: "Check",
			default: 0,
		},
	],
};
