frappe.pages["daily-production"].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Executive Daily Production",
		single_column: true,
	});

	// Hide default Frappe page head — scoped to this page only
	$(page.page_container).find(".page-head").hide();
	setTimeout(function () {
		$(page.page_container)
			.find(".page-title, .page-header h1, .page-title-wrapper")
			.hide();
		$(page.page_container).find("h1").not(".dp-section-title h2").hide();
		if (page.page_title) $(page.page_title).hide();
		$(page.page_container).find(".page-header, .page-breadcrumbs").hide();
	}, 100);
	setTimeout(function () {
		$(page.page_container)
			.find(".page-title, .page-header h1, .page-title-wrapper, .page-head")
			.hide();
		$(page.page_container).find("h1").not(".dp-section-title h2").hide();
	}, 500);

	new DailyProductionDashboard(page);
};

class DailyProductionDashboard {
	constructor(page) {
		this.page = page;
		this.wrapper = $(page.body);
		this.init();
	}

	init() {
		this.load_html();
	}

	load_html() {
		const self = this;
		frappe.require(
			"/assets/hexplastics/css/daily_production_dashboard.css",
			() => {
				self.wrapper.html(frappe.render_template("daily_production"));

				// Date inputs are empty by default — dashboard shows all data
				const fromInput = document.getElementById("dp-from-date");
				const toInput = document.getElementById("dp-to-date");

				// Auto-refresh when date range changes
				if (fromInput) {
					fromInput.addEventListener("change", () => self.refresh_data());
				}
				if (toInput) {
					toInput.addEventListener("change", () => self.refresh_data());
				}

				frappe.call({
					method: "hexplastics.api.daily_production_dashboard.get_default_dashboard_date",
					callback: function (r) {
						const defaultDate =
							r?.message?.default_date || frappe.datetime.get_today();
						if (fromInput && !fromInput.value) fromInput.value = defaultDate;
						if (toInput && !toInput.value) toInput.value = defaultDate;
						self.refresh_data();
					},
					error: function () {
						const today = frappe.datetime.get_today();
						if (fromInput && !fromInput.value) fromInput.value = today;
						if (toInput && !toInput.value) toInput.value = today;
						self.refresh_data();
					},
				});
			}
		);
	}

	/* ── Fetch data from backend ──────────────────────────────── */
	refresh_data() {
		const self = this;
		this.set_loading(true);

		const fromInput = document.getElementById("dp-from-date");
		const toInput = document.getElementById("dp-to-date");
		const fromDate = fromInput?.value || "";
		const toDate = toInput?.value || "";

		frappe.call({
			method: "hexplastics.api.daily_production_dashboard.get_daily_production_data",
			args: {
				from_date: fromDate,
				to_date: toDate,
			},
			callback: function (r) {
				if (r.message) {
					self.render_sheet_line(r.message.sheet_line);
					self.render_dispatch(r.message.dispatch);
					self.render_mip(r.message.mip);
				}
				self.set_loading(false);
			},
			error: function () {
				frappe.msgprint(__("Error loading Daily Production data"));
				self.set_loading(false);
			},
		});
	}

	/* ── Helpers ───────────────────────────────────────────────── */
	fmt(v) {
		/* Indian-style number formatting, no decimals */
		const n = parseFloat(v) || 0;
		return n.toLocaleString("en-IN", {
			minimumFractionDigits: 0,
			maximumFractionDigits: 0,
		});
	}

	pct(part, total) {
		if (!total) return "0";
		return ((part / total) * 100).toFixed(1);
	}

	change_text(today, yesterday) {
		if (!yesterday) return "—";
		const diff = ((today - yesterday) / yesterday) * 100;
		const arrow = diff >= 0 ? "▲" : "▼";
		return `${arrow} ${Math.abs(diff).toFixed(1)}% vs yesterday`;
	}

	set_el(id, text) {
		const el = document.getElementById(id);
		if (el) el.textContent = text;
	}

	fmt_date(v) {
		if (!v) return "-";
		const s = String(v);
		// Keep range labels (e.g. "2026-03-01 to 2026-03-31") as-is
		if (s.includes(" to ")) return s;
		return frappe.datetime.str_to_user(s);
	}

	set_loading(on) {
		if (on) {
			this.wrapper.find(".daily-production-dashboard").addClass("dp-loading");
		} else {
			this.wrapper.find(".daily-production-dashboard").removeClass("dp-loading");
		}
	}


	/* ── Section 1 — Sheet Line / EXIDE BOXES tables ──────────── */
	render_sheet_line(rows) {
		const sheetRows = rows || [];
		const sheetBody = document.getElementById("sheet-line-tbody");
		const exideBody = document.getElementById("exide-boxes-tbody");

		if (sheetBody) {
			if (!sheetRows.length) {
				sheetBody.innerHTML =
					'<tr><td colspan="4" class="text-muted">No data for selected period</td></tr>';
			} else {
				sheetBody.innerHTML = sheetRows
					.map(
						(row) => `
					<tr>
						<td>${frappe.utils.escape_html(row.shift || "-")}</td>
						<td>${this.fmt(row.target || 0)}</td>
						<td>${this.fmt(row.produced || 0)}</td>
						<td>${this.fmt(row.rejected || 0)}</td>
					</tr>`
					)
					.join("");
			}
		}

		if (exideBody) {
			if (!sheetRows.length) {
				exideBody.innerHTML =
					'<tr><td colspan="3" class="text-muted">No data for selected period</td></tr>';
			} else {
				exideBody.innerHTML = sheetRows
					.map(
						(row) => `
					<tr>
						<td>${frappe.utils.escape_html(row.shift || "-")}</td>
						<td>0</td>
						<td>0</td>
					</tr>`
					)
					.join("");
			}
		}
	}

	/* ── Section 2 — Dispatch Summary ─────────────────────────── */
	render_dispatch(d) {
		const rows = d?.sheet_line_rows || [];
		const summaryBody = document.getElementById("dispatch-summary-tbody");

		if (!summaryBody) return;
		if (!rows.length) {
			summaryBody.innerHTML =
				'<tr><td>0</td><td>0</td></tr>';
			return;
		}

		summaryBody.innerHTML = rows
			.map(
				(row) => `
			<tr>
				<td>${this.fmt(row.qty || 0)} ${frappe.utils.escape_html(row.uom || "")}</td>
				<td>0</td>
			</tr>`
			)
			.join("");
	}

	/* ── Section 3 — MIP ──────────────────────────────────────── */
	render_mip(d) {
		const body = document.getElementById("mip-summary-tbody");
		if (!body) return;
		const rows = d?.rows || [];
		if (!rows.length) {
			body.innerHTML =
				'<tr><td colspan="4" class="text-muted">No data for selected period</td></tr>';
			return;
		}
		body.innerHTML = rows
			.map(
				(row) => `
			<tr>
				<td>${frappe.utils.escape_html(row.shift || "-")}</td>
				<td>${this.fmt(row.total_issued || 0)}</td>
				<td>${this.fmt(row.total_consumed || 0)}</td>
				<td>${this.fmt(row.net_balance || 0)}</td>
			</tr>
		`
			)
			.join("");
	}
}
