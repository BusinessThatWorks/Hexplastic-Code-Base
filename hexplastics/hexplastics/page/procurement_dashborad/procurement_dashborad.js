frappe.pages["Procurement Dashborad"].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Procurement Tracker Dashboard",
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
	new ProcurementDashboard(page);
};

class ProcurementDashboard {
	constructor(page) {
		this.page = page;
		this.wrapper = $(page.body);
		this.suppliers = [];
		this.items = [];
		this.debounce_timer = null;

		this.init();
	}

	init() {
		// Add body class to ensure CSS only applies on this page
		document.body.classList.add("procurement-dashboard-page");
		this.load_html();
		this.setup_styles();
		this.set_default_dates();
		this.bind_events();
		this.load_filter_options();
		this.refresh_data();
	}

	load_html() {
		frappe.require("/assets/hexplastics/css/procurement_dashboard.css", () => {
			this.wrapper.html(frappe.render_template("procurement_dashboard"));
		});
	}

	setup_styles() {
		const style = document.createElement("style");
		style.id = "procurement-dashboard-styles";
		style.textContent = `
			.procurement-dashboard .frappe-control {
				margin: 0 !important;
			}
			.procurement-dashboard {
				width: 100% !important;
				max-width: 100% !important;
			}
		`;

		if (!document.getElementById("procurement-dashboard-styles")) {
			document.head.appendChild(style);
		}
	}

	set_default_dates() {
		const today = new Date();
		const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);

		const formatDate = (date) => {
			return date.toISOString().split("T")[0];
		};

		setTimeout(() => {
			const fromDateInput = document.getElementById("from-date");
			const toDateInput = document.getElementById("to-date");

			if (fromDateInput) fromDateInput.value = formatDate(firstDay);
			if (toDateInput) toDateInput.value = formatDate(today);
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

			this.wrapper.on("change", "#supplier-filter", function () {
				if (self.debounce_timer) {
					clearTimeout(self.debounce_timer);
					self.debounce_timer = null;
				}
				self.refresh_data();
			});

			this.wrapper.on("input", "#supplier-filter", function () {
				if (self.debounce_timer) {
					clearTimeout(self.debounce_timer);
				}
				self.debounce_timer = setTimeout(function () {
					self.refresh_data();
				}, 500);
			});

			// Material Request tab filter changes
			this.wrapper.on("change", "#mr-status-filter", function () {
				self.update_mr_cards_visibility();
				self.refresh_material_requests();
			});

			this.wrapper.on("change", "#mr-id-filter, #mr-item-filter", function () {
				self.refresh_material_requests();
			});

			this.wrapper.on("input", "#mr-id-filter, #mr-item-filter", function () {
				if (self.debounce_timer) {
					clearTimeout(self.debounce_timer);
				}
				self.debounce_timer = setTimeout(function () {
					self.refresh_material_requests();
				}, 500);
			});

			// Purchase Order tab filter changes
			this.wrapper.on("change", "#po-status-filter", function () {
				self.update_po_cards_visibility();
				self.refresh_purchase_orders();
			});

			this.wrapper.on("change", "#po-id-filter, #po-item-filter", function () {
				self.refresh_purchase_orders();
			});

			this.wrapper.on("input", "#po-id-filter, #po-item-filter", function () {
				if (self.debounce_timer) {
					clearTimeout(self.debounce_timer);
				}
				self.debounce_timer = setTimeout(function () {
					self.refresh_purchase_orders();
				}, 500);
			});

			// Purchase Receipt tab filter changes
			this.wrapper.on("change", "#pr-status-filter", function () {
				self.update_pr_cards_visibility();
				self.refresh_purchase_receipts();
			});

			this.wrapper.on("change", "#pr-id-filter, #pr-item-filter", function () {
				self.refresh_purchase_receipts();
			});

			this.wrapper.on("input", "#pr-id-filter, #pr-item-filter", function () {
				if (self.debounce_timer) {
					clearTimeout(self.debounce_timer);
				}
				self.debounce_timer = setTimeout(function () {
					self.refresh_purchase_receipts();
				}, 500);
			});

			// Purchase Invoice tab filter changes
			this.wrapper.on("change", "#pi-status-filter", function () {
				self.update_pi_cards_visibility();
				self.refresh_purchase_invoices();
			});

			this.wrapper.on("change", "#pi-id-filter, #pi-item-filter", function () {
				self.refresh_purchase_invoices();
			});

			this.wrapper.on("input", "#pi-id-filter, #pi-item-filter", function () {
				if (self.debounce_timer) {
					clearTimeout(self.debounce_timer);
				}
				self.debounce_timer = setTimeout(function () {
					self.refresh_purchase_invoices();
				}, 500);
			});

			// Item Wise Tracker tab filter changes
			this.wrapper.on("change", "#tracker-po-filter, #tracker-item-filter", function () {
				self.refresh_item_wise_tracker();
			});

			this.wrapper.on("input", "#tracker-po-filter, #tracker-item-filter", function () {
				if (self.debounce_timer) {
					clearTimeout(self.debounce_timer);
				}
				self.debounce_timer = setTimeout(function () {
					self.refresh_item_wise_tracker();
				}, 500);
			});

			// Setup autocomplete for filters
			this.setup_supplier_autocomplete();
			this.setup_item_autocomplete("mr-item-filter", "mr-item-filter-wrapper");
			this.setup_item_autocomplete("po-item-filter", "po-item-filter-wrapper");
			this.setup_item_autocomplete("pr-item-filter", "pr-item-filter-wrapper");
			this.setup_item_autocomplete("pi-item-filter", "pi-item-filter-wrapper");
			this.setup_item_autocomplete("tracker-item-filter", "tracker-item-filter-wrapper");
		}, 200);
	}

	setup_supplier_autocomplete() {
		const self = this;
		const input = document.getElementById("supplier-filter");

		if (!input) return;

		const wrapper = document.getElementById("supplier-filter-wrapper");
		const dropdown = document.createElement("div");
		dropdown.className = "autocomplete-dropdown";
		dropdown.style.display = "none";
		wrapper.appendChild(dropdown);

		input.addEventListener("input", function () {
			const value = this.value.toLowerCase();
			const filtered = self.suppliers.filter((s) => s.toLowerCase().includes(value));

			if (filtered.length > 0 && value.length > 0) {
				dropdown.innerHTML = filtered
					.slice(0, 10)
					.map((s) => `<div class="autocomplete-item">${s}</div>`)
					.join("");
				dropdown.style.display = "block";
			} else {
				dropdown.style.display = "none";
			}
		});

		input.addEventListener("focus", function () {
			if (self.suppliers.length > 0 && this.value.length === 0) {
				dropdown.innerHTML = self.suppliers
					.slice(0, 10)
					.map((s) => `<div class="autocomplete-item">${s}</div>`)
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
			method: "hexplastics.api.procurement_dashboard.get_filter_options",
			async: true,
			callback: function (r) {
				if (r.message) {
					self.suppliers = r.message.suppliers || [];
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
		if (tabId === "material-request") {
			this.update_mr_cards_visibility();
			this.refresh_material_requests();
		} else if (tabId === "purchase-order") {
			this.refresh_purchase_orders();
		} else if (tabId === "purchase-receipt") {
			this.update_pr_cards_visibility();
			this.refresh_purchase_receipts();
		} else if (tabId === "purchase-invoice") {
			this.refresh_purchase_invoices();
		} else if (tabId === "item-wise-tracker") {
			this.refresh_item_wise_tracker();
		}
	}

	get_global_filters() {
		return {
			from_date: document.getElementById("from-date")?.value || "",
			to_date: document.getElementById("to-date")?.value || "",
			supplier: document.getElementById("supplier-filter")?.value || "",
		};
	}

	get_material_request_filters() {
		const global = this.get_global_filters();
		return {
			...global,
			status: document.getElementById("mr-status-filter")?.value || "",
			mr_id: document.getElementById("mr-id-filter")?.value || "",
			item: document.getElementById("mr-item-filter")?.value || "",
		};
	}

	get_purchase_order_filters() {
		const global = this.get_global_filters();
		return {
			...global,
			status: document.getElementById("po-status-filter")?.value || "",
			po_id: document.getElementById("po-id-filter")?.value || "",
			item: document.getElementById("po-item-filter")?.value || "",
		};
	}

	get_purchase_receipt_filters() {
		const global = this.get_global_filters();
		return {
			...global,
			status: document.getElementById("pr-status-filter")?.value || "",
			pr_id: document.getElementById("pr-id-filter")?.value || "",
			item: document.getElementById("pr-item-filter")?.value || "",
		};
	}

	get_purchase_invoice_filters() {
		const global = this.get_global_filters();
		return {
			...global,
			status: document.getElementById("pi-status-filter")?.value || "",
			pi_id: document.getElementById("pi-id-filter")?.value || "",
			item: document.getElementById("pi-item-filter")?.value || "",
		};
	}

	get_item_wise_tracker_filters() {
		const global = this.get_global_filters();
		return {
			...global,
			po_no: document.getElementById("tracker-po-filter")?.value || "",
			item: document.getElementById("tracker-item-filter")?.value || "",
		};
	}

	refresh_data() {
		const self = this;
		const filters = this.get_global_filters();

		// Show loading state
		this.show_loading();

		frappe.call({
			method: "hexplastics.api.procurement_dashboard.get_overview_metrics",
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
		if (activeTab === "material-request") {
			this.refresh_material_requests();
		} else if (activeTab === "purchase-order") {
			this.refresh_purchase_orders();
		} else if (activeTab === "purchase-receipt") {
			this.update_pr_cards_visibility();
			this.refresh_purchase_receipts();
		} else if (activeTab === "purchase-invoice") {
			this.refresh_purchase_invoices();
		} else if (activeTab === "item-wise-tracker") {
			this.refresh_item_wise_tracker();
		}
	}

	refresh_material_requests() {
		const self = this;
		const filters = this.get_material_request_filters();

		this.show_mr_loading();

		frappe.call({
			method: "hexplastics.api.procurement_dashboard.get_material_request_data",
			args: filters,
			callback: function (r) {
				if (r.message) {
					self.update_material_request_metrics(r.message.metrics);
					self.update_material_request_table(r.message.material_requests);
				}
				self.hide_mr_loading();
			},
			error: function () {
				frappe.msgprint(__("Error loading material request data"));
				self.hide_mr_loading();
			},
		});
	}

	refresh_purchase_orders() {
		const self = this;
		const filters = this.get_purchase_order_filters();

		this.show_po_loading();
		this.update_po_cards_visibility();

		frappe.call({
			method: "hexplastics.api.procurement_dashboard.get_purchase_order_data",
			args: filters,
			callback: function (r) {
				if (r.message) {
					self.update_purchase_order_metrics(r.message.metrics);
					self.update_purchase_order_table(r.message.purchase_orders);
				}
				self.hide_po_loading();
			},
			error: function () {
				frappe.msgprint(__("Error loading purchase order data"));
				self.hide_po_loading();
			},
		});
	}

	refresh_purchase_receipts() {
		const self = this;
		const filters = this.get_purchase_receipt_filters();

		this.show_pr_loading();

		frappe.call({
			method: "hexplastics.api.procurement_dashboard.get_purchase_receipt_data",
			args: filters,
			callback: function (r) {
				if (r.message) {
					self.update_purchase_receipt_metrics(r.message.metrics);
					self.update_purchase_receipt_table(r.message.purchase_receipts);
				}
				self.hide_pr_loading();
			},
			error: function () {
				frappe.msgprint(__("Error loading purchase receipt data"));
				self.hide_pr_loading();
			},
		});
	}

	refresh_purchase_invoices() {
		const self = this;
		const filters = this.get_purchase_invoice_filters();

		this.show_pi_loading();
		this.update_pi_cards_visibility();

		frappe.call({
			method: "hexplastics.api.procurement_dashboard.get_purchase_invoice_data",
			args: filters,
			callback: function (r) {
				if (r.message) {
					self.update_purchase_invoice_metrics(r.message.metrics);
					self.update_purchase_invoice_table(r.message.purchase_invoices);
				}
				self.hide_pi_loading();
			},
			error: function () {
				frappe.msgprint(__("Error loading purchase invoice data"));
				self.hide_pi_loading();
			},
		});
	}

	refresh_item_wise_tracker() {
		const self = this;
		const filters = this.get_item_wise_tracker_filters();

		this.show_tracker_loading();

		frappe.call({
			method: "hexplastics.api.procurement_dashboard.get_item_wise_tracker_data",
			args: filters,
			callback: function (r) {
				if (r.message) {
					self.update_item_wise_tracker_table(r.message.items);
				}
				self.hide_tracker_loading();
			},
			error: function () {
				frappe.msgprint(__("Error loading item wise tracker data"));
				self.hide_tracker_loading();
			},
		});
	}

	show_loading() {
		this.wrapper.find(".kpi-value").addClass("loading-pulse");
	}

	hide_loading() {
		this.wrapper.find(".kpi-value").removeClass("loading-pulse");
	}

	show_mr_loading() {
		this.wrapper.find("#mr-loading").show();
		this.wrapper.find("#mr-table").hide();
	}

	hide_mr_loading() {
		this.wrapper.find("#mr-loading").hide();
		this.wrapper.find("#mr-table").show();
	}

	show_po_loading() {
		this.wrapper.find("#po-loading").show();
		this.wrapper.find("#po-table").hide();
	}

	hide_po_loading() {
		this.wrapper.find("#po-loading").hide();
		this.wrapper.find("#po-table").show();
	}

	show_pr_loading() {
		this.wrapper.find("#pr-loading").show();
		this.wrapper.find("#pr-table").hide();
	}

	hide_pr_loading() {
		this.wrapper.find("#pr-loading").hide();
		this.wrapper.find("#pr-table").show();
	}

	show_pi_loading() {
		this.wrapper.find("#pi-loading").show();
		this.wrapper.find("#pi-table").hide();
	}

	hide_pi_loading() {
		this.wrapper.find("#pi-loading").hide();
		this.wrapper.find("#pi-table").show();
	}

	show_tracker_loading() {
		this.wrapper.find("#tracker-loading").show();
		this.wrapper.find("#tracker-table").hide();
	}

	hide_tracker_loading() {
		this.wrapper.find("#tracker-loading").hide();
		this.wrapper.find("#tracker-table").show();
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

	format_percentage(value) {
		if (value === null || value === undefined) return "0%";
		const num = parseFloat(value);
		if (isNaN(num)) return "0%";
		return num.toFixed(2) + "%";
	}

	update_overview(data) {
		if (!data) return;

		const setEl = (id, value) => {
			const el = document.getElementById(id);
			if (el) el.textContent = value;
		};

		setEl("total-material-requests", this.format_number(data.total_material_requests));
		setEl("total-purchase-orders", this.format_number(data.total_purchase_orders));
		setEl("total-purchase-receipts", this.format_number(data.total_purchase_receipts));
		setEl("total-purchase-invoices", this.format_number(data.total_purchase_invoices));
	}

	update_material_request_metrics(metrics) {
		if (!metrics) return;

		const setEl = (id, value) => {
			const el = document.getElementById(id);
			if (el) el.textContent = value;
		};

		setEl("total-mr", this.format_number(metrics.total_count));
		setEl("pending-mr", this.format_number(metrics.pending_count));
		setEl("partially-received-mr", this.format_number(metrics.partially_received_count));
		setEl("partially-ordered-mr", this.format_number(metrics.partially_ordered_count));
	}

	update_mr_cards_visibility() {
		const selectedStatus = document.getElementById("mr-status-filter")?.value || "";
		const cardsContainer = document.getElementById("mr-kpi-cards");
		
		if (!cardsContainer) return;

		// Get all cards
		const totalCard = document.getElementById("mr-card-total");
		const pendingCard = document.getElementById("mr-card-pending");
		const partiallyReceivedCard = document.getElementById("mr-card-partially-received");
		const partiallyOrderedCard = document.getElementById("mr-card-partially-ordered");

		if (selectedStatus === "") {
			// Show all cards when "All" is selected
			if (totalCard) totalCard.style.display = "";
			if (pendingCard) pendingCard.style.display = "";
			if (partiallyReceivedCard) partiallyReceivedCard.style.display = "";
			if (partiallyOrderedCard) partiallyOrderedCard.style.display = "";
		} else if (selectedStatus === "Partially Ordered") {
			// Show only Partially Ordered MR card
			if (totalCard) totalCard.style.display = "none";
			if (pendingCard) pendingCard.style.display = "none";
			if (partiallyReceivedCard) partiallyReceivedCard.style.display = "none";
			if (partiallyOrderedCard) partiallyOrderedCard.style.display = "";
		} else {
			// For other statuses (Pending, Partially Received), show only the matching card
			const cards = cardsContainer.querySelectorAll(".kpi-card[data-status]");
			
			cards.forEach(card => {
				const cardStatus = card.getAttribute("data-status");
				if (cardStatus === selectedStatus) {
					card.style.display = "";
				} else {
					card.style.display = "none";
				}
			});
			
			// Hide cards without data-status (Total and Partially Ordered)
			if (totalCard) totalCard.style.display = "none";
			if (partiallyOrderedCard) partiallyOrderedCard.style.display = "none";
		}
	}

	update_material_request_table(material_requests) {
		const tbody = document.getElementById("mr-tbody");
		const noDataMsg = document.getElementById("no-mr-message");
		const table = document.getElementById("mr-table");

		if (!tbody) return;

		if (!material_requests || material_requests.length === 0) {
			tbody.innerHTML = "";
			if (noDataMsg) noDataMsg.style.display = "flex";
			if (table) table.style.display = "none";
			return;
		}

		if (noDataMsg) noDataMsg.style.display = "none";
		if (table) table.style.display = "table";

		tbody.innerHTML = material_requests
			.map(
				(mr) => `
				<tr>
					<td>
						<a href="/app/material-request/${mr.name}" class="entry-link" target="_blank">
							${mr.name}
						</a>
					</td>
					<td>${this.format_date(mr.transaction_date)}</td>
					<td>${this.format_date(mr.required_by)}</td>
					<td>${this.format_number(mr.total_qty)}</td>
					<td>${mr.uom || "-"}</td>
					<td>
						<span class="status-badge status-${this.get_status_class(mr.status)}">
							${mr.status || "-"}
						</span>
					</td>
				</tr>
			`
			)
			.join("");
	}

	update_purchase_order_metrics(metrics) {
		if (!metrics) return;

		const setEl = (id, value) => {
			const el = document.getElementById(id);
			if (el) el.textContent = value;
		};

		setEl("approved-po", this.format_number(metrics.approved_count));
		setEl("pending-approval-po", this.format_number(metrics.pending_approval_count || 0));
	}

	update_po_cards_visibility() {
		const selectedStatus = document.getElementById("po-status-filter")?.value || "";
		const cardsContainer = document.getElementById("po-kpi-cards");
		
		if (!cardsContainer) return;

		const cards = cardsContainer.querySelectorAll(".kpi-card[data-status]");
		
		cards.forEach(card => {
			const cardStatus = card.getAttribute("data-status");
			if (selectedStatus === "" || cardStatus === selectedStatus) {
				card.style.display = "";
			} else {
				card.style.display = "none";
			}
		});
	}

	update_purchase_order_table(purchase_orders) {
		const tbody = document.getElementById("po-tbody");
		const noDataMsg = document.getElementById("no-po-message");
		const table = document.getElementById("po-table");

		if (!tbody) return;

		if (!purchase_orders || purchase_orders.length === 0) {
			tbody.innerHTML = "";
			if (noDataMsg) noDataMsg.style.display = "flex";
			if (table) table.style.display = "none";
			return;
		}

		if (noDataMsg) noDataMsg.style.display = "none";
		if (table) table.style.display = "table";

		tbody.innerHTML = purchase_orders
			.map(
				(po) => `
				<tr>
					<td>
						<a href="/app/purchase-order/${po.name}" class="entry-link" target="_blank">
							${po.name}
						</a>
					</td>
					<td>${this.format_date(po.transaction_date)}</td>
					<td>
						<span class="status-badge status-${this.get_status_class(po.status)}">
							${po.status || "-"}
						</span>
					</td>
					<td>${po.supplier || "-"}</td>
					<td class="text-right">${this.format_currency(po.grand_total)}</td>
				</tr>
			`
			)
			.join("");
	}

	update_purchase_receipt_metrics(metrics) {
		if (!metrics) return;

		const setEl = (id, value) => {
			const el = document.getElementById(id);
			if (el) el.textContent = value;
		};

		setEl("total-pr", this.format_number(metrics.total_pr_count || 0));
		setEl("completed-pr", this.format_number(metrics.completed_count));
		setEl("total-receipt-value", this.format_currency(metrics.total_receipt_value));
	}

	update_pr_cards_visibility() {
		const selectedStatus = document.getElementById("pr-status-filter")?.value || "";
		const cardsContainer = document.getElementById("pr-kpi-cards");
		
		if (!cardsContainer) return;

		const totalCard = document.getElementById("pr-card-total");
		const completedCard = document.getElementById("pr-card-completed");
		const totalValueCard = document.getElementById("pr-card-total-value");
		
		if (selectedStatus === "") {
			// Show all cards when "All" is selected
			if (totalCard) totalCard.style.display = "";
			if (completedCard) completedCard.style.display = "";
			if (totalValueCard) totalValueCard.style.display = "";
		} else if (selectedStatus === "Completed") {
			// Hide Total PR card, show Completed and Total Receipt Value cards
			if (totalCard) totalCard.style.display = "none";
			if (completedCard) completedCard.style.display = "";
			if (totalValueCard) totalValueCard.style.display = "";
		}
	}

	update_purchase_receipt_table(purchase_receipts) {
		const tbody = document.getElementById("pr-tbody");
		const noDataMsg = document.getElementById("no-pr-message");
		const table = document.getElementById("pr-table");

		if (!tbody) return;

		if (!purchase_receipts || purchase_receipts.length === 0) {
			tbody.innerHTML = "";
			if (noDataMsg) noDataMsg.style.display = "flex";
			if (table) table.style.display = "none";
			return;
		}

		if (noDataMsg) noDataMsg.style.display = "none";
		if (table) table.style.display = "table";

		tbody.innerHTML = purchase_receipts
			.map(
				(pr) => `
				<tr>
					<td>
						<a href="/app/purchase-receipt/${pr.name}" class="entry-link" target="_blank">
							${pr.name}
						</a>
					</td>
					<td>${this.format_date(pr.posting_date)}</td>
					<td>
						<span class="status-badge status-${this.get_status_class(pr.status)}">
							${pr.status || "-"}
						</span>
					</td>
					<td>${pr.supplier || "-"}</td>
					<td class="text-right">${this.format_currency(pr.grand_total)}</td>
				</tr>
			`
			)
			.join("");
	}

	update_purchase_invoice_metrics(metrics) {
		if (!metrics) return;

		const setEl = (id, value) => {
			const el = document.getElementById(id);
			if (el) el.textContent = value;
		};

		setEl("total-pi", this.format_number(metrics.total_pi_count));
		setEl("paid-pi", this.format_number(metrics.paid_count));
		setEl("overdue-pi", this.format_number(metrics.overdue_count));
		setEl("total-invoice-value", this.format_currency(metrics.total_invoice_value));
	}

	update_pi_cards_visibility() {
		const selectedStatus = document.getElementById("pi-status-filter")?.value || "";
		const cardsContainer = document.getElementById("pi-kpi-cards");
		
		if (!cardsContainer) return;

		const totalCard = document.getElementById("pi-card-total");
		const paidCard = document.getElementById("pi-card-paid");
		const overdueCard = document.getElementById("pi-card-overdue");
		
		if (selectedStatus === "") {
			// Show all cards when "All" is selected
			if (totalCard) totalCard.style.display = "";
			if (paidCard) paidCard.style.display = "";
			if (overdueCard) overdueCard.style.display = "";
		} else if (selectedStatus === "Paid") {
			// Show paid card, hide others
			if (totalCard) totalCard.style.display = "none";
			if (paidCard) paidCard.style.display = "";
			if (overdueCard) overdueCard.style.display = "none";
		} else if (selectedStatus === "Overdue") {
			// Show overdue card, hide others
			if (totalCard) totalCard.style.display = "none";
			if (paidCard) paidCard.style.display = "none";
			if (overdueCard) overdueCard.style.display = "";
		}
	}

	update_purchase_invoice_table(purchase_invoices) {
		const tbody = document.getElementById("pi-tbody");
		const noDataMsg = document.getElementById("no-pi-message");
		const table = document.getElementById("pi-table");

		if (!tbody) return;

		if (!purchase_invoices || purchase_invoices.length === 0) {
			tbody.innerHTML = "";
			if (noDataMsg) noDataMsg.style.display = "flex";
			if (table) table.style.display = "none";
			return;
		}

		if (noDataMsg) noDataMsg.style.display = "none";
		if (table) table.style.display = "table";

		tbody.innerHTML = purchase_invoices
			.map(
				(pi) => `
				<tr>
					<td>
						<a href="/app/purchase-invoice/${pi.name}" class="entry-link" target="_blank">
							${pi.name}
						</a>
					</td>
					<td>${this.format_date(pi.posting_date)}</td>
					<td>${this.format_date(pi.due_date)}</td>
					<td>
						<span class="status-badge status-${this.get_status_class(pi.status)}">
							${pi.status || "-"}
						</span>
					</td>
					<td>${pi.supplier || "-"}</td>
					<td class="text-right">${this.format_currency(pi.grand_total)}</td>
				</tr>
			`
			)
			.join("");
	}

	update_item_wise_tracker_table(items) {
		const tbody = document.getElementById("tracker-tbody");
		const noDataMsg = document.getElementById("no-tracker-message");
		const table = document.getElementById("tracker-table");

		if (!tbody) return;

		if (!items || items.length === 0) {
			tbody.innerHTML = "";
			if (noDataMsg) noDataMsg.style.display = "flex";
			if (table) table.style.display = "none";
			return;
		}

		if (noDataMsg) noDataMsg.style.display = "none";
		if (table) table.style.display = "table";

		tbody.innerHTML = items
			.map(
				(item) => `
				<tr>
					<td>
						<a href="/app/purchase-order/${item.po_no}" class="entry-link" target="_blank">
							${item.po_no || "-"}
						</a>
					</td>
					<td>${item.item_name || "-"}</td>
					<td>${this.format_date(item.due_date)}</td>
					<td>${this.format_number(item.qty)}</td>
					<td>${item.uom || "-"}</td>
					<td>${this.format_number(item.received_qty)}</td>
					<td>${this.format_percentage(item.received_percent)}</td>
					<td>${this.format_percentage(item.bill_percent)}</td>
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
			pending: "pending",
			"not-started": "pending",
			"partially-received": "partial",
			received: "completed",
			"to-receive": "pending",
			"to-receive-and-bill": "pending",
			"to-bill": "pending",
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
