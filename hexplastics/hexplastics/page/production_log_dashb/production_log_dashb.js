frappe.pages["production-log-dashb"].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Production Log Book Dashboard",
		single_column: true,
	});

	// Hide Frappe's default page head/title - SCOPED to this page container only
	$(page.page_container).find(".page-head").hide();

	// Hide title elements within this page container only (not globally)
	setTimeout(function () {
		// Only hide elements within this page's container
		$(page.page_container).find(".page-title, .page-header h1, .page-title-wrapper").hide();
		$(page.page_container).find("h1, .page-title, .title").not(".dashboard-title").hide();

		// Also hide the title from the page object if it exists
		if (page.page_title) {
			$(page.page_title).hide();
		}

		// Hide breadcrumbs within this page container
		$(page.page_container).find(".page-header, .page-breadcrumbs").hide();
	}, 100);

	// Also check after a longer delay in case elements load later - SCOPED
	setTimeout(function () {
		$(page.page_container)
			.find(".page-title, .page-header h1, .page-title-wrapper, .page-head")
			.hide();
		$(page.page_container).find("h1").not(".dashboard-title").hide();
	}, 500);

	// Note: Full width styling is now handled purely via CSS with body[data-page-route] selectors
	// This prevents polluting global styles when navigating away from the dashboard

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
		this.initial_load = true; // Flag to track initial page load

		this.init();
	}

	init() {
		this.load_html();
		this.setup_styles();
		this.bind_events();
		this.load_filter_options();
		// Note: Default dates are set and data is fetched in load_html() callback
		// to ensure HTML is loaded first
		this.setup_table_scroll_indicators();
	}

	load_html() {
		const self = this;
		frappe.require("/assets/hexplastics/css/production_log_dashboard.css", () => {
			this.wrapper.html(frappe.render_template("production_log_dashb"));
			// After HTML is loaded, set default dates and fetch data
			setTimeout(() => {
				self.set_default_dates();
				// Ensure dates are set before fetching data
				// Use a small delay to ensure DOM is fully ready
				setTimeout(() => {
					self.refresh_data();
					// Mark initial load as complete after first data fetch
					setTimeout(() => {
						self.initial_load = false;
					}, 100);
				}, 50);
			}, 100);
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
		// Set default date range: From Date = Today - 7 days, To Date = Today
		const today = new Date();
		const fromDate = new Date(today);
		fromDate.setDate(today.getDate() - 7);

		const formatDate = (date) => {
			return date.toISOString().split("T")[0];
		};

		const fromDateInput = document.getElementById("from-date");
		const toDateInput = document.getElementById("to-date");

		if (fromDateInput && toDateInput) {
			// Set values without triggering change events (we'll fetch data explicitly)
			fromDateInput.value = formatDate(fromDate);
			toDateInput.value = formatDate(today);
		}
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

			// Export buttons
			// Chart export - direct PNG export
			this.wrapper.on("click", "#export-chart-btn", function () {
				self.export_chart_png();
			});

			// Table exports - show dropdown menu
			this.wrapper.on("click", "#export-logbook-btn", function (e) {
				e.stopPropagation();
				self.show_table_export_menu($(this), "entries-table", "Production_Log_Book");
			});

			this.wrapper.on("click", "#export-processloss-btn", function (e) {
				e.stopPropagation();
				self.show_table_export_menu($(this), "process-loss-table", "Process_Loss_Details");
			});

			// Close dropdown when clicking outside
			$(document).on("click", function (e) {
				if (!$(e.target).closest(".export-btn, .export-dropdown-menu").length) {
					$(".export-dropdown-menu").remove();
				}
			});

			// Enter key on filters
			this.wrapper.on("keypress", ".filter-input", function (e) {
				if (e.which === 13) {
					self.refresh_data();
				}
			});

			// Auto-refresh on filter changes
			// From Date change (skip on initial load to avoid double fetch)
			this.wrapper.on("change", "#from-date", function () {
				if (!self.initial_load) {
					self.refresh_data();
				}
			});

			// To Date change (skip on initial load to avoid double fetch)
			this.wrapper.on("change", "#to-date", function () {
				if (!self.initial_load) {
					self.refresh_data();
				}
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

		setValue("total-standard-weight", data.total_standard_weight);
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

		// Total Costing - Commented out for now
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
                <!-- <td class="text-right">${this.format_number(entry.per_piece_rate, 4)}</td> -->
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

	// ===== Export Functionality =====

	get_date_string() {
		const today = new Date();
		return today.toISOString().split("T")[0];
	}

	show_table_export_menu(button, tableClass, filePrefix) {
		const self = this;

		// Remove any existing dropdown (check both wrapper and body)
		this.wrapper.find(".export-dropdown-menu").remove();
		$(".export-dropdown-menu").remove();

		// Get button position
		const offset = button.offset();
		const width = button.outerWidth();

		// Create dropdown menu
		const dropdown = $('<div class="export-dropdown-menu"></div>');
		dropdown.html(`
			<div class="export-menu-item" data-format="excel">
				<svg class="export-menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
					<polyline points="14 2 14 8 20 8"></polyline>
					<line x1="16" y1="13" x2="8" y2="13"></line>
					<line x1="16" y1="17" x2="8" y2="17"></line>
				</svg>
				<span>Excel</span>
			</div>
			<div class="export-menu-item" data-format="pdf">
				<svg class="export-menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
					<polyline points="14 2 14 8 20 8"></polyline>
					<path d="M9 15v-2h6v2"></path>
					<path d="M12 13v5"></path>
				</svg>
				<span>PDF</span>
			</div>
		`);

		// Position dropdown
		dropdown.css({
			position: "absolute",
			top: offset.top + button.outerHeight() + 4 + "px",
			left: offset.left + "px",
			zIndex: 1000,
		});

		// Add to body for proper positioning
		$("body").append(dropdown);

		// Handle menu item clicks
		dropdown.on("click", ".export-menu-item", function (e) {
			e.stopPropagation();
			const format = $(this).data("format");
			dropdown.remove();

			if (format === "excel") {
				self.export_table_excel(tableClass, filePrefix);
			} else if (format === "pdf") {
				self.export_table_pdf(tableClass, filePrefix);
			}
		});

		// Close on outside click
		setTimeout(() => {
			$(document).one("click", function () {
				dropdown.remove();
			});
		}, 0);
	}

	export_chart_png() {
		const self = this;
		const btn = this.wrapper.find("#export-chart-btn");

		if (!this.chart) {
			frappe.msgprint(__("No chart data available to export"));
			return;
		}

		// Add loading state
		btn.addClass("exporting");
		btn.prop("disabled", true);

		// Always use canvas conversion to ensure PNG format
		// Frappe Charts export() might export as SVG, so we'll convert SVG to PNG
		this.export_chart_canvas_fallback();
	}

	export_chart_canvas_fallback() {
		const self = this;
		const btn = this.wrapper.find("#export-chart-btn");
		const chartContainer = document.getElementById("process-loss-chart");

		if (!chartContainer) {
			frappe.msgprint(__("Chart container not found"));
			btn.removeClass("exporting").prop("disabled", false);
			return;
		}

		const svg = chartContainer.querySelector("svg");
		if (!svg) {
			frappe.msgprint(__("No chart SVG found to export"));
			btn.removeClass("exporting").prop("disabled", false);
			return;
		}

		// Clone the SVG and prepare for export
		const svgClone = svg.cloneNode(true);

		// Get SVG dimensions
		const svgWidth = svg.getAttribute("width") || svg.clientWidth || 800;
		const svgHeight = svg.getAttribute("height") || svg.clientHeight || 400;

		// Ensure SVG has proper viewBox and dimensions
		if (!svgClone.getAttribute("viewBox")) {
			svgClone.setAttribute("viewBox", `0 0 ${svgWidth} ${svgHeight}`);
		}
		svgClone.setAttribute("width", svgWidth);
		svgClone.setAttribute("height", svgHeight);

		const svgData = new XMLSerializer().serializeToString(svgClone);
		const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
		const svgUrl = URL.createObjectURL(svgBlob);

		// Create canvas and draw SVG
		const canvas = document.createElement("canvas");
		const ctx = canvas.getContext("2d");
		const img = new Image();

		img.onload = () => {
			try {
				// Set canvas dimensions
				canvas.width = parseInt(svgWidth);
				canvas.height = parseInt(svgHeight);

				// Fill white background
				ctx.fillStyle = "#ffffff";
				ctx.fillRect(0, 0, canvas.width, canvas.height);

				// Draw image
				ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

				// Convert to PNG and download
				canvas.toBlob(
					(blob) => {
						if (blob) {
							const url = URL.createObjectURL(blob);
							const link = document.createElement("a");
							link.download = `Production_Dashboard_Chart_${this.get_date_string()}.png`;
							link.href = url;
							link.style.display = "none";
							document.body.appendChild(link);
							link.click();
							document.body.removeChild(link);

							// Clean up
							setTimeout(() => {
								URL.revokeObjectURL(url);
								URL.revokeObjectURL(svgUrl);
							}, 100);

							frappe.show_alert({
								message: __("Chart exported successfully as PNG"),
								indicator: "green",
							});
						} else {
							throw new Error("Failed to create PNG blob");
						}
					},
					"image/png",
					1.0
				);
			} catch (error) {
				console.error("Error converting to PNG:", error);
				frappe.msgprint(__("Failed to export chart. Please try again."));
			} finally {
				// Remove loading state
				btn.removeClass("exporting").prop("disabled", false);
			}
		};

		img.onerror = () => {
			frappe.msgprint(__("Failed to export chart. Please try again."));
			URL.revokeObjectURL(svgUrl);
			btn.removeClass("exporting").prop("disabled", false);
		};

		img.src = svgUrl;
	}

	export_table_excel(tableClass, filePrefix) {
		const self = this;
		const btn = this.wrapper.find(
			tableClass === "entries-table" ? "#export-logbook-excel" : "#export-processloss-excel"
		);

		// Add loading state
		btn.addClass("exporting");
		btn.prop("disabled", true);

		try {
			const tableData = this.get_table_data(tableClass);

			if (!tableData || tableData.rows.length === 0) {
				frappe.msgprint(__("No data available to export"));
				btn.removeClass("exporting");
				btn.prop("disabled", false);
				return;
			}

			// Use Frappe's built-in CSV download (converts to Excel compatible format)
			this.download_as_csv(tableData, `${filePrefix}_${this.get_date_string()}.csv`);

			frappe.show_alert({
				message: __("Table exported successfully"),
				indicator: "green",
			});
		} catch (e) {
			console.error("Excel export error:", e);
			frappe.msgprint(__("Failed to export table. Please try again."));
		} finally {
			setTimeout(() => {
				btn.removeClass("exporting");
				btn.prop("disabled", false);
			}, 500);
		}
	}

	get_table_data(tableClass) {
		let table;

		if (tableClass === "entries-table") {
			table = document.getElementById("entries-table");
		} else {
			table = this.wrapper.find(".process-loss-table")[0];
		}

		if (!table) return null;

		const headers = [];
		const rows = [];

		// Get headers
		const headerCells = table.querySelectorAll("thead th");
		headerCells.forEach((th) => {
			headers.push(th.textContent.trim());
		});

		// Get rows
		const bodyRows = table.querySelectorAll("tbody tr");
		bodyRows.forEach((tr) => {
			const rowData = [];
			const cells = tr.querySelectorAll("td");
			cells.forEach((td) => {
				// Get text content, clean it up
				let text = td.textContent.trim();
				// Remove extra whitespace
				text = text.replace(/\s+/g, " ");
				rowData.push(text);
			});
			if (rowData.length > 0) {
				rows.push(rowData);
			}
		});

		return { headers, rows };
	}

	download_as_csv(tableData, filename) {
		const { headers, rows } = tableData;

		// Build CSV content
		let csv = "";

		// Add headers
		csv += headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(",") + "\n";

		// Add rows
		rows.forEach((row) => {
			csv += row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",") + "\n";
		});

		// Create blob and download
		const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
		const link = document.createElement("a");
		const url = URL.createObjectURL(blob);

		link.setAttribute("href", url);
		link.setAttribute("download", filename);
		link.style.visibility = "hidden";
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	}

	export_table_pdf(tableClass, filePrefix) {
		const self = this;
		const btn = this.wrapper.find(
			tableClass === "entries-table" ? "#export-logbook-btn" : "#export-processloss-btn"
		);

		// Add loading state
		btn.addClass("exporting");
		btn.prop("disabled", true);

		try {
			const tableData = this.get_table_data(tableClass);

			if (!tableData || tableData.rows.length === 0) {
				frappe.msgprint(__("No data available to export"));
				btn.removeClass("exporting");
				btn.prop("disabled", false);
				return;
			}

			// Load jsPDF and generate PDF directly
			this.load_jspdf_and_export(tableData, filePrefix, btn);
		} catch (e) {
			console.error("PDF export error:", e);
			frappe.msgprint(__("Failed to export PDF. Please try again."));
			btn.removeClass("exporting");
			btn.prop("disabled", false);
		}
	}

	load_jspdf_and_export(tableData, filePrefix, btn) {
		const self = this;

		// Check if jsPDF is already loaded
		if (typeof window.jspdf !== "undefined" && window.jspdf.jsPDF) {
			this.generate_pdf_with_jspdf(tableData, filePrefix, btn);
			return;
		}

		// Load jsPDF from CDN
		const script = document.createElement("script");
		script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
		script.onload = () => {
			// Load jsPDF AutoTable plugin
			const autoTableScript = document.createElement("script");
			autoTableScript.src =
				"https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js";
			autoTableScript.onload = () => {
				self.generate_pdf_with_jspdf(tableData, filePrefix, btn);
			};
			autoTableScript.onerror = () => {
				// If autoTable fails, generate PDF without it
				self.generate_pdf_with_jspdf(tableData, filePrefix, btn);
			};
			document.head.appendChild(autoTableScript);
		};
		script.onerror = () => {
			frappe.msgprint(
				__("Failed to load PDF library. Please check your internet connection.")
			);
			btn.removeClass("exporting").prop("disabled", false);
		};
		document.head.appendChild(script);
	}

	generate_pdf_with_jspdf(tableData, filePrefix, btn) {
		const self = this;
		const { headers, rows } = tableData;
		const filters = this.get_filters();

		try {
			// Get jsPDF from window
			const { jsPDF } = window.jspdf || window.jspdf.jsPDF || window;

			// Create new PDF document (landscape orientation for tables)
			const doc = new jsPDF({
				orientation: "landscape",
				unit: "mm",
				format: "a4",
			});

			// Add header
			doc.setFontSize(16);
			doc.setFont(undefined, "bold");
			doc.text("Production Log Book Dashboard", 148, 15, { align: "center" });

			doc.setFontSize(10);
			doc.setFont(undefined, "normal");
			doc.text(filePrefix.replace(/_/g, " ") + " Report", 148, 22, { align: "center" });

			// Add filter information
			let yPos = 30;
			doc.setFontSize(9);
			const filterText = `From: ${filters.from_date || "N/A"} | To: ${
				filters.to_date || "N/A"
			} | Shift: ${filters.shift || "All"}${
				filters.manufacturing_item ? ` | Item: ${filters.manufacturing_item}` : ""
			}`;
			doc.text(filterText, 14, yPos);

			// Prepare table data
			const tableRows = rows.map((row) => row.map((cell) => String(cell)));

			// Use autoTable if available, otherwise manual table
			if (typeof doc.autoTable !== "undefined") {
				doc.autoTable({
					head: [headers],
					body: tableRows,
					startY: yPos + 8,
					styles: {
						fontSize: 8,
						cellPadding: 2,
						overflow: "linebreak",
					},
					headStyles: {
						fillColor: [31, 39, 46],
						textColor: [255, 255, 255],
						fontStyle: "bold",
						fontSize: 8,
					},
					alternateRowStyles: {
						fillColor: [249, 249, 250],
					},
					margin: { top: yPos + 8, left: 14, right: 14 },
					columnStyles: {},
				});
			} else {
				// Fallback: simple table without autoTable
				this.add_simple_table_to_pdf(doc, headers, tableRows, yPos + 8);
			}

			// Add footer
			const pageCount = doc.internal.getNumberOfPages();
			for (let i = 1; i <= pageCount; i++) {
				doc.setPage(i);
				doc.setFontSize(8);
				doc.text(
					`Generated on ${new Date().toLocaleString("en-IN")} | Total Records: ${
						rows.length
					} | Page ${i} of ${pageCount}`,
					148,
					200,
					{ align: "center" }
				);
			}

			// Save PDF
			const filename = `${filePrefix}_${this.get_date_string()}.pdf`;
			doc.save(filename);

			// Reset button state
			btn.removeClass("exporting").prop("disabled", false);
			frappe.show_alert({
				message: __("PDF exported successfully"),
				indicator: "green",
			});
		} catch (error) {
			console.error("PDF generation error:", error);
			frappe.msgprint(__("Failed to generate PDF. Please try again."));
			btn.removeClass("exporting").prop("disabled", false);
		}
	}

	add_simple_table_to_pdf(doc, headers, rows, startY) {
		const colWidth = 270 / headers.length; // A4 landscape width minus margins
		let yPos = startY;
		const rowHeight = 7;

		// Draw header
		doc.setFillColor(31, 39, 46);
		doc.rect(14, yPos, 270, rowHeight, "F");
		doc.setTextColor(255, 255, 255);
		doc.setFont(undefined, "bold");
		doc.setFontSize(8);

		headers.forEach((header, idx) => {
			doc.text(header.substring(0, 20), 14 + idx * colWidth + 2, yPos + 5);
		});

		yPos += rowHeight;
		doc.setTextColor(0, 0, 0);
		doc.setFont(undefined, "normal");

		// Draw rows
		rows.forEach((row, rowIdx) => {
			if (yPos > 190) {
				// New page
				doc.addPage();
				yPos = 20;
			}

			if (rowIdx % 2 === 0) {
				doc.setFillColor(249, 249, 250);
				doc.rect(14, yPos, 270, rowHeight, "F");
			}

			row.forEach((cell, colIdx) => {
				doc.text(String(cell).substring(0, 20), 14 + colIdx * colWidth + 2, yPos + 5);
			});

			yPos += rowHeight;
		});
	}
}
