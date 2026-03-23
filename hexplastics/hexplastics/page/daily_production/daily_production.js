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

				setTimeout(() => self.refresh_data(), 150);
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
					self.render_production(r.message.production);
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

	set_loading(on) {
		if (on) {
			this.wrapper.find(".daily-production-dashboard").addClass("dp-loading");
		} else {
			this.wrapper.find(".daily-production-dashboard").removeClass("dp-loading");
		}
	}


	/* ── Section 1 — Production Summary ───────────────────────── */
	render_production(d) {
		if (!d) return;

		this.set_el("sheets-produced", this.fmt(d.sheets_produced));
		this.set_el("boxes-produced", this.fmt(d.boxes_produced));
		this.set_el(
			"sheets-produced-change",
			this.change_text(d.sheets_produced, d.sheets_produced_yesterday)
		);
		this.set_el(
			"boxes-produced-change",
			this.change_text(d.boxes_produced, d.boxes_produced_yesterday)
		);

		// Rejection
		this.set_el("sheets-rejected", this.fmt(d.sheets_rejected));
		this.set_el("boxes-rejected", this.fmt(d.boxes_rejected));
		this.set_el(
			"sheets-reject-rate",
			`${this.pct(d.sheets_rejected, d.sheets_produced)}% reject rate`
		);
		this.set_el(
			"boxes-reject-rate",
			`${this.pct(d.boxes_rejected, d.boxes_produced)}% reject rate`
		);

		// Production Plan Overview table
		const planBody = document.getElementById("production-plan-tbody");
		if (planBody) {
			const rows = d.plan_overview || [];
			if (!rows.length) {
				planBody.innerHTML =
					'<tr><td colspan="3" class="text-muted">No data for selected period</td></tr>';
			} else {
				planBody.innerHTML = rows
					.map(
						(row) => `
					<tr>
						<td>${frappe.utils.escape_html(row.item_name || "-")}</td>
						<td>${frappe.utils.escape_html(row.production_plan || "-")}</td>
						<td>${this.fmt(row.manufactured_qty || 0)}</td>
					</tr>`
					)
					.join("");
			}
		}

		// Rejection Overview table
		const rejBody = document.getElementById("rejection-overview-tbody");
		if (rejBody) {
			const rows = d.rejection_overview || [];
			if (!rows.length) {
				rejBody.innerHTML =
					'<tr><td colspan="3" class="text-muted">No data for selected period</td></tr>';
			} else {
				rejBody.innerHTML = rows
					.map(
						(row) => `
					<tr>
						<td>${frappe.utils.escape_html(row.item_name || "-")}</td>
						<td>${this.fmt(row.rejected_qty || 0)}</td>
						<td>${(row.rejection_pct || 0).toFixed(2)}%</td>
					</tr>`
					)
					.join("");
			}
		}
	}

	/* ── Section 2 — Dispatch Summary ─────────────────────────── */
	render_dispatch(d) {
		if (!d) return;

		const total = (d.sheets_dispatched || 0) + (d.exide_dispatched || 0);

		this.set_el("total-dispatched", this.fmt(total));
		this.set_el("dispatch-sheets", this.fmt(d.sheets_dispatched));
		this.set_el("dispatch-exide", this.fmt(d.exide_dispatched));

		// Mini-table in total card
		this.set_el("dispatch-sheets-mini", this.fmt(d.sheets_dispatched));
		this.set_el("dispatch-exide-mini", this.fmt(d.exide_dispatched));
		this.set_el(
			"dispatch-sheets-pct-mini",
			`${this.pct(d.sheets_dispatched, total)}%`
		);
		this.set_el(
			"dispatch-exide-pct-mini",
			`${this.pct(d.exide_dispatched, total)}%`
		);

		// Sub cards
	}

	/* ── Section 3 — MIP ──────────────────────────────────────── */
	render_mip(d) {
		if (!d) return;

		const consumed = d.total_consumed || 0;
		const generated = d.total_generated || 0;
		const net = generated - consumed;

		this.set_el("mip-consumed", this.fmt(consumed));
		this.set_el("mip-generated", this.fmt(generated));

		// Net balance
		const sign = net >= 0 ? "+" : "";
		this.set_el("mip-net-balance", `${sign}${this.fmt(net)}`);

		// Mini-table
		this.set_el("mip-gen-mini", this.fmt(generated));
		this.set_el("mip-con-mini", this.fmt(consumed));
		this.set_el("mip-net-mini", `${sign}${this.fmt(net)}`);

		// Dynamic colour for net balance card
		const netCard = this.wrapper.find("#mip-net-balance").closest(".dp-card");
		if (net >= 0) {
			netCard
				.removeClass("dp-card-red-gradient")
				.addClass("dp-card-green-gradient");
		} else {
			netCard
				.removeClass("dp-card-green-gradient")
				.addClass("dp-card-red-gradient");
		}
	}
}
