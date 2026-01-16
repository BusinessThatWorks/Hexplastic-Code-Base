frappe.pages["customer-dashboard"].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Customer Dashboard",
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

	// Initialize dashboard
	new CustomerDashboard(page);
};

class CustomerDashboard {
	constructor(page) {
		this.page = page;
		this.wrapper = $(page.body);
		this.states = [];
		this.customers = [];
		this.items = [];
		this.fiscal_years = [];
		this.debounce_timer = null;
		this.current_data = null;

		this.init();
	}

	init() {
		// Add body class to ensure CSS only applies on this page
		document.body.classList.add("customer-dashboard-page");
		this.load_html();
		this.setup_styles();
		this.bind_events();
		this.load_filter_options();
		// Load data after filters are set up
		setTimeout(() => {
			this.refresh_data();
		}, 300);
	}

	load_html() {
		frappe.require("/assets/hexplastics/css/customer_dashboard.css", () => {
			this.wrapper.html(frappe.render_template("customer_dashboard"));
		});
	}

	setup_styles() {
		const style = document.createElement("style");
		style.id = "customer-dashboard-styles";
		style.textContent = `
			.customer-dashboard .frappe-control {
				margin: 0 !important;
			}
			.customer-dashboard {
				width: 100% !important;
				max-width: 100% !important;
			}
		`;

		if (!document.getElementById("customer-dashboard-styles")) {
			document.head.appendChild(style);
		}
	}

	bind_events() {
		const self = this;

		setTimeout(() => {
			// Auto-refresh on filter changes
			this.wrapper.on("change", "#state-filter, #mode-filter, #year-filter", function () {
				self.refresh_data();
			});

			// Debounced refresh for text inputs
			this.wrapper.on("change", "#customer-filter, #item-filter", function () {
				if (self.debounce_timer) {
					clearTimeout(self.debounce_timer);
					self.debounce_timer = null;
				}
				self.refresh_data();
			});

			this.wrapper.on("input", "#customer-filter, #item-filter", function () {
				if (self.debounce_timer) {
					clearTimeout(self.debounce_timer);
				}
				self.debounce_timer = setTimeout(function () {
					self.refresh_data();
				}, 500);
			});

			// Setup autocomplete after data is loaded
			setTimeout(() => {
				self.setup_customer_autocomplete();
				self.setup_item_autocomplete();
			}, 200);
		}, 200);
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

		// Helper function to show suggestions
		const showSuggestions = function (filteredList = null) {
			const listToShow = filteredList !== null ? filteredList : self.customers;
			if (listToShow.length > 0) {
				dropdown.innerHTML = listToShow
					.slice(0, 10)
					.map((c) => `<div class="autocomplete-item">${c}</div>`)
					.join("");
				dropdown.style.display = "block";
			} else {
				dropdown.style.display = "none";
			}
		};

		// Handle input changes
		input.addEventListener("input", function () {
			const value = this.value.trim().toLowerCase();
			
			// If field is cleared, show all suggestions immediately
			if (value.length === 0) {
				showSuggestions();
				return;
			}

			// Filter suggestions based on input
			const filtered = self.customers.filter((c) => c.toLowerCase().includes(value));
			showSuggestions(filtered);
		});

		// Handle focus - show suggestions if field is empty
		input.addEventListener("focus", function () {
			if (self.customers.length > 0) {
				const value = this.value.trim();
				if (value.length === 0) {
					showSuggestions();
				} else {
					// If there's a value, filter and show matching suggestions
					const filtered = self.customers.filter((c) => 
						c.toLowerCase().includes(value.toLowerCase())
					);
					showSuggestions(filtered);
				}
			}
		});

		// Handle click on input field - show suggestions immediately
		input.addEventListener("click", function () {
			if (self.customers.length > 0) {
				const value = this.value.trim();
				if (value.length === 0) {
					showSuggestions();
				} else {
					// Show filtered suggestions
					const filtered = self.customers.filter((c) => 
						c.toLowerCase().includes(value.toLowerCase())
					);
					showSuggestions(filtered);
				}
			}
		});

		// Handle selection from dropdown
		wrapper.addEventListener("click", function (e) {
			if (e.target.classList.contains("autocomplete-item")) {
				input.value = e.target.textContent;
				dropdown.style.display = "none";
				// Trigger change event to refresh filters
				const changeEvent = new Event("change", { bubbles: true });
				input.dispatchEvent(changeEvent);
			}
		});

		// Close dropdown when clicking outside
		document.addEventListener("click", function (e) {
			if (!wrapper.contains(e.target)) {
				dropdown.style.display = "none";
			}
		});
	}

	setup_item_autocomplete() {
		const self = this;
		const input = document.getElementById("item-filter");

		if (!input) return;

		const wrapper = document.getElementById("item-filter-wrapper");
		if (!wrapper) return;

		// Check if dropdown already exists
		let dropdown = wrapper.querySelector(".autocomplete-dropdown");
		if (!dropdown) {
			dropdown = document.createElement("div");
			dropdown.className = "autocomplete-dropdown";
			dropdown.style.display = "none";
			wrapper.appendChild(dropdown);
		}

		// Helper function to show suggestions
		const showSuggestions = function (filteredList = null) {
			const listToShow = filteredList !== null ? filteredList : self.items;
			if (listToShow.length > 0) {
				dropdown.innerHTML = listToShow
					.slice(0, 10)
					.map((item) => `<div class="autocomplete-item">${item}</div>`)
					.join("");
				dropdown.style.display = "block";
			} else {
				dropdown.style.display = "none";
			}
		};

		// Handle input changes
		input.addEventListener("input", function () {
			const value = this.value.trim().toLowerCase();
			
			// If field is cleared, show all suggestions immediately
			if (value.length === 0) {
				showSuggestions();
				return;
			}

			// Filter suggestions based on input
			const filtered = self.items.filter((item) => item.toLowerCase().includes(value));
			showSuggestions(filtered);
		});

		// Handle focus - show suggestions if field is empty
		input.addEventListener("focus", function () {
			if (self.items.length > 0) {
				const value = this.value.trim();
				if (value.length === 0) {
					showSuggestions();
				} else {
					// If there's a value, filter and show matching suggestions
					const filtered = self.items.filter((item) => 
						item.toLowerCase().includes(value.toLowerCase())
					);
					showSuggestions(filtered);
				}
			}
		});

		// Handle click on input field - show suggestions immediately
		input.addEventListener("click", function () {
			if (self.items.length > 0) {
				const value = this.value.trim();
				if (value.length === 0) {
					showSuggestions();
				} else {
					// Show filtered suggestions
					const filtered = self.items.filter((item) => 
						item.toLowerCase().includes(value.toLowerCase())
					);
					showSuggestions(filtered);
				}
			}
		});

		// Handle selection from dropdown
		wrapper.addEventListener("click", function (e) {
			if (e.target.classList.contains("autocomplete-item")) {
				input.value = e.target.textContent;
				dropdown.style.display = "none";
				// Trigger change event to refresh filters
				const changeEvent = new Event("change", { bubbles: true });
				input.dispatchEvent(changeEvent);
			}
		});

		// Close dropdown when clicking outside
		document.addEventListener("click", function (e) {
			if (!wrapper.contains(e.target)) {
				dropdown.style.display = "none";
			}
		});
	}

	load_filter_options() {
		const self = this;

		frappe.call({
			method: "hexplastics.api.customer_dashboard.get_filter_options",
			async: true,
			callback: function (r) {
				if (r.message) {
					self.states = r.message.states || [];
					self.customers = r.message.customers || [];
					self.items = r.message.items || [];
					self.fiscal_years = r.message.fiscal_years || [];

					// Populate state dropdown
					const stateSelect = document.getElementById("state-filter");
					if (stateSelect) {
						// Keep "All" option
						const allOption = stateSelect.querySelector('option[value=""]');
						stateSelect.innerHTML = "";
						if (allOption) {
							stateSelect.appendChild(allOption);
						}

						// Add state options
						self.states.forEach((state) => {
							const option = document.createElement("option");
							option.value = state;
							option.textContent = state;
							stateSelect.appendChild(option);
						});
					}

					// Populate year dropdown
					const yearSelect = document.getElementById("year-filter");
					if (yearSelect) {
						yearSelect.innerHTML = "";

						// Add fiscal year options
						self.fiscal_years.forEach((fy) => {
							const option = document.createElement("option");
							option.value = fy.name;
							option.textContent = fy.name;
							yearSelect.appendChild(option);
						});

						// Set current fiscal year as default
						const currentFiscalYear = r.message.current_fiscal_year;
						if (currentFiscalYear && yearSelect.querySelector(`option[value="${currentFiscalYear}"]`)) {
							yearSelect.value = currentFiscalYear;
						} else if (self.fiscal_years.length > 0) {
							// Fallback to first fiscal year if current not found
							yearSelect.value = self.fiscal_years[0].name;
						}
						
						// Refresh data after year is set
						setTimeout(() => {
							self.refresh_data();
						}, 100);
					}
				}
			},
		});
	}

	get_filters() {
		const yearSelect = document.getElementById("year-filter");
		const yearValue = yearSelect?.value;
		
		return {
			state: document.getElementById("state-filter")?.value || "",
			customer: document.getElementById("customer-filter")?.value || "",
			item: document.getElementById("item-filter")?.value || "",
			year: yearValue || null,
			mode: document.getElementById("mode-filter")?.value || "Quantity",
		};
	}

	refresh_data() {
		const self = this;
		const filters = this.get_filters();

		this.show_loading();

		frappe.call({
			method: "hexplastics.api.customer_dashboard.get_customer_turnover_data",
			args: filters,
			callback: function (r) {
				if (r.message) {
					self.current_data = r.message;
					self.render_table(r.message);
				}
				self.hide_loading();
			},
			error: function () {
				frappe.msgprint(__("Error loading customer dashboard data"));
				self.hide_loading();
			},
		});
	}

	render_table(data) {
		if (!data) return;

		const thead = document.getElementById("table-head");
		const tbody = document.getElementById("table-body");
		const tfoot = document.getElementById("table-foot");
		const noDataMsg = document.getElementById("no-data-message");
		const table = document.getElementById("pivot-table");
		const tableScrollContainer = document.getElementById("table-scroll-container");

		if (!thead || !tbody || !tfoot) return;

		// Check if we have data
		if (!data.data || data.data.length === 0) {
			tbody.innerHTML = "";
			tfoot.innerHTML = "";
			thead.innerHTML = "";
			if (noDataMsg) noDataMsg.style.display = "flex";
			if (table) table.style.display = "none";
			if (tableScrollContainer) tableScrollContainer.style.display = "none";
			return;
		}

		if (noDataMsg) noDataMsg.style.display = "none";
		if (table) table.style.display = "table";
		if (tableScrollContainer) tableScrollContainer.style.display = "block";

		const mode = this.get_filters().mode;
		const isValueMode = mode === "Value";

		// Build header row
		let headerHtml = "<tr>";
		headerHtml += '<th class="sticky-col">Customer</th>';

		// Add month columns
		data.months.forEach((month) => {
			headerHtml += `<th class="month-col">${month}</th>`;
		});

		// Add Total column
		headerHtml += '<th class="total-col">Total</th>';
		headerHtml += "</tr>";

		thead.innerHTML = headerHtml;

		// Build body rows (without grand total)
		let bodyHtml = "";

		data.data.forEach((row) => {
			bodyHtml += "<tr>";
			bodyHtml += `<td class="sticky-col customer-name">${this.escape_html(row.customer)}</td>`;

			// Add month values
			data.month_keys.forEach((monthKey) => {
				const value = row.months[monthKey] || 0;
				const formattedValue = isValueMode
					? this.format_currency(value)
					: this.format_number(value);
				bodyHtml += `<td class="month-col text-right">${formattedValue}</td>`;
			});

			// Add row total
			const rowTotal = row.total || 0;
			const formattedTotal = isValueMode
				? this.format_currency(rowTotal)
				: this.format_number(rowTotal);
			bodyHtml += `<td class="total-col text-right"><strong>${formattedTotal}</strong></td>`;
			bodyHtml += "</tr>";
		});

		tbody.innerHTML = bodyHtml;

		// Build Grand Total row in tfoot (inside the same table)
		let grandTotalHtml = "<tr>";
		grandTotalHtml += '<td class="sticky-col"><strong>Grand Total</strong></td>';

		// Add grand totals for each month
		data.month_keys.forEach((monthKey) => {
			const value = data.grand_totals[monthKey] || 0;
			const formattedValue = isValueMode
				? this.format_currency(value)
				: this.format_number(value);
			grandTotalHtml += `<td class="month-col text-right"><strong>${formattedValue}</strong></td>`;
		});

		// Add grand total sum
		const grandTotal = data.grand_total || 0;
		const formattedGrandTotal = isValueMode
			? this.format_currency(grandTotal)
			: this.format_number(grandTotal);
		grandTotalHtml += `<td class="total-col text-right"><strong>${formattedGrandTotal}</strong></td>`;
		grandTotalHtml += "</tr>";

		tfoot.innerHTML = grandTotalHtml;
	}


	show_loading() {
		const loading = document.getElementById("table-loading");
		const table = document.getElementById("pivot-table");
		const tableScrollContainer = document.getElementById("table-scroll-container");

		if (loading) loading.style.display = "flex";
		if (table) table.style.display = "none";
		if (tableScrollContainer) tableScrollContainer.style.display = "none";
	}

	hide_loading() {
		const loading = document.getElementById("table-loading");
		const table = document.getElementById("pivot-table");
		const tableScrollContainer = document.getElementById("table-scroll-container");

		if (loading) loading.style.display = "none";
		if (table) table.style.display = "table";
		if (tableScrollContainer) tableScrollContainer.style.display = "block";
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

		const num = parseFloat(value);
		if (isNaN(num)) return "0";

		return num.toLocaleString("en-IN", {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		});
	}

	escape_html(text) {
		const div = document.createElement("div");
		div.textContent = text;
		return div.innerHTML;
	}
}
