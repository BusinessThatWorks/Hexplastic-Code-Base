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
		this.sales_order_ids = [];
		this.sales_invoice_ids = [];
		this.debounce_timers = {};
		this.initialized = false;

		this.init();
	}

	init() {
		// Add body class to ensure CSS only applies on this page
		document.body.classList.add("sales-summary-dashboard-page");
		this.setup_styles();
		// Ensure HTML is loaded before any further initialization
		this.load_html();
	}

	load_html() {
		const self = this;
		
		// Load CSS first, then render template
		frappe.require("/assets/hexplastics/css/sales_summary_dashboard.css", () => {
			// Render template synchronously
			self.wrapper.html(frappe.render_template("sales_summary_dashboard"));
			
			// Use requestAnimationFrame to ensure DOM is painted, then initialize
			requestAnimationFrame(() => {
				self.wait_for_elements_and_initialize();
			});
		});
	}

	wait_for_elements_and_initialize() {
		const self = this;
		let attempts = 0;
		const maxAttempts = 50; // 50 * 50ms = 2.5s max wait
		
		const tryInitialize = () => {
			const fromDateInput = document.getElementById("from-date");
			const toDateInput = document.getElementById("to-date");
			
			if (fromDateInput && toDateInput) {
				// Elements exist - proceed with initialization
				self.complete_initialization(fromDateInput, toDateInput);
			} else if (attempts < maxAttempts) {
				attempts++;
				setTimeout(tryInitialize, 50);
			} else {
				console.error("Sales Summary Dashboard: Could not find date inputs after max attempts");
			}
		};
		
		tryInitialize();
	}

	complete_initialization(fromDateInput, toDateInput) {
		if (this.initialized) return; // Prevent double initialization
		this.initialized = true;
		
		// 1. Bind events (no setTimeout wrapper needed now)
		this.bindEventsImmediate();
		
		// 2. Load filter options
		this.load_filter_options();
		
		// 3. Fetch data on initial load (without date filters - will show all data)
		this.refresh_data();
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

	bindEventsImmediate() {
		const self = this;

		// Tab switching
		this.wrapper.on("click", ".tab-btn", function () {
			const tabId = $(this).data("tab");
			self.switch_tab(tabId);
		});

		// Global Refresh button - single unified refresh to avoid duplicate calls
		this.wrapper.on("click", "#refresh-btn", function () {
			self.refresh_data();
		});

		// Enter key on filters
		this.wrapper.on("keypress", ".filter-input", function (e) {
			if (e.which === 13) {
				self.refresh_data();
			}
		});

		// Auto-refresh on global filter changes - immediate updates
		this.wrapper.on("change", "#from-date", function () {
			self.refresh_data();
		});

		this.wrapper.on("change", "#to-date", function () {
			self.refresh_data();
		});

		// Customer filter - debounced input for typing, immediate change for autocomplete/blur
		this.wrapper.on("input", "#customer-filter", function () {
			const timerKey = "customer-filter";
			if (self.debounce_timers[timerKey]) {
				clearTimeout(self.debounce_timers[timerKey]);
			}
			self.debounce_timers[timerKey] = setTimeout(function () {
				self.refresh_data();
				delete self.debounce_timers[timerKey];
			}, 500);
		});

		this.wrapper.on("change", "#customer-filter", function () {
			const timerKey = "customer-filter";
			if (self.debounce_timers[timerKey]) {
				clearTimeout(self.debounce_timers[timerKey]);
				delete self.debounce_timers[timerKey];
			}
			self.refresh_data();
		});

		// Sales Order tab filter changes - immediate updates
		this.wrapper.on("change", "#so-status-filter", function () {
			self.update_so_cards_visibility();
			self.refresh_sales_orders();
		});

		// Sales Order ID and Item filters - debounced input for typing, immediate change for autocomplete/blur
		this.wrapper.on("input", "#so-id-filter, #so-item-filter", function () {
			const filterId = this.id;
			const timerKey = filterId;
			if (self.debounce_timers[timerKey]) {
				clearTimeout(self.debounce_timers[timerKey]);
			}
			self.debounce_timers[timerKey] = setTimeout(function () {
				self.refresh_sales_orders();
				delete self.debounce_timers[timerKey];
			}, 500);
		});

		this.wrapper.on("change", "#so-id-filter, #so-item-filter", function () {
			const filterId = this.id;
			const timerKey = filterId;
			if (self.debounce_timers[timerKey]) {
				clearTimeout(self.debounce_timers[timerKey]);
				delete self.debounce_timers[timerKey];
			}
			self.refresh_sales_orders();
		});

		// Handle blur event for item filters to refresh when cleared
		this.wrapper.on("blur", "#so-item-filter", function () {
			const timerKey = this.id;
			if (self.debounce_timers[timerKey]) {
				clearTimeout(self.debounce_timers[timerKey]);
				delete self.debounce_timers[timerKey];
			}
			// Trim the value
			this.value = this.value.trim();
			self.refresh_sales_orders();
		});

		// Sales Invoice tab filter changes - immediate updates
		this.wrapper.on("change", "#si-status-filter", function () {
			self.update_si_cards_visibility();
			self.refresh_sales_invoices();
		});

		// Sales Invoice ID and Item filters - debounced input for typing, immediate change for autocomplete/blur
		this.wrapper.on("input", "#si-id-filter, #si-item-filter", function () {
			const filterId = this.id;
			const timerKey = filterId;
			if (self.debounce_timers[timerKey]) {
				clearTimeout(self.debounce_timers[timerKey]);
			}
			self.debounce_timers[timerKey] = setTimeout(function () {
				self.refresh_sales_invoices();
				delete self.debounce_timers[timerKey];
			}, 500);
		});

		this.wrapper.on("change", "#si-id-filter, #si-item-filter", function () {
			const filterId = this.id;
			const timerKey = filterId;
			if (self.debounce_timers[timerKey]) {
				clearTimeout(self.debounce_timers[timerKey]);
				delete self.debounce_timers[timerKey];
			}
			self.refresh_sales_invoices();
		});

		// Handle blur event for item filters to refresh when cleared
		this.wrapper.on("blur", "#si-item-filter", function () {
			const timerKey = this.id;
			if (self.debounce_timers[timerKey]) {
				clearTimeout(self.debounce_timers[timerKey]);
				delete self.debounce_timers[timerKey];
			}
			// Trim the value
			this.value = this.value.trim();
			self.refresh_sales_invoices();
		});

		// Note: Autocomplete setup is now done in load_filter_options callback
		// to ensure data is loaded before setting up autocomplete

	}

	setup_customer_autocomplete() {
		const self = this;
		const input = document.getElementById("customer-filter");

		if (!input) return;

		const wrapper = document.getElementById("customer-filter-wrapper");
		if (!wrapper) return;

		// Check if dropdown already exists
		let dropdown = wrapper.querySelector(".autocomplete-dropdown");
		if (!dropdown) {
			dropdown = document.createElement("div");
			dropdown.className = "autocomplete-dropdown";
			dropdown.style.display = "none";
			wrapper.appendChild(dropdown);
		}

		input.addEventListener("input", function () {
			const value = this.value.trim().toLowerCase();
			
			// If value is empty, show all suggestions
			if (value.length === 0) {
				if (self.customers.length > 0) {
					dropdown.innerHTML = self.customers
						.slice(0, 10)
						.map((c) => `<div class="autocomplete-item">${c}</div>`)
						.join("");
					dropdown.style.display = "block";
				} else {
					dropdown.style.display = "none";
				}
				return;
			}
			
			// Filter suggestions based on input
			const filtered = self.customers.filter((c) => {
				if (!c) return false;
				return c.toLowerCase().includes(value);
			});

			if (filtered.length > 0) {
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
			// Always show suggestions on focus if we have data
			if (self.customers.length > 0) {
				const value = this.value.trim().toLowerCase();
				if (value.length === 0) {
					// Show all suggestions when empty
					dropdown.innerHTML = self.customers
						.slice(0, 10)
						.map((c) => `<div class="autocomplete-item">${c}</div>`)
						.join("");
					dropdown.style.display = "block";
				} else {
					// Re-trigger input to show filtered results
					const inputEvent = new Event("input", { bubbles: true });
					this.dispatchEvent(inputEvent);
				}
			}
		});

		wrapper.addEventListener("click", function (e) {
			if (e.target.classList.contains("autocomplete-item")) {
				input.value = e.target.textContent;
				dropdown.style.display = "none";
				// Trigger change event to refresh filters
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
		if (!wrapper) return;

		// Check if dropdown already exists
		let dropdown = wrapper.querySelector(".autocomplete-dropdown");
		if (!dropdown) {
			dropdown = document.createElement("div");
			dropdown.className = "autocomplete-dropdown";
			dropdown.style.display = "none";
			wrapper.appendChild(dropdown);
		}

		input.addEventListener("input", function () {
			const value = this.value.trim().toLowerCase();
			
			// If value is empty, show all suggestions
			if (value.length === 0) {
				if (self.items.length > 0) {
					dropdown.innerHTML = self.items
						.slice(0, 15)
						.map((item) => `<div class="autocomplete-item">${item || ""}</div>`)
						.join("");
					dropdown.style.display = "block";
				} else {
					dropdown.style.display = "none";
				}
				return;
			}
			
			// Filter suggestions based on input
			const filtered = self.items.filter((item) => {
				if (!item) return false;
				return item.toLowerCase().includes(value);
			});

			if (filtered.length > 0) {
				dropdown.innerHTML = filtered
					.slice(0, 15)
					.map((item) => `<div class="autocomplete-item">${item}</div>`)
					.join("");
				dropdown.style.display = "block";
			} else {
				dropdown.style.display = "none";
			}
		});

		input.addEventListener("focus", function () {
			// Always show suggestions on focus if we have data
			if (self.items.length > 0) {
				const value = this.value.trim().toLowerCase();
				if (value.length === 0) {
					// Show all suggestions when empty
					dropdown.innerHTML = self.items
						.slice(0, 15)
						.map((item) => `<div class="autocomplete-item">${item || ""}</div>`)
						.join("");
					dropdown.style.display = "block";
				} else {
					// Re-trigger input to show filtered results
					const inputEvent = new Event("input", { bubbles: true });
					this.dispatchEvent(inputEvent);
				}
			}
		});

		wrapper.addEventListener("click", function (e) {
			if (e.target.classList.contains("autocomplete-item")) {
				input.value = e.target.textContent;
				dropdown.style.display = "none";
				// Trigger change event to refresh filters
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

	setup_id_autocomplete(inputId, filterType) {
		const self = this;
		const input = document.getElementById(inputId);

		if (!input) return;

		const wrapperId = inputId + "-wrapper";
		let wrapper = document.getElementById(wrapperId);
		
		// If wrapper doesn't exist, use parent element or create one
		if (!wrapper) {
			wrapper = input.parentElement;
			if (!wrapper.classList.contains("awesomplete-wrapper")) {
				// Create wrapper and move input into it
				const newWrapper = document.createElement("div");
				newWrapper.className = "awesomplete-wrapper";
				newWrapper.id = wrapperId;
				input.parentNode.insertBefore(newWrapper, input);
				newWrapper.appendChild(input);
				wrapper = newWrapper;
			}
		}

		// Check if dropdown already exists
		let dropdown = wrapper.querySelector(".autocomplete-dropdown");
		if (!dropdown) {
			dropdown = document.createElement("div");
			dropdown.className = "autocomplete-dropdown";
			dropdown.style.display = "none";
			wrapper.appendChild(dropdown);
		}

		// Get the appropriate ID list
		const idList = filterType === "so-id-filter" ? self.sales_order_ids : self.sales_invoice_ids;

		input.addEventListener("input", function () {
			const value = this.value.trim().toLowerCase();
			
			// If value is empty, show all suggestions
			if (value.length === 0) {
				if (idList.length > 0) {
					dropdown.innerHTML = idList
						.slice(0, 10)
						.map((id) => `<div class="autocomplete-item">${id}</div>`)
						.join("");
					dropdown.style.display = "block";
				} else {
					dropdown.style.display = "none";
				}
				return;
			}
			
			// Filter suggestions based on input
			const filtered = idList.filter((id) => {
				if (!id) return false;
				return id.toLowerCase().includes(value);
			});

			if (filtered.length > 0) {
				dropdown.innerHTML = filtered
					.slice(0, 10)
					.map((id) => `<div class="autocomplete-item">${id}</div>`)
					.join("");
				dropdown.style.display = "block";
			} else {
				dropdown.style.display = "none";
			}
		});

		input.addEventListener("focus", function () {
			// Always show suggestions on focus if we have data
			if (idList.length > 0) {
				const value = this.value.trim().toLowerCase();
				if (value.length === 0) {
					// Show all suggestions when empty
					dropdown.innerHTML = idList
						.slice(0, 10)
						.map((id) => `<div class="autocomplete-item">${id}</div>`)
						.join("");
					dropdown.style.display = "block";
				} else {
					// Re-trigger input to show filtered results
					const inputEvent = new Event("input", { bubbles: true });
					this.dispatchEvent(inputEvent);
				}
			}
		});

		wrapper.addEventListener("click", function (e) {
			if (e.target.classList.contains("autocomplete-item")) {
				input.value = e.target.textContent;
				dropdown.style.display = "none";
				// Trigger change event to refresh filters
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
					self.sales_order_ids = r.message.sales_order_ids || [];
					self.sales_invoice_ids = r.message.sales_invoice_ids || [];
					
					// Setup autocomplete after data is loaded
					setTimeout(() => {
						self.setup_customer_autocomplete();
						self.setup_item_autocomplete("so-item-filter", "so-item-filter-wrapper");
						self.setup_item_autocomplete("si-item-filter", "si-item-filter-wrapper");
						self.setup_id_autocomplete("so-id-filter", "so-id-filter");
						self.setup_id_autocomplete("si-id-filter", "si-id-filter");
					}, 100);
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
		// Overview tab data is already loaded, just adjust font sizes
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
		const itemValue = document.getElementById("so-item-filter")?.value?.trim() || "";
		return {
			...global,
			status: document.getElementById("so-status-filter")?.value || "",
			order_id: document.getElementById("so-id-filter")?.value || "",
			item: itemValue,
		};
	}

	get_sales_invoice_filters() {
		const global = this.get_global_filters();
		const itemValue = document.getElementById("si-item-filter")?.value?.trim() || "";
		return {
			...global,
			status: document.getElementById("si-status-filter")?.value || "",
			invoice_id: document.getElementById("si-id-filter")?.value || "",
			item: itemValue,
		};
	}

	refresh_data() {
		// Prevent duplicate refreshes
		if (this.refreshing) return;
		this.refreshing = true;

		const self = this;
		const filters = this.get_global_filters();

		frappe.call({
			method: "hexplastics.api.sales_summary_dashboard.get_overview_data",
			args: filters,
			callback: function (r) {
				if (r.message) {
					self.update_overview(r.message);
				}
				self.refreshing = false;
			},
			error: function () {
				frappe.msgprint(__("Error loading dashboard data"));
				self.refreshing = false;
			},
		});

		// Also refresh the current tab if not overview (but don't duplicate if already refreshing)
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

		frappe.call({
			method: "hexplastics.api.sales_summary_dashboard.get_sales_order_data",
			args: filters,
			callback: function (r) {
				if (r.message) {
					self.update_sales_order_metrics(r.message.metrics);
					self.update_sales_order_table(r.message.orders);
				}
			},
			error: function () {
				frappe.msgprint(__("Error loading sales order data"));
			},
		});
	}

	refresh_sales_invoices() {
		const self = this;
		const filters = this.get_sales_invoice_filters();

		this.update_si_cards_visibility();

		frappe.call({
			method: "hexplastics.api.sales_summary_dashboard.get_sales_invoice_data",
			args: filters,
			callback: function (r) {
				if (r.message) {
					self.update_sales_invoice_metrics(r.message.metrics);
					self.update_sales_invoice_table(r.message.invoices);
				}
			},
			error: function () {
				frappe.msgprint(__("Error loading sales invoice data"));
			},
		});
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

	/**
	 * Calculate font size based on text length - deterministic, stable calculation
	 * Uses character count and accounts for currency symbols and formatting
	 * This is called once per value update to ensure consistency
	 */
	calculate_font_size(text) {
		if (!text || text === "0" || text === "₹0") return 36;
		
		const len = text.length;
		
		// Deterministic font size calculation based on character count
		// Accounts for currency symbol (₹), commas, and decimals
		// Card width is typically ~250px, so we scale font size to fit
		// These breakpoints are tested to prevent overflow
		if (len <= 5) return 36;       // "1,234" or "₹123" or "12,345"
		if (len <= 8) return 32;       // "₹1,234" or "12,34,567"
		if (len <= 11) return 28;      // "₹12,34,567" or "1,23,45,678"
		if (len <= 15) return 24;      // "₹1,23,45,678" or "12,34,56,789"
		if (len <= 19) return 20;      // "₹12,34,56,789" or "1,23,45,67,890"
		if (len <= 23) return 18;      // "₹1,23,45,67,890.00"
		return 16;                      // Extremely large values
	}

	/**
	 * Set value with automatic font sizing - atomic update, no flickering
	 * Calculates font size deterministically and applies it synchronously with text
	 * This ensures the value fits perfectly without overflow or visual jitter
	 */
	set_value_with_font_size(elementId, value) {
		const el = document.getElementById(elementId);
		if (!el) return;
		
		// Calculate font size BEFORE any DOM changes - deterministic calculation
		// Same input always produces same output, preventing flicker
		const fontSize = this.calculate_font_size(value);
		
		// Apply font size and text synchronously in one operation to prevent reflow
		// This ensures no intermediate rendering states that cause flicker
		el.style.fontSize = fontSize + "px";
		el.textContent = value;
		
		// Ensure overflow properties are explicitly set to prevent any clipping
		// These should match CSS but setting them ensures consistency
		el.style.overflow = "visible";
		el.style.textOverflow = "clip";
		el.style.whiteSpace = "nowrap";
	}

	update_overview(data) {
		if (!data) return;

		// Use set_value_with_font_size for immediate, stable updates without flickering
		this.set_value_with_font_size("total-sales-orders", this.format_number(data.total_sales_orders));
		this.set_value_with_font_size("total-sales-invoices", this.format_number(data.total_sales_invoices));
		this.set_value_with_font_size("total-order-value", this.format_currency(data.total_order_value));
		this.set_value_with_font_size("total-invoice-value", this.format_currency(data.total_invoice_value));
	}

	update_sales_order_metrics(metrics) {
		if (!metrics) return;

		// Use set_value_with_font_size for immediate, stable updates without flickering
		this.set_value_with_font_size("total-so-count", this.format_number(metrics.total_so_count || 0));
		this.set_value_with_font_size("to-deliver-bill-orders", this.format_number(metrics.to_deliver_and_bill_count || 0));
		this.set_value_with_font_size("partly-delivered-orders", this.format_number(metrics.partly_delivered_count || 0));
		this.set_value_with_font_size("so-total-value", this.format_currency(metrics.total_value || 0));
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

		// Use set_value_with_font_size for immediate, stable updates without flickering
		this.set_value_with_font_size("total-sales-invoices-count", this.format_number(metrics.total_invoice_count || 0));
		this.set_value_with_font_size("paid-sales-invoices", this.format_number(metrics.paid_count || 0));
		this.set_value_with_font_size("unpaid-sales-invoices", this.format_number(metrics.unpaid_count || 0));
		this.set_value_with_font_size("overdue-sales-invoices", this.format_number(metrics.overdue_count || 0));
		this.set_value_with_font_size("si-total-value", this.format_currency(metrics.total_value || 0));
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
