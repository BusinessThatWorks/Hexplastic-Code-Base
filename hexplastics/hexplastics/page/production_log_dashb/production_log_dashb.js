frappe.pages["production-log-dashb"].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Production Log Book Dashboard",
		single_column: true,
	});

	// Hide Frappe's default page head/title completely since we have our own custom header
	$(page.page_container).find(".page-head").hide();

	// Aggressively hide all possible Frappe title elements
	setTimeout(function () {
		// Hide various possible Frappe title elements
		$(
			".page-title, .page-header h1, .page-title-wrapper, .page-head, .page-head h1, .page-head .page-title, .page-head .page-title-wrapper"
		).hide();

		// Hide any title in the page container
		$(page.page_container).find("h1, .page-title, .title").not(".dashboard-title").hide();

		// Also hide the title from the page object if it exists
		if (page.page_title) {
			$(page.page_title).hide();
		}

		// Hide any breadcrumb or header that might show the title
		$(".page-header, .page-breadcrumbs").hide();
	}, 100);

	// Also check after a longer delay in case elements load later
	setTimeout(function () {
		$(".page-title, .page-header h1, .page-title-wrapper, .page-head").hide();
		$(page.page_container).find("h1").not(".dashboard-title").hide();
	}, 500);

	// Force full width by removing container constraints
	setTimeout(function () {
		// Remove max-width constraints from all parent containers and remove margins/padding
		$(
			".page-container, .layout-main, .page-content, .layout-container, .page-wrapper, .form-container, .page-body, .page-content-wrapper"
		).css({
			"max-width": "100%",
			width: "100%",
			"margin-left": "0",
			"margin-right": "0",
			"padding-left": "0",
			"padding-right": "0",
		});

		// Also target the wrapper directly
		$(wrapper).css({
			"max-width": "100%",
			width: "100%",
			"margin-left": "0",
			"margin-right": "0",
			"padding-left": "0",
			"padding-right": "0",
		});
	}, 100);

	// Initialize dashboard
	new ProductionLogDashboard(page);
};

class ProductionLogDashboard {
	constructor(page) {
		this.page = page;
		this.wrapper = $(page.body);
		this.chart = null;
		this.manufacturing_items = [];
		this.debounce_timer = null;

		this.init();
	}

	init() {
		this.load_html();
		this.setup_styles();
		this.set_default_dates();
		this.bind_events();
		this.load_filter_options();
		this.refresh_data();
		this.setup_table_scroll_indicators();
	}

	load_html() {
		frappe.require("/assets/hexplastics/css/production_log_dashboard.css", () => {
			this.wrapper.html(frappe.render_template("production_log_dashb"));
		});
	}

	setup_styles() {
		// Dynamic styles scoped to production log dashboard only
		const style = document.createElement("style");
		style.id = "production-log-dashboard-styles";
		style.textContent = `
            /* Scoped styles - only apply within the dashboard */
            .production-log-dashboard .frappe-control {
                margin: 0 !important;
            }
            .production-log-dashboard {
                width: 100% !important;
                max-width: 100% !important;
            }
        `;

		// Only add if not already present
		if (!document.getElementById("production-log-dashboard-styles")) {
			document.head.appendChild(style);
		}
	}

	set_default_dates() {
		// Set default date range (current month)
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

		// Wait for DOM to be ready
		setTimeout(() => {
			// Tab switching
			this.wrapper.on("click", ".tab-btn", function () {
				const tabId = $(this).data("tab");
				self.switch_tab(tabId);
			});

			// Refresh button
			this.wrapper.on("click", "#refresh-btn", function () {
				self.refresh_data();
			});

			// Enter key on filters
			this.wrapper.on("keypress", ".filter-input", function (e) {
				if (e.which === 13) {
					self.refresh_data();
				}
			});

			// Auto-refresh on filter changes
			// From Date change
			this.wrapper.on("change", "#from-date", function () {
				self.refresh_data();
			});

			// To Date change
			this.wrapper.on("change", "#to-date", function () {
				self.refresh_data();
			});

			// Shift filter change
			this.wrapper.on("change", "#shift-filter", function () {
				self.refresh_data();
			});

			// Manufacturing Item change (fires on blur when value changes)
			// Also handle autocomplete selection
			this.wrapper.on("change", "#manufacturing-item", function () {
				// Clear any pending debounce timer
				if (self.debounce_timer) {
					clearTimeout(self.debounce_timer);
					self.debounce_timer = null;
				}
				self.refresh_data();
			});

			// Manufacturing Item input (debounced for instant refresh while typing)
			this.wrapper.on("input", "#manufacturing-item", function () {
				// Clear existing timer
				if (self.debounce_timer) {
					clearTimeout(self.debounce_timer);
				}
				// Set new timer to refresh after 500ms of no typing
				self.debounce_timer = setTimeout(function () {
					self.refresh_data();
				}, 500);
			});

			// Setup item autocomplete (with auto-refresh on selection)
			this.setup_item_autocomplete();
		}, 200);
	}

	setup_item_autocomplete() {
		const self = this;
		const input = document.getElementById("manufacturing-item");

		if (!input) return;

		// Create dropdown container
		const wrapper = document.getElementById("item-filter-wrapper");
		const dropdown = document.createElement("div");
		dropdown.className = "autocomplete-dropdown";
		dropdown.style.display = "none";
		wrapper.appendChild(dropdown);

		input.addEventListener("input", function () {
			const value = this.value.toLowerCase();
			const filtered = self.manufacturing_items.filter((item) =>
				item.toLowerCase().includes(value)
			);

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
			if (self.manufacturing_items.length > 0 && this.value.length === 0) {
				dropdown.innerHTML = self.manufacturing_items
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
				// Trigger change event to auto-refresh
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
			method: "hexplastics.api.production_log_dashboard.get_filter_options",
			async: true,
			callback: function (r) {
				if (r.message) {
					self.manufacturing_items = r.message.items || [];
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

		// Render chart if switching to process-loss tab
		if (tabId === "process-loss" && this.process_loss_data) {
			setTimeout(() => this.render_process_loss_chart(), 100);
		}
	}

	get_filters() {
		return {
			from_date: document.getElementById("from-date")?.value || "",
			to_date: document.getElementById("to-date")?.value || "",
			shift: document.getElementById("shift-filter")?.value || "All",
			manufacturing_item: document.getElementById("manufacturing-item")?.value || "",
		};
	}

	refresh_data() {
		const self = this;
		const filters = this.get_filters();

		// Show loading state
		this.show_loading();

		frappe.call({
			method: "hexplastics.api.production_log_dashboard.get_dashboard_data",
			args: filters,
			callback: function (r) {
				if (r.message) {
					self.update_overview(r.message.overview);
					self.update_log_book(r.message.log_book);
					self.update_entries(r.message.entries);
					self.process_loss_data = r.message.process_loss;
					self.update_process_loss(r.message.process_loss);
				}
				self.hide_loading();
			},
			error: function () {
				frappe.msgprint(__("Error loading dashboard data"));
				self.hide_loading();
			},
		});
	}

	show_loading() {
		this.wrapper.find(".kpi-value").addClass("loading-pulse");
		this.wrapper.find("#entries-loading").show();
		this.wrapper.find("#entries-table").hide();
	}

	hide_loading() {
		this.wrapper.find(".kpi-value").removeClass("loading-pulse");
		this.wrapper.find("#entries-loading").hide();
		this.wrapper.find("#entries-table").show();
	}

	format_number(value, decimals = 2) {
		if (value === null || value === undefined) return "0";

		const num = parseFloat(value);
		if (isNaN(num)) return "0";

		if (num >= 1000000) {
			return (num / 1000000).toFixed(decimals) + "M";
		} else if (num >= 1000) {
			return num.toLocaleString("en-IN", {
				minimumFractionDigits: decimals,
				maximumFractionDigits: decimals,
			});
		}
		return num.toFixed(decimals);
	}

	format_currency(value, decimals = 2) {
		if (value === null || value === undefined) return "₹ 0";

		const num = parseFloat(value);
		if (isNaN(num)) return "₹ 0";

		// Format with Indian number system (commas)
		const formatted = num.toLocaleString("en-IN", {
			minimumFractionDigits: decimals,
			maximumFractionDigits: decimals,
		});

		// Prefix with ₹ symbol
		return `₹ ${formatted}`;
	}

	update_overview(data) {
		if (!data) return;

		const setValue = (id, value, isInteger = false) => {
			const el = document.getElementById(id);
			if (el) {
				el.textContent = isInteger
					? this.format_number(value, 0)
					: this.format_number(value);
			}
		};

		setValue("total-manufactured-qty", data.total_manufactured_qty, true);
		setValue("total-net-weight", data.total_net_weight);
		setValue("total-process-loss", data.total_process_loss);
		setValue("total-mip-used", data.total_mip_used);
	}

	update_log_book(data) {
		if (!data) return;

		const setValue = (id, value, isCurrency = false) => {
			const el = document.getElementById(id);
			if (el) {
				el.textContent = isCurrency
					? this.format_currency(value)
					: this.format_number(value);
			}
		};

		setValue("total-costing", data.total_costing, true);
		setValue("total-prime-used", data.total_prime_used);
		setValue("total-rm-consumption", data.total_rm_consumption);
		setValue("lb-gross-weight", data.gross_weight);
		setValue("lb-net-weight", data.net_weight);
	}

	update_entries(entries) {
		const tbody = document.getElementById("entries-tbody");
		const noDataMsg = document.getElementById("no-entries-message");
		const table = document.getElementById("entries-table");

		if (!tbody) return;

		if (!entries || entries.length === 0) {
			tbody.innerHTML = "";
			if (noDataMsg) noDataMsg.style.display = "flex";
			if (table) table.style.display = "none";
			return;
		}

		if (noDataMsg) noDataMsg.style.display = "none";
		if (table) table.style.display = "table";

		tbody.innerHTML = entries
			.map(
				(entry) => `
            <tr>
                <td>
                    <a href="/app/production-log-book/${entry.production_log_book_id}" 
                       class="entry-link"
                       target="_blank">
                        ${entry.production_log_book_id}
                    </a>
                </td>
                <td>${this.format_date(entry.production_date)}</td>
                <td>
                    <span class="shift-badge shift-${(entry.shift_type || "").toLowerCase()}">
                        ${entry.shift_type || "-"}
                    </span>
                </td>
                <td class="text-right">${this.format_number(entry.manufactured_qty, 0)}</td>
                <td class="text-right">${this.format_number(entry.net_weight)}</td>
                <td class="text-right">${this.format_number(entry.total_consumption)}</td>
                <td class="text-right">${this.format_number(entry.prime_used)}</td>
                <td class="text-right">${this.format_number(entry.mip_used)}</td>
                <td class="text-right">${this.format_number(entry.per_piece_rate, 4)}</td>
                <td class="text-right">${this.format_number(entry.process_loss_weight)}</td>
            </tr>
        `
			)
			.join("");

		// Update scroll indicators after table update
		setTimeout(() => {
			this.update_scroll_indicators();
		}, 100);
	}

	format_date(dateStr) {
		if (!dateStr) return "-";
		const date = new Date(dateStr);
		return date.toLocaleDateString("en-IN", {
			day: "2-digit",
			month: "short",
			year: "numeric",
		});
	}

	update_process_loss(data) {
		if (!data) return;

		// Update table
		this.update_process_loss_table(data.table_data);

		// Render chart if tab is active
		if (this.wrapper.find("#process-loss-tab").hasClass("active")) {
			this.render_process_loss_chart();
		}
	}

	update_process_loss_table(table_data) {
		const tbody = document.getElementById("process-loss-tbody");
		const noDataMsg = document.getElementById("no-process-loss-message");

		if (!tbody) return;

		if (!table_data || table_data.length === 0) {
			tbody.innerHTML = "";
			if (noDataMsg) noDataMsg.style.display = "flex";
			return;
		}

		if (noDataMsg) noDataMsg.style.display = "none";

		tbody.innerHTML = table_data
			.map(
				(row) => `
            <tr>
                <td>${this.format_date(row.date)}</td>
                <td>
                    <span class="shift-badge shift-${(row.shift_type || "").toLowerCase()}">
                        ${row.shift_type || "-"}
                    </span>
                </td>
                <td class="text-center">${this.format_number(row.weight)}</td>
            </tr>
        `
			)
			.join("");
	}

	render_process_loss_chart() {
		if (!this.process_loss_data || !this.process_loss_data.chart_data) return;

		const chartContainer = document.getElementById("process-loss-chart");
		if (!chartContainer) return;

		const data = this.process_loss_data.chart_data;

		if (data.length === 0) {
			chartContainer.innerHTML =
				'<div class="no-chart-data">No data available for chart</div>';
			return;
		}

		// Prepare chart data
		const labels = data.map((d) => this.format_date(d.date));
		const dayData = data.map((d) => d.day_weight || 0);
		const nightData = data.map((d) => d.night_weight || 0);

		// Clear previous chart
		chartContainer.innerHTML = "";

		// Create chart using Frappe Charts
		try {
			this.chart = new frappe.Chart(chartContainer, {
				title: "",
				type: "bar",
				height: 300,
				// colors: ["#a2caf2", "#2188ed"],
				colors: ["#f7a64f", "#b56107"],
				data: {
					labels: labels,
					datasets: [
						{
							name: "Day Shift",
							values: dayData,
						},
						{
							name: "Night Shift",
							values: nightData,
						},
					],
				},
				barOptions: {
					spaceRatio: 0.4,
				},
				tooltipOptions: {
					formatTooltipX: (d) => d,
					formatTooltipY: (d) => d.toFixed(2) + " kg",
				},
			});
		} catch (e) {
			console.error("Error rendering chart:", e);
			chartContainer.innerHTML = '<div class="no-chart-data">Error rendering chart</div>';
		}
	}

	setup_table_scroll_indicators() {
		const self = this;
		const container = this.wrapper.find(".entries-table-container");

		if (container.length === 0) {
			// Retry after a delay if container not found
			setTimeout(() => self.setup_table_scroll_indicators(), 500);
			return;
		}

		// Update indicators on scroll
		container.on("scroll", function () {
			self.update_scroll_indicators();
		});

		// Update on resize
		$(window).on("resize", function () {
			self.update_scroll_indicators();
		});

		// Initial update
		setTimeout(() => {
			self.update_scroll_indicators();
		}, 300);
	}

	update_scroll_indicators() {
		const container = this.wrapper.find(".entries-table-container");
		if (container.length === 0) return;

		const element = container[0];
		const scrollTop = element.scrollTop;
		const scrollHeight = element.scrollHeight;
		const clientHeight = element.clientHeight;
		const scrollLeft = element.scrollLeft;
		const scrollWidth = element.scrollWidth;
		const clientWidth = element.clientWidth;

		// Vertical scroll indicators
		if (scrollTop > 5) {
			container.addClass("scrollable-top");
		} else {
			container.removeClass("scrollable-top");
		}

		if (scrollTop < scrollHeight - clientHeight - 5) {
			container.addClass("scrollable-bottom");
		} else {
			container.removeClass("scrollable-bottom");
		}

		// Horizontal scroll indicators (optional - can add if needed)
		// For now, we'll just ensure smooth scrolling
	}
}
