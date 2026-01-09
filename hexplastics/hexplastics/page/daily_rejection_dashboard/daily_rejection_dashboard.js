// Copyright (c) 2025, beetashoke chakraborty and contributors
// For license information, please see license.txt

frappe.pages["daily-rejection-dashboard"].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Rejection Dashboard",
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

			// Period filter change handler with special logic
			this.wrapper.on("change", "#period-filter", function () {
				self.handle_period_change();
			});

			// Auto-refresh on other filter changes (shift, dates)
			this.wrapper.on(
				"change",
				"#shift-filter, #date-from-filter, #date-to-filter",
				function () {
					self.refresh_data();
				}
			);

			// Export buttons
			// Chart export - direct PNG export
			this.wrapper.on("click", "#export-rejection-chart-btn", function () {
				self.export_chart_png();
			});

			// Table exports - show dropdown menu
			this.wrapper.on("click", "#export-rejection-table-btn", function (e) {
				e.stopPropagation();
				self.show_table_export_menu($(this));
			});

			// Close dropdown when clicking outside
			$(document).on("click", function (e) {
				if (!$(e.target).closest(".export-btn, .export-dropdown-menu").length) {
					$(".export-dropdown-menu").remove();
				}
			});
		}, 200);
	}

	handle_period_change() {
		const periodFilter = document.getElementById("period-filter");
		const dateFromFilter = document.getElementById("date-from-filter");
		const dateToFilter = document.getElementById("date-to-filter");

		if (!periodFilter) return;

		const period = periodFilter.value;

		if (period === "") {
			// Blank (default): Reset dashboard to clean slate
			// 1. Clear date fields
			if (dateFromFilter) dateFromFilter.value = "";
			if (dateToFilter) dateToFilter.value = "";

			// 2. Reset dashboard to default empty state
			this.reset_dashboard_to_default();

			return;
		} else if (period === "Weekly") {
			// Weekly: Auto-set From Date = Today - 7 days, To Date = Today
			const today = new Date();
			const sevenDaysAgo = new Date();
			sevenDaysAgo.setDate(today.getDate() - 7);

			// Format dates as YYYY-MM-DD for input fields
			const formatDate = (d) => {
				const year = d.getFullYear();
				const month = String(d.getMonth() + 1).padStart(2, "0");
				const day = String(d.getDate()).padStart(2, "0");
				return `${year}-${month}-${day}`;
			};

			if (dateFromFilter) dateFromFilter.value = formatDate(sevenDaysAgo);
			if (dateToFilter) dateToFilter.value = formatDate(today);

			// Auto refresh dashboard
			this.refresh_data();
		} else if (period === "Monthly" || period === "Yearly") {
			// Monthly/Yearly: Clear date fields, backend handles logic
			if (dateFromFilter) dateFromFilter.value = "";
			if (dateToFilter) dateToFilter.value = "";

			// Auto refresh dashboard
			this.refresh_data();
		}
	}

	reset_dashboard_to_default() {
		// Reset KPI cards to default empty state (show "-" like initial state)
		$("#kpi-total-box").text("-");
		$("#kpi-total-rejection").text("-");
		$("#kpi-rejection-pct").text("-");

		// Reset chart to empty state
		const chartContainer = document.getElementById("rejection-chart");
		const noDataMsg = document.getElementById("no-chart-data-message");

		if (chartContainer) {
			chartContainer.innerHTML = "";

			// Destroy existing chart instance to clear all state
			if (this.chart) {
				this.chart = null;
			}
		}

		if (noDataMsg) {
			noDataMsg.style.display = "flex";
		}

		// Clear the table
		const tableContainer = document.getElementById("rejection-table");
		const noTableDataMsg = document.getElementById("no-table-data-message");

		if (tableContainer) {
			tableContainer.innerHTML = "";
		}

		if (noTableDataMsg) {
			noTableDataMsg.style.display = "flex";
		}

		// Clear any stored chart values
		this.chart_values = null;
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

		// Get selected period (can be blank)
		let period = document.getElementById("period-filter")?.value || "";

		// If both dates are provided, use Custom period (overrides selected period)
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

		// If period is blank and no custom dates, don't refresh
		if (filters.period === "" && !filters.date_from && !filters.date_to) {
			return;
		}

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

		// Hide the no data message - we'll show empty chart instead
		if (noDataMsg) {
			noDataMsg.style.display = "none";
		}

		// Clear previous chart
		chartContainer.innerHTML = "";

		// If no data, show an empty chart with default labels
		let labels, values;
		if (!data || !data.labels || data.labels.length === 0) {
			// Create empty chart with placeholder labels
			labels = ["No Data"];
			values = [0];
		} else {
			labels = data.labels;
			values = data.values;
		}

		// Store values for label rendering
		this.chart_values = values;

		// Create chart using Frappe Charts - BAR CHART IMPLEMENTATION
		try {
			// Format values with % sign for display on bars
			const formattedValues = values.map((v) => {
				const num = parseFloat(v) || 0;
				if (num === 0) return "0%";
				if (num >= 10) return num.toFixed(1) + "%";
				return num.toFixed(2) + "%";
			});

			this.chart = new frappe.Chart(chartContainer, {
				title: "",
				type: "bar", // Bar chart for rejection analysis
				height: 450, // Increased height for label visibility at top
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
				barOptions: {
					spaceRatio: 0.4, // Space between bars
				},
				valuesOverPoints: 1, // Show values on top of bars (built-in Frappe Charts feature)
				tooltipOptions: {
					formatTooltipX: (d) => d,
					formatTooltipY: (d) => this.format_number(d, 2) + "%",
				},
				axisOptions: {
					xAxisMode: "tick",
					yAxisMode: "tick",
					xIsSeries: 0,
				},
				// Disable animations for stable label positioning
				animate: 0,
			});

			// Add % suffix to non-zero values and hide zero labels
			const addPercentSuffix = () => {
				this.add_percent_suffix_to_bar_labels(chartContainer, values);
			};
			// Multiple attempts to ensure labels are processed after chart renders
			setTimeout(addPercentSuffix.bind(this), 100);
			setTimeout(addPercentSuffix.bind(this), 300);
			setTimeout(addPercentSuffix.bind(this), 600);
			setTimeout(addPercentSuffix.bind(this), 1000);
			setTimeout(addPercentSuffix.bind(this), 1500);
		} catch (e) {
			console.error("Error rendering chart:", e);
			chartContainer.innerHTML = '<div class="no-chart-data">Error rendering chart</div>';
		}
	}

	// ===== ADD PERCENT SUFFIX TO BAR LABELS AND HIDE ZEROS ON BARS =====
	add_percent_suffix_to_bar_labels(container, values) {
		const svg = container.querySelector("svg");
		if (!svg) return;

		// Get all text elements in the SVG
		const allTexts = Array.from(svg.querySelectorAll("text"));

		// X-axis labels to skip (month names, day names)
		const months = [
			"Jan",
			"Feb",
			"Mar",
			"Apr",
			"May",
			"Jun",
			"Jul",
			"Aug",
			"Sep",
			"Oct",
			"Nov",
			"Dec",
		];
		const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

		allTexts.forEach((textEl) => {
			const content = textEl.textContent.trim();
			const textAnchor = textEl.getAttribute("text-anchor") || "";

			// Skip X-axis labels (month names, day names, years)
			if (months.some((m) => content.includes(m))) return;
			if (days.some((d) => content.includes(d))) return;
			if (/^\d{4}$/.test(content)) return; // Year like 2024, 2025

			// Skip Y-axis labels - they typically have text-anchor="end"
			// Bar value labels have text-anchor="middle"
			if (textAnchor === "end") return;

			// Check if it's a numeric value
			const numContent = parseFloat(content);
			if (isNaN(numContent)) return;

			// Already has % - skip
			if (content.includes("%")) return;

			// Check if this value matches our data (to avoid modifying other numbers)
			const matchesData = values.some((v) => {
				const dataVal = parseFloat(v);
				return Math.abs(dataVal - numContent) < 0.01;
			});
			if (!matchesData) return;

			// This is a numeric value on top of a bar
			if (numContent === 0) {
				// Zero value - keep it visible, just style it
				textEl.setAttribute("fill", "#c0392b");
				textEl.setAttribute("font-weight", "500");
				textEl.setAttribute("font-size", "11");
			} else {
				// Non-zero value - add % suffix and style
				if (numContent >= 10) {
					textEl.textContent = numContent.toFixed(1) + "%";
				} else {
					textEl.textContent = numContent.toFixed(2) + "%";
				}
				// Style the label
				textEl.setAttribute("fill", "#c0392b");
				textEl.setAttribute("font-weight", "500");
				textEl.setAttribute("font-size", "11");
			}
		});
	}

	/* ===== COMMENTED OUT: ORIGINAL LINE CHART IMPLEMENTATION =====
	 * Preserved for future use if line chart visualization is needed again.
	 * 
	render_chart_line_graph(data) {
		const chartContainer = document.getElementById("rejection-chart");
		const noDataMsg = document.getElementById("no-chart-data-message");

		if (!chartContainer) return;

		// Hide the no data message - we'll show empty chart instead
		if (noDataMsg) {
			noDataMsg.style.display = "none";
		}

		// Clear previous chart
		chartContainer.innerHTML = "";

		// If no data, show an empty chart with default labels
		let labels, values;
		if (!data || !data.labels || data.labels.length === 0) {
			// Create empty chart with placeholder labels
			labels = ["No Data"];
			values = [0];
		} else {
			labels = data.labels;
			values = data.values;
		}

		// Store values for label rendering
		this.chart_values = values;

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
				// Disable animations to ensure stable positions
				animate: 0,
			});

			// Add custom data point labels after chart renders
			// Only add labels if there's real data (not just placeholder)
			const hasRealData = values.some((v) => parseFloat(v) !== 0);

			if (hasRealData) {
				const addLabels = () => {
					this.add_data_point_labels(chartContainer, values);
				};

				// Multiple attempts at different timings
				setTimeout(addLabels.bind(this), 100);
				setTimeout(addLabels.bind(this), 250);
				setTimeout(addLabels.bind(this), 500);
				setTimeout(addLabels.bind(this), 1000);
				setTimeout(addLabels.bind(this), 2000);
			}
		} catch (e) {
			console.error("Error rendering chart:", e);
			chartContainer.innerHTML = '<div class="no-chart-data">Error rendering chart</div>';
		}
	}
	===== END COMMENTED OUT LINE CHART ===== */

	add_chartjs_labels(chartInstance, values) {
		// Try to use Chart.js datalabels plugin if available
		if (chartInstance && chartInstance.data && chartInstance.data.datasets) {
			const dataset = chartInstance.data.datasets[0];
			if (dataset && dataset.data) {
				// Chart.js might have datalabels plugin
				if (chartInstance.options && chartInstance.options.plugins) {
					if (!chartInstance.options.plugins.datalabels) {
						chartInstance.options.plugins.datalabels = {};
					}
					chartInstance.options.plugins.datalabels.display = (context) => {
						const value = context.parsed
							? context.parsed.y
							: context.dataset.data[context.dataIndex];
						return value !== 0 && value !== null && !isNaN(value);
					};
					chartInstance.options.plugins.datalabels.formatter = (value) => {
						const numValue =
							typeof value === "object" && value.y !== undefined ? value.y : value;
						return numValue !== 0 ? this.format_number(numValue, 2) + "%" : "";
					};
					chartInstance.options.plugins.datalabels.color = "#e24c4c";
					chartInstance.options.plugins.datalabels.font = {
						size: 11,
						weight: "500",
					};
					chartInstance.options.plugins.datalabels.anchor = "end";
					chartInstance.options.plugins.datalabels.align = "top";
					chartInstance.options.plugins.datalabels.offset = 5;
					chartInstance.update();
					return true;
				}

				// Alternative: Try dataset-level datalabels config
				if (dataset.datalabels || chartInstance.options.plugins) {
					const datalabelsConfig = {
						display: (context) => {
							const value = context.parsed
								? context.parsed.y
								: context.dataset.data[context.dataIndex];
							return value !== 0 && value !== null && !isNaN(value);
						},
						formatter: (value) => {
							const numValue =
								typeof value === "object" && value.y !== undefined
									? value.y
									: value;
							return numValue !== 0 ? this.format_number(numValue, 2) + "%" : "";
						},
						color: "#e24c4c",
						font: {
							size: 11,
							weight: "500",
						},
						anchor: "end",
						align: "top",
						offset: 5,
					};

					if (dataset.datalabels !== undefined) {
						Object.assign(dataset.datalabels, datalabelsConfig);
					} else {
						dataset.datalabels = datalabelsConfig;
					}

					chartInstance.update();
					return true;
				}
			}

			// Try to get pixel positions from Chart.js metadata
			if (chartInstance.getDatasetMeta && chartInstance.scales && this.chart_container) {
				try {
					const meta = chartInstance.getDatasetMeta(0);
					if (meta && meta.data && meta.data.length === values.length) {
						const points = meta.data
							.map((point, index) => {
								return {
									x: point.x,
									y: point.y,
									value: parseFloat(values[index]),
								};
							})
							.filter((p) => p.value !== 0);

						if (points.length > 0) {
							const svg = this.chart_container.querySelector("svg");
							if (svg) {
								points.forEach((point) => {
									const label = document.createElementNS(
										"http://www.w3.org/2000/svg",
										"text"
									);
									label.setAttribute("class", "custom-data-label");
									label.setAttribute("x", point.x);
									label.setAttribute("y", point.y - 8); // 8px above the point
									label.setAttribute("text-anchor", "middle");
									label.setAttribute("font-size", "10");
									label.setAttribute(
										"font-family",
										"Calibri, Arial, sans-serif"
									);
									label.setAttribute("fill", "#c0392b"); // Dark red to match line
									label.setAttribute("pointer-events", "none");
									label.textContent = this.format_number(point.value, 2) + "%";
									svg.appendChild(label);
								});
								return true;
							}
						}
					}
				} catch (e) {
					// Silently fail if metadata access doesn't work
				}
			}
		}
		return false;
	}

	add_data_point_labels(container, values) {
		// Remove any existing custom labels
		container.querySelectorAll(".custom-data-label").forEach((el) => el.remove());

		// Find SVG element
		const svg = container.querySelector("svg");
		if (!svg) {
			return false;
		}

		let points = [];

		// Method 1: Find circles (data points in Frappe Charts)
		const allCircles = Array.from(svg.querySelectorAll("circle"));
		const dataPointCircles = allCircles.filter((circle) => {
			const r = parseFloat(circle.getAttribute("r")) || 0;
			const cx = parseFloat(circle.getAttribute("cx")) || 0;
			const cy = parseFloat(circle.getAttribute("cy")) || 0;
			return r > 0 && r <= 10 && cx > 0 && cy > 0;
		});

		if (dataPointCircles.length > 0) {
			const sortedCircles = dataPointCircles.sort((a, b) => {
				const ax = parseFloat(a.getAttribute("cx")) || 0;
				const bx = parseFloat(b.getAttribute("cx")) || 0;
				return ax - bx;
			});

			const circlesToUse = sortedCircles.slice(0, values.length);
			points = circlesToUse.map((circle) => ({
				x: parseFloat(circle.getAttribute("cx")) || 0,
				y: parseFloat(circle.getAttribute("cy")) || 0,
			}));
		}

		// Method 2: Parse the line path to get exact coordinates
		if (points.length === 0) {
			const paths = svg.querySelectorAll("path");

			for (const path of paths) {
				const d = path.getAttribute("d") || "";

				// Skip paths that are likely fill areas (region fill) - they have complex paths
				// Line paths typically have simple M...L... structure
				if (!d.includes("M") || !d.includes("L")) continue;

				// Try multiple regex patterns to match different path formats
				const coords = [];

				// Pattern 1: M x,y L x,y (comma separated)
				// Pattern 2: M x y L x y (space separated)
				// Pattern 3: M x,y L x,y with decimals
				const patterns = [
					/([ML])\s*([\d.]+)\s*,\s*([\d.]+)/g, // M x,y or L x,y
					/([ML])\s*([\d.]+)\s+([\d.]+)/g, // M x y or L x y
				];

				for (const regex of patterns) {
					let match;
					regex.lastIndex = 0; // Reset regex

					while ((match = regex.exec(d)) !== null) {
						const x = parseFloat(match[2]);
						const y = parseFloat(match[3]);
						if (!isNaN(x) && !isNaN(y) && x > 0 && y > 0) {
							// Avoid duplicates
							const isDup = coords.some(
								(c) => Math.abs(c.x - x) < 1 && Math.abs(c.y - y) < 1
							);
							if (!isDup) {
								coords.push({ x, y });
							}
						}
					}

					if (coords.length > 0) break;
				}

				// Check if we found enough coordinates
				const nonZeroValues = values.filter((v) => parseFloat(v) !== 0).length;
				if (coords.length >= nonZeroValues) {
					points = coords.slice(0, values.length);
					break;
				}
			}
		}

		// Method 3: Look for polyline elements
		if (points.length === 0) {
			const polylines = svg.querySelectorAll("polyline");
			for (const polyline of polylines) {
				const pointsAttr = polyline.getAttribute("points");
				if (pointsAttr) {
					const coords = [];
					const pairs = pointsAttr.trim().split(/\s+/);
					for (const pair of pairs) {
						const [x, y] = pair.split(",").map(parseFloat);
						if (!isNaN(x) && !isNaN(y)) {
							coords.push({ x, y });
						}
					}
					if (coords.length >= values.length) {
						points = coords.slice(0, values.length);
						break;
					}
				}
			}
		}

		if (
			points.length === 0 ||
			points.length < values.filter((v) => parseFloat(v) !== 0).length
		) {
			return false;
		}

		// Add labels at each point position
		let labelsAdded = 0;

		points.forEach((point, index) => {
			if (index < values.length) {
				const value = parseFloat(values[index]);

				// Only show label if value is not 0
				if (!isNaN(value) && value !== 0) {
					const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
					label.setAttribute("class", "custom-data-label");

					// Position label just above the data point
					label.setAttribute("x", point.x);
					label.setAttribute("y", point.y - 8); // 8px above the point
					label.setAttribute("text-anchor", "middle");
					label.setAttribute("font-size", "10");
					label.setAttribute("font-family", "Calibri, Arial, sans-serif");
					label.setAttribute("fill", "#c0392b");
					label.setAttribute("pointer-events", "none");

					label.textContent = this.format_number(value, 2) + "%";

					svg.appendChild(label);
					labelsAdded++;
				}
			}
		});

		return labelsAdded > 0;
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

	// ===== Export Functionality =====

	get_date_string() {
		const today = new Date();
		return today.toISOString().split("T")[0];
	}

	show_table_export_menu(button) {
		const self = this;

		// Remove any existing dropdown
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
				self.export_table_excel();
			} else if (format === "pdf") {
				self.export_table_pdf();
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
		const btn = this.wrapper.find("#export-rejection-chart-btn");

		if (!this.chart) {
			frappe.msgprint(__("No chart data available to export"));
			return;
		}

		// Add loading state
		btn.addClass("exporting");
		btn.prop("disabled", true);

		// Always use canvas conversion to ensure PNG format
		this.export_chart_canvas_fallback(btn);
	}

	export_chart_canvas_fallback(btn) {
		const chartContainer = document.getElementById("rejection-chart");

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
							link.download = `Rejection_Dashboard_Chart_${this.get_date_string()}.png`;
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

	export_table_excel() {
		const self = this;
		const btn = this.wrapper.find("#export-rejection-table-btn");

		// Add loading state
		btn.addClass("exporting");
		btn.prop("disabled", true);

		try {
			const tableData = this.get_table_data();

			if (!tableData || tableData.rows.length === 0) {
				frappe.msgprint(__("No data available to export"));
				btn.removeClass("exporting");
				btn.prop("disabled", false);
				return;
			}

			// Use CSV download (Excel compatible format)
			this.download_as_csv(tableData, `Rejection_Details_${this.get_date_string()}.csv`);

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

	get_table_data() {
		const table = document.querySelector(".rejection-table");
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

	export_table_pdf() {
		const self = this;
		const btn = this.wrapper.find("#export-rejection-table-btn");

		// Add loading state
		btn.addClass("exporting");
		btn.prop("disabled", true);

		try {
			const tableData = this.get_table_data();

			if (!tableData || tableData.rows.length === 0) {
				frappe.msgprint(__("No data available to export"));
				btn.removeClass("exporting");
				btn.prop("disabled", false);
				return;
			}

			// Load jsPDF and generate PDF directly
			this.load_jspdf_and_export(tableData, btn);
		} catch (e) {
			console.error("PDF export error:", e);
			frappe.msgprint(__("Failed to export PDF. Please try again."));
			btn.removeClass("exporting");
			btn.prop("disabled", false);
		}
	}

	load_jspdf_and_export(tableData, btn) {
		const self = this;

		// Check if jsPDF is already loaded
		if (typeof window.jspdf !== "undefined" && window.jspdf.jsPDF) {
			this.generate_pdf_with_jspdf(tableData, btn);
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
				self.generate_pdf_with_jspdf(tableData, btn);
			};
			autoTableScript.onerror = () => {
				// If autoTable fails, generate PDF without it
				self.generate_pdf_with_jspdf(tableData, btn);
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

	generate_pdf_with_jspdf(tableData, btn) {
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
			doc.text("Rejection Dashboard", 148, 15, { align: "center" });

			doc.setFontSize(10);
			doc.setFont(undefined, "normal");
			doc.text("Rejection Details Report", 148, 22, { align: "center" });

			// Add filter information
			let yPos = 30;
			doc.setFontSize(9);
			let filterText = `Period: ${filters.period || "N/A"} | Shift: ${
				filters.shift || "All"
			}`;
			if (filters.date_from && filters.date_to) {
				filterText += ` | From: ${filters.date_from} | To: ${filters.date_to}`;
			}
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
			const filename = `Rejection_Details_${this.get_date_string()}.pdf`;
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
