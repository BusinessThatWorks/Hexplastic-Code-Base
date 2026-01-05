// Copyright (c) 2025, beetashoke chakraborty and contributors
// For license information, please see license.txt

frappe.pages["daily-rejection-dashboard"].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Rejection Dashboard",
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
	new RejectionDashboard(page);
};

class RejectionDashboard {
	constructor(page) {
		this.page = page;
		this.wrapper = $(page.body);
		this.chart = null;
		this.active_tab = "overview";

		this.init();
	}

	init() {
		this.load_html();
		this.setup_styles();
		this.bind_events();
		this.refresh_data();
	}

	load_html() {
		frappe.require("/assets/hexplastics/css/daily_rejection_dashboard.css", () => {
			this.wrapper.html(frappe.render_template("daily_rejection_dashboard"));
		});
	}

	setup_styles() {
		// Dynamic styles scoped to daily rejection dashboard only
		const style = document.createElement("style");
		style.id = "daily-rejection-dashboard-styles";
		style.textContent = `
            /* Scoped styles - only apply within the dashboard */
            .daily-rejection-dashboard .frappe-control {
                margin: 0 !important;
            }
            .daily-rejection-dashboard {
                width: 100% !important;
                max-width: 100% !important;
            }
        `;

		// Only add if not already present
		if (!document.getElementById("daily-rejection-dashboard-styles")) {
			document.head.appendChild(style);
		}
	}

	bind_events() {
		const self = this;

		// Wait for DOM to be ready
		setTimeout(() => {
			// Tab switching
			this.wrapper.on("click", ".tab-btn", function () {
				const tab = $(this).data("tab");
				self.switch_tab(tab);
			});

			// Auto-refresh on filter changes
			this.wrapper.on("change", "#period-filter, #shift-filter, #date-from-filter, #date-to-filter", function () {
				self.refresh_data();
			});
		}, 200);
	}

	switch_tab(tab) {
		// Update active tab
		this.active_tab = tab;

		// Update tab buttons
		this.wrapper.find(".tab-btn").removeClass("active");
		this.wrapper.find(`.tab-btn[data-tab="${tab}"]`).addClass("active");

		// Update tab content
		this.wrapper.find(".tab-content").removeClass("active");
		this.wrapper.find(`#${tab}-tab`).addClass("active");

		// Refresh data for the new tab
		this.refresh_data();
	}

	get_filters() {
		const date_from = document.getElementById("date-from-filter")?.value || "";
		const date_to = document.getElementById("date-to-filter")?.value || "";
		
		// If both dates are provided, use Custom period
		// Otherwise use the selected period
		let period = document.getElementById("period-filter")?.value || "Weekly";
		if (date_from && date_to) {
			period = "Custom";
		}
		
		const filters = {
			period: period,
			shift: document.getElementById("shift-filter")?.value || "All",
		};

		// Add date range if available
		if (date_from && date_to) {
			filters.date_from = date_from;
			filters.date_to = date_to;
		}

		return filters;
	}

	refresh_data() {
		const filters = this.get_filters();

		// If using custom date range, validate
		if (filters.period === "Custom") {
			if (!filters.date_from || !filters.date_to) {
				// Don't refresh if custom dates are not both selected
				return;
			}
			
			// Validate date range
			if (new Date(filters.date_from) > new Date(filters.date_to)) {
				frappe.msgprint(__("'From Date' cannot be later than 'To Date'"));
				return;
			}
		}

		// Always refresh based on active tab
		if (this.active_tab === "overview") {
			this.refresh_overview(filters);
		} else if (this.active_tab === "rejection-data") {
			this.refresh_graph(filters);
			this.refresh_table(filters);
		}
	}

	refresh_overview(filters) {
		const self = this;

		// Show loading state
		this.show_kpi_loading();

		frappe.call({
			method: "hexplastics.api.daily_rejection_dashboard.get_overview_metrics",
			args: filters,
			callback: function (r) {
				if (r.message) {
					self.render_kpi_cards(r.message);
				}
			},
			error: function () {
				frappe.msgprint(__("Error loading overview metrics"));
			},
		});
	}

	refresh_graph(filters) {
		const self = this;

		// Show loading state
		this.show_loading();

		frappe.call({
			method: "hexplastics.api.daily_rejection_dashboard.get_rejection_graph_data",
			args: filters,
			callback: function (r) {
				if (r.message) {
					self.render_chart(r.message);
				}
				self.hide_loading();
			},
			error: function () {
				frappe.msgprint(__("Error loading graph data"));
				self.hide_loading();
			},
		});
	}

	refresh_table(filters) {
		const self = this;

		frappe.call({
			method: "hexplastics.api.daily_rejection_dashboard.get_rejection_table_data",
			args: filters,
			callback: function (r) {
				if (r.message) {
					self.render_table(r.message);
				}
			},
			error: function () {
				frappe.msgprint(__("Error loading table data"));
			},
		});
	}

	show_kpi_loading() {
		$("#kpi-total-box").html('<div class="kpi-loading"></div>');
		$("#kpi-total-rejection").html('<div class="kpi-loading"></div>');
		$("#kpi-rejection-pct").html('<div class="kpi-loading"></div>');
	}

	render_kpi_cards(data) {
		$("#kpi-total-box").text(this.format_number(data.total_box_checked, 0));
		$("#kpi-total-rejection").text(this.format_number(data.total_rejection, 0));
		$("#kpi-rejection-pct").text(this.format_number(data.rejection_percentage, 2) + "%");
	}

	show_loading() {
		const chartContainer = document.getElementById("rejection-chart");
		const noDataMsg = document.getElementById("no-chart-data-message");

		if (chartContainer) {
			chartContainer.innerHTML =
				'<div class="loading-spinner-container"><div class="loading-spinner"></div><span>Loading chart data...</span></div>';
		}
		if (noDataMsg) {
			noDataMsg.style.display = "none";
		}
	}

	hide_loading() {
		// Loading will be replaced by chart or no-data message
	}

	format_number(value, decimals = 2) {
		if (value === null || value === undefined) return "0";

		const num = parseFloat(value);
		if (isNaN(num)) return "0";

		// Format with thousands separator
		if (decimals === 0) {
			return num.toLocaleString("en-US", {
				maximumFractionDigits: 0,
				minimumFractionDigits: 0,
			});
		}

		return num.toFixed(decimals);
	}

	render_chart(data) {
		const chartContainer = document.getElementById("rejection-chart");
		const noDataMsg = document.getElementById("no-chart-data-message");

		if (!chartContainer) return;

		if (!data || !data.labels || data.labels.length === 0) {
			chartContainer.innerHTML = "";
			if (noDataMsg) {
				noDataMsg.style.display = "flex";
			}
			return;
		}

		if (noDataMsg) {
			noDataMsg.style.display = "none";
		}

		// Clear previous chart
		chartContainer.innerHTML = "";

		// Prepare chart data
		const labels = data.labels;
		const values = data.values;

		// Create chart using Frappe Charts
		try {
			this.chart = new frappe.Chart(chartContainer, {
				title: "",
				type: "line", // Line chart for trend visualization
				height: 400,
				colors: ["#e24c4c"], // Red color for rejection percentage
				data: {
					labels: labels,
					datasets: [
						{
							name: "Rejection %",
							values: values,
						},
					],
				},
				lineOptions: {
					regionFill: 1,
					dotSize: 4,
					hideDots: 0,
				},
				tooltipOptions: {
					formatTooltipX: (d) => d,
					formatTooltipY: (d) => this.format_number(d, 2) + "%",
				},
				axisOptions: {
					xAxisMode: "tick",
					yAxisMode: "tick",
					xIsSeries: 0,
				},
			});
		} catch (e) {
			console.error("Error rendering chart:", e);
			chartContainer.innerHTML = '<div class="no-chart-data">Error rendering chart</div>';
		}
	}

	render_table(data) {
		const tableContainer = document.getElementById("rejection-table");
		const noDataMsg = document.getElementById("no-table-data-message");

		if (!tableContainer) return;

		if (!data || data.length === 0) {
			tableContainer.innerHTML = "";
			if (noDataMsg) {
				noDataMsg.style.display = "flex";
			}
			return;
		}

		if (noDataMsg) {
			noDataMsg.style.display = "none";
		}

		// Build table HTML
		let tableHTML = `
			<table class="rejection-table">
				<thead>
					<tr>
						<th>ID</th>
						<th>Date</th>
						<th>Total Box Checked</th>
						<th>Day Shift Rejection</th>
						<th>Night Shift Rejection</th>
						<th>Total Rejection</th>
						<th>Rejection %</th>
					</tr>
				</thead>
				<tbody>
		`;

		data.forEach((row) => {
			tableHTML += `
				<tr>
					<td><a href="/app/daily-rejection-data/${row.id}" target="_blank">${row.id}</a></td>
					<td>${frappe.datetime.str_to_user(row.rejection_date)}</td>
					<td>${this.format_number(row.total_box_checked, 0)}</td>
					<td>${this.format_number(row.day_shift_rejection, 0)}</td>
					<td>${this.format_number(row.night_shift_rejection, 0)}</td>
					<td>${this.format_number(row.total_rejection, 0)}</td>
					<td><span class="rejection-badge">${this.format_number(row.rejection_percentage, 2)}%</span></td>
				</tr>
			`;
		});

		tableHTML += `
				</tbody>
			</table>
		`;

		tableContainer.innerHTML = tableHTML;
	}
}

