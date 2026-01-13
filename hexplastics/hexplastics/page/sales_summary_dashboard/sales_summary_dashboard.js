frappe.pages["sales-summary-dashboard"].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Sales Summary Dashboard",
		single_column: true,
	});

	// Hide Frappe's default page head/title - SCOPED to this page container only
	$(page.page_container).find(".page-head").hide();

	// Hide title elements within this page container only (not globally)
	setTimeout(function () {
		// Only hide elements within this page's container
		$(page.page_container).find(".page-title, .page-header h1, .page-title-wrapper").hide();
		$(page.page_container).find("h1, .page-title, .title").not(".dashboard-title").hide();
		if (page.page_title) {
			$(page.page_title).hide();
		}
		// Hide breadcrumbs within this page container
		$(page.page_container).find(".page-header, .page-breadcrumbs").hide();
	}, 100);

	// Also check after a longer delay in case elements load later - SCOPED
	setTimeout(function () {
		$(page.page_container).find(".page-title, .page-header h1, .page-title-wrapper, .page-head").hide();
		$(page.page_container).find("h1").not(".dashboard-title").hide();
	}, 500);

	// Note: Full width styling is now handled purely via CSS with body[data-page-route] selectors
	// This prevents polluting global styles when navigating away from the dashboard

	// Initialize dashboard
	new SalesSummaryDashboard(page);
};

class SalesSummaryDashboard {
	constructor(page) {
		this.page = page;
		this.wrapper = $(page.body);
		this.customers = [];
		this.items = [];
		this.debounce_timer = null;

		this.init();
	}

	init() {
		// Add body class to ensure CSS only applies on this page
		document.body.classList.add("sales-summary-dashboard-page");
		this.load_html();
		this.setup_styles();
		this.set_default_dates();
		this.bind_events();
		this.load_filter_options();
		// Note: refresh_data() is called in set_default_dates() after dates are set
	}

	load_html() {
		frappe.require("/assets/hexplastics/css/sales_summary_dashboard.css", () => {
			this.wrapper.html(frappe.render_template("sales_summary_dashboard"));
		});
	}

	setup_styles() {
		const style = document.createElement("style");
		style.id = "sales-summary-dashboard-styles";
		style.textContent = `
			.sales-summary-dashboard .frappe-control {
				margin: 0 !important;
			}
			.sales-summary-dashboard {
				width: 100% !important;
				max-width: 100% !important;
			}
		`;

		if (!document.getElementById("sales-summary-dashboard-styles")) {
			document.head.appendChild(style);
		}
	}

	set_default_dates() {
		const today = new Date();
		const sevenDaysAgo = new Date(today);
		sevenDaysAgo.setDate(today.getDate() - 7);

		const formatDate = (date) => {
			return date.toISOString().split("T")[0];
		};

		const self = this;
		setTimeout(() => {
			const fromDateInput = document.getElementById("from-date");
			const toDateInput = document.getElementById("to-date");

			if (fromDateInput) fromDateInput.value = formatDate(sevenDaysAgo);
			if (toDateInput) toDateInput.value = formatDate(today);
			
			// Trigger refresh after dates are set to ensure data is fetched with default dates
			self.refresh_data();
		}, 100);
	}

	bind_events() {
		const self = this;

		setTimeout(() => {
			// Tab switching
			this.wrapper.on("click", ".tab-btn", function () {
				const tabId = $(this).data("tab");
				self.switch_tab(tabId);
			});

			// Global Refresh button
			this.wrapper.on("click", "#refresh-btn", function () {
				self.refresh_data();
				// Also refresh the current tab if not overview
				const activeTab = self.wrapper.find(".tab-btn.active").data("tab");
				if (activeTab === "sales-order") {
					self.update_so_cards_visibility();
					self.refresh_sales_orders();
				} else if (activeTab === "sales-invoice") {
					self.update_si_cards_visibility();
					self.refresh_sales_invoices();
				}
			});

			// Enter key on filters
			this.wrapper.on("keypress", ".filter-input", function (e) {
				if (e.which === 13) {
					self.refresh_data();
				}
			});

			// Auto-refresh on global filter changes
			this.wrapper.on("change", "#from-date", function () {
				self.refresh_data();
			});

			this.wrapper.on("change", "#to-date", function () {
				self.refresh_data();
			});

			this.wrapper.on("change", "#customer-filter", function () {
				if (self.debounce_timer) {
					clearTimeout(self.debounce_timer);
					self.debounce_timer = null;
				}
				self.refresh_data();
			});

			this.wrapper.on("input", "#customer-filter", function () {
				if (self.debounce_timer) {
					clearTimeout(self.debounce_timer);
				}
				self.debounce_timer = setTimeout(function () {
					self.refresh_data();
				}, 500);
			});

			// Sales Order tab filter changes
			this.wrapper.on("change", "#so-status-filter", function () {
				self.update_so_cards_visibility();
				self.refresh_sales_orders();
			});

			this.wrapper.on("change", "#so-id-filter, #so-item-filter", function () {
				self.refresh_sales_orders();
			});

			this.wrapper.on("input", "#so-id-filter, #so-item-filter", function () {
				if (self.debounce_timer) {
					clearTimeout(self.debounce_timer);
				}
				self.debounce_timer = setTimeout(function () {
					self.refresh_sales_orders();
				}, 500);
			});

			// Sales Invoice tab filter changes
			this.wrapper.on("change", "#si-status-filter", function () {
				self.update_si_cards_visibility();
				self.refresh_sales_invoices();
			});

			this.wrapper.on("change", "#si-id-filter, #si-item-filter", function () {
				self.refresh_sales_invoices();
			});

			this.wrapper.on("input", "#si-id-filter, #si-item-filter", function () {
				if (self.debounce_timer) {
					clearTimeout(self.debounce_timer);
				}
				self.debounce_timer = setTimeout(function () {
					self.refresh_sales_invoices();
				}, 500);
			});

			// Setup autocomplete for filters
			this.setup_customer_autocomplete();
			this.setup_item_autocomplete("so-item-filter", "so-item-filter-wrapper");
			this.setup_item_autocomplete("si-item-filter", "si-item-filter-wrapper");
		}, 200);
	}

	setup_customer_autocomplete() {
		const self = this;
		const input = document.getElementById("customer-filter");

		if (!input) return;

		const wrapper = document.getElementById("customer-filter-wrapper");
		const dropdown = document.createElement("div");
		dropdown.className = "autocomplete-dropdown";
		dropdown.style.display = "none";
		wrapper.appendChild(dropdown);

		input.addEventListener("input", function () {
			const value = this.value.toLowerCase();
			const filtered = self.customers.filter((c) => c.toLowerCase().includes(value));

			if (filtered.length > 0 && value.length > 0) {
				dropdown.innerHTML = filtered
					.slice(0, 10)
					.map((c) => `<div class="autocomplete-item">${c}</div>`)
					.join("");
				dropdown.style.display = "block";
			} else {
				dropdown.style.display = "none";
			}
		});

		input.addEventListener("focus", function () {
			if (self.customers.length > 0 && this.value.length === 0) {
				dropdown.innerHTML = self.customers
					.slice(0, 10)
					.map((c) => `<div class="autocomplete-item">${c}</div>`)
					.join("");
				dropdown.style.display = "block";
			}
		});

		wrapper.addEventListener("click", function (e) {
			if (e.target.classList.contains("autocomplete-item")) {
				input.value = e.target.textContent;
				dropdown.style.display = "none";
				const changeEvent = new Event("change", { bubbles: true });
				input.dispatchEvent(changeEvent);
			}
		});

		document.addEventListener("click", function (e) {
			if (!wrapper.contains(e.target)) {
				dropdown.style.display = "none";
			}
		});
	}

	setup_item_autocomplete(inputId, wrapperId) {
		const self = this;
		const input = document.getElementById(inputId);

		if (!input) return;

		const wrapper = document.getElementById(wrapperId);
		const dropdown = document.createElement("div");
		dropdown.className = "autocomplete-dropdown";
		dropdown.style.display = "none";
		wrapper.appendChild(dropdown);

		input.addEventListener("input", function () {
			const value = this.value.toLowerCase();
			const filtered = self.items.filter((item) => item.toLowerCase().includes(value));

			if (filtered.length > 0 && value.length > 0) {
				dropdown.innerHTML = filtered
					.slice(0, 10)
					.map((item) => `<div class="autocomplete-item">${item}</div>`)
					.join("");
				dropdown.style.display = "block";
			} else {
				dropdown.style.display = "none";
			}
		});

		input.addEventListener("focus", function () {
			if (self.items.length > 0 && this.value.length === 0) {
				dropdown.innerHTML = self.items
					.slice(0, 10)
					.map((item) => `<div class="autocomplete-item">${item}</div>`)
					.join("");
				dropdown.style.display = "block";
			}
		});

		wrapper.addEventListener("click", function (e) {
			if (e.target.classList.contains("autocomplete-item")) {
				input.value = e.target.textContent;
				dropdown.style.display = "none";
				const changeEvent = new Event("change", { bubbles: true });
				input.dispatchEvent(changeEvent);
			}
		});

		document.addEventListener("click", function (e) {
			if (!wrapper.contains(e.target)) {
				dropdown.style.display = "none";
			}
		});
	}

	load_filter_options() {
		const self = this;

		frappe.call({
			method: "hexplastics.api.sales_summary_dashboard.get_filter_options",
			async: true,
			callback: function (r) {
				if (r.message) {
					self.customers = r.message.customers || [];
					self.items = r.message.items || [];
				}
			},
		});
	}

	switch_tab(tabId) {
		// Update tab buttons
		this.wrapper.find(".tab-btn").removeClass("active");
		this.wrapper.find(`.tab-btn[data-tab="${tabId}"]`).addClass("active");

		// Update tab panes
		this.wrapper.find(".tab-pane").removeClass("active");
		this.wrapper.find(`#${tabId}-tab`).addClass("active");

		// Refresh data for the selected tab
		if (tabId === "sales-order") {
			this.update_so_cards_visibility();
			this.refresh_sales_orders();
		} else if (tabId === "sales-invoice") {
			this.update_si_cards_visibility();
			this.refresh_sales_invoices();
		}
	}

	get_global_filters() {
		return {
			from_date: document.getElementById("from-date")?.value || "",
			to_date: document.getElementById("to-date")?.value || "",
			customer: document.getElementById("customer-filter")?.value || "",
		};
	}

	get_sales_order_filters() {
		const global = this.get_global_filters();
		return {
			...global,
			status: document.getElementById("so-status-filter")?.value || "",
			order_id: document.getElementById("so-id-filter")?.value || "",
			item: document.getElementById("so-item-filter")?.value || "",
		};
	}

	get_sales_invoice_filters() {
		const global = this.get_global_filters();
		return {
			...global,
			status: document.getElementById("si-status-filter")?.value || "",
			invoice_id: document.getElementById("si-id-filter")?.value || "",
			item: document.getElementById("si-item-filter")?.value || "",
		};
	}

	refresh_data() {
		const self = this;
		const filters = this.get_global_filters();

		// Show loading state
		this.show_loading();

		frappe.call({
			method: "hexplastics.api.sales_summary_dashboard.get_overview_data",
			args: filters,
			callback: function (r) {
				if (r.message) {
					self.update_overview(r.message);
				}
				self.hide_loading();
			},
			error: function () {
				frappe.msgprint(__("Error loading dashboard data"));
				self.hide_loading();
			},
		});

		// Also refresh the current tab if not overview
		const activeTab = this.wrapper.find(".tab-btn.active").data("tab");
		if (activeTab === "sales-order") {
			this.refresh_sales_orders();
		} else if (activeTab === "sales-invoice") {
			this.refresh_sales_invoices();
		}
	}

	refresh_sales_orders() {
		const self = this;
		const filters = this.get_sales_order_filters();

		this.show_so_loading();

		frappe.call({
			method: "hexplastics.api.sales_summary_dashboard.get_sales_order_data",
			args: filters,
			callback: function (r) {
				if (r.message) {
					self.update_sales_order_metrics(r.message.metrics);
					self.update_sales_order_table(r.message.orders);
				}
				self.hide_so_loading();
			},
			error: function () {
				frappe.msgprint(__("Error loading sales order data"));
				self.hide_so_loading();
			},
		});
	}

	refresh_sales_invoices() {
		const self = this;
		const filters = this.get_sales_invoice_filters();

		this.show_si_loading();
		this.update_si_cards_visibility();

		frappe.call({
			method: "hexplastics.api.sales_summary_dashboard.get_sales_invoice_data",
			args: filters,
			callback: function (r) {
				if (r.message) {
					self.update_sales_invoice_metrics(r.message.metrics);
					self.update_sales_invoice_table(r.message.invoices);
				}
				self.hide_si_loading();
			},
			error: function () {
				frappe.msgprint(__("Error loading sales invoice data"));
				self.hide_si_loading();
			},
		});
	}

	show_loading() {
		this.wrapper.find(".kpi-value").addClass("loading-pulse");
	}

	hide_loading() {
		this.wrapper.find(".kpi-value").removeClass("loading-pulse");
	}

	show_so_loading() {
		this.wrapper.find("#so-loading").show();
		this.wrapper.find("#so-table").hide();
	}

	hide_so_loading() {
		this.wrapper.find("#so-loading").hide();
		this.wrapper.find("#so-table").show();
	}

	show_si_loading() {
		this.wrapper.find("#si-loading").show();
		this.wrapper.find("#si-table").hide();
	}

	hide_si_loading() {
		this.wrapper.find("#si-loading").hide();
		this.wrapper.find("#si-table").show();
	}

	format_currency(value) {
		if (value === null || value === undefined) return "₹0";

		const num = parseFloat(value);
		if (isNaN(num)) return "₹0";

		// Format as Indian currency with commas
		return (
			"₹" +
			num.toLocaleString("en-IN", {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			})
		);
	}

	format_number(value) {
		if (value === null || value === undefined) return "0";

		const num = parseInt(value);
		if (isNaN(num)) return "0";

		return num.toLocaleString("en-IN");
	}

	format_date(dateStr) {
		if (!dateStr) return "-";
		const date = new Date(dateStr);
		return date.toLocaleDateString("en-IN", {
			day: "2-digit",
			month: "2-digit",
			year: "numeric",
		});
	}

	update_overview(data) {
		if (!data) return;

		const setEl = (id, value) => {
			const el = document.getElementById(id);
			if (el) el.textContent = value;
		};

		setEl("total-sales-orders", this.format_number(data.total_sales_orders));
		setEl("total-sales-invoices", this.format_number(data.total_sales_invoices));
		setEl("total-order-value", this.format_currency(data.total_order_value));
		setEl("total-invoice-value", this.format_currency(data.total_invoice_value));
	}

	update_sales_order_metrics(metrics) {
		if (!metrics) return;

		const setEl = (id, value) => {
			const el = document.getElementById(id);
			if (el) el.textContent = value;
		};

		setEl("total-so-count", this.format_number(metrics.total_so_count || 0));
		setEl("to-deliver-bill-orders", this.format_number(metrics.to_deliver_and_bill_count || 0));
		setEl("partly-delivered-orders", this.format_number(metrics.partly_delivered_count || 0));
		setEl("so-total-value", this.format_currency(metrics.total_value || 0));
	}

	update_sales_order_table(orders) {
		const tbody = document.getElementById("so-tbody");
		const noDataMsg = document.getElementById("no-so-message");
		const table = document.getElementById("so-table");

		if (!tbody) return;

		if (!orders || orders.length === 0) {
			tbody.innerHTML = "";
			if (noDataMsg) noDataMsg.style.display = "flex";
			if (table) table.style.display = "none";
			return;
		}

		if (noDataMsg) noDataMsg.style.display = "none";
		if (table) table.style.display = "table";

		tbody.innerHTML = orders
			.map(
				(order) => `
				<tr>
					<td>
						<a href="/app/sales-order/${order.name}" class="entry-link" target="_blank">
							${order.name}
						</a>
					</td>
					<td>${this.format_date(order.transaction_date)}</td>
					<td>${order.customer || "-"}</td>
					<td>${order.lead_time !== null && order.lead_time !== undefined ? order.lead_time + " days" : "-"}</td>
					<td class="text-right">${this.format_number(order.ordered_qty || 0)}</td>
					<td class="text-right">${this.format_number(order.delivered_qty || 0)}</td>
					<td class="text-right">${this.format_currency(order.grand_total)}</td>
					<td>
						<span class="status-badge status-${this.get_status_class(order.status)}">
							${order.status || "-"}
						</span>
					</td>
				</tr>
			`
			)
			.join("");
	}

	update_sales_invoice_metrics(metrics) {
		if (!metrics) return;

		const setEl = (id, value) => {
			const el = document.getElementById(id);
			if (el) el.textContent = value;
		};

		setEl("total-sales-invoices-count", this.format_number(metrics.total_invoice_count || 0));
		setEl("paid-sales-invoices", this.format_number(metrics.paid_count || 0));
		setEl("unpaid-sales-invoices", this.format_number(metrics.unpaid_count || 0));
		setEl("overdue-sales-invoices", this.format_number(metrics.overdue_count || 0));
		setEl("si-total-value", this.format_currency(metrics.total_value || 0));
	}

	update_so_cards_visibility() {
		const selectedStatus = document.getElementById("so-status-filter")?.value || "";
		const cardsContainer = document.getElementById("so-kpi-cards");
		
		if (!cardsContainer) return;

		// Get all cards with data-card-type attribute
		const totalCard = cardsContainer.querySelector("#so-card-total");
		const toDeliverBillCard = cardsContainer.querySelector("#so-card-to-deliver-bill");
		const partlyDeliveredCard = cardsContainer.querySelector("#so-card-partly-delivered");
		const totalValueCard = cardsContainer.querySelector("#so-card-total-value");
		
		// Default: show all cards
		if (selectedStatus === "" || selectedStatus === "All") {
			if (totalCard) totalCard.style.display = "";
			if (toDeliverBillCard) toDeliverBillCard.style.display = "";
			if (partlyDeliveredCard) partlyDeliveredCard.style.display = "";
			if (totalValueCard) totalValueCard.style.display = "";
		}
		// Pending: Hide "Total SO" and "Partly Delivered Orders"
		else if (selectedStatus === "Pending") {
			if (totalCard) totalCard.style.display = "none";
			if (toDeliverBillCard) toDeliverBillCard.style.display = "";
			if (partlyDeliveredCard) partlyDeliveredCard.style.display = "none";
			if (totalValueCard) totalValueCard.style.display = "";
		}
		// Partially: Hide "Total SO" and "To Deliver and Bill Sales Order"
		else if (selectedStatus === "Partially") {
			if (totalCard) totalCard.style.display = "none";
			if (toDeliverBillCard) toDeliverBillCard.style.display = "none";
			if (partlyDeliveredCard) partlyDeliveredCard.style.display = "";
			if (totalValueCard) totalValueCard.style.display = "";
		}
	}

	update_si_cards_visibility() {
		const selectedStatus = document.getElementById("si-status-filter")?.value || "";
		const cardsContainer = document.getElementById("si-kpi-cards");
		
		if (!cardsContainer) return;

		// Get all cards
		const totalCard = cardsContainer.querySelector("#si-card-total");
		const paidCard = cardsContainer.querySelector("#si-card-paid");
		const unpaidCard = cardsContainer.querySelector("#si-card-unpaid");
		const overdueCard = cardsContainer.querySelector("#si-card-overdue");
		const totalValueCard = cardsContainer.querySelector("#si-card-total-value");

		// Default: show all cards
		if (selectedStatus === "" || selectedStatus === "All") {
			if (totalCard) totalCard.style.display = "";
			if (paidCard) paidCard.style.display = "";
			if (unpaidCard) unpaidCard.style.display = "";
			if (overdueCard) overdueCard.style.display = "";
			if (totalValueCard) totalValueCard.style.display = "";
		}
		// When a specific status is selected: Hide "Total Sales Invoice" and show only relevant status card
		else {
			// Hide Total Sales Invoice card when any status filter is selected
			if (totalCard) totalCard.style.display = "none";
			
			// Show/hide status-specific cards
			if (paidCard) paidCard.style.display = selectedStatus === "Paid" ? "" : "none";
			if (unpaidCard) unpaidCard.style.display = selectedStatus === "Unpaid" ? "" : "none";
			if (overdueCard) overdueCard.style.display = selectedStatus === "Overdue" ? "" : "none";
			
			// Always show Total Invoice Value
			if (totalValueCard) totalValueCard.style.display = "";
		}
	}

	update_sales_invoice_table(invoices) {
		const tbody = document.getElementById("si-tbody");
		const noDataMsg = document.getElementById("no-si-message");
		const table = document.getElementById("si-table");

		if (!tbody) return;

		if (!invoices || invoices.length === 0) {
			tbody.innerHTML = "";
			if (noDataMsg) noDataMsg.style.display = "flex";
			if (table) table.style.display = "none";
			return;
		}

		if (noDataMsg) noDataMsg.style.display = "none";
		if (table) table.style.display = "table";

		tbody.innerHTML = invoices
			.map(
				(invoice) => `
				<tr>
					<td>
						<a href="/app/sales-invoice/${invoice.name}" class="entry-link" target="_blank">
							${invoice.name}
						</a>
					</td>
					<td>${this.format_date(invoice.posting_date)}</td>
					<td>${this.format_date(invoice.due_date)}</td>
					<td>${invoice.customer || "-"}</td>
					<td class="text-right">${this.format_currency(invoice.grand_total)}</td>
					<td>
						<span class="status-badge status-${this.get_status_class(invoice.status)}">
							${invoice.status || "-"}
						</span>
					</td>
				</tr>
			`
			)
			.join("");
	}

	get_status_class(status) {
		if (!status) return "default";
		const statusLower = status.toLowerCase().replace(/\s+/g, "-");
		const statusMap = {
			draft: "draft",
			"to-deliver-and-bill": "pending",
			"to-bill": "pending",
			"to-deliver": "pending",
			completed: "completed",
			cancelled: "cancelled",
			closed: "closed",
			unpaid: "unpaid",
			overdue: "overdue",
			paid: "paid",
			"partly-paid": "partial",
			return: "return",
			"credit-note-issued": "return",
		};
		return statusMap[statusLower] || "default";
	}
}
