# Copyright (c) 2026, beetashoke chakraborty and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, getdate, nowtime

ALLOWED_SHIFTS = frozenset(("Day", "Night"))
SHIFT_RANK = {"Day": 0, "Night": 1}

OPENING_BALANCE_FIELDS = (
	"print_available_in_plant",
	"die_available_in_plant",
	"trim_available_in_plant",
	"staple_available_in_plant",
	"tape_available_in_plant",
)

CARRY_FORWARD_SOURCE_FIELDS = (
	*OPENING_BALANCE_FIELDS,
	"sheet_received",
	"front_printed",
	"back_printed",
	"received_from_printing_dept",
	"die_checked",
	"received_from_die_punching_dept",
	"trim_checked",
	"received_from_trimming_dept",
	"staple_checked",
	"staple_rejected",
	"received_from_stapling_dept",
	"tape_checked",
	"tape_rejected",
)

USER_COUNT_FIELDS = (
	*OPENING_BALANCE_FIELDS,
	"sheet_received",
	"front_printed",
	"back_printed",
	"in_area_checked",
	"rejected_for_dry_problem",
	"rejected_for_printing",
	"rejected_for_broken",
	"die_checked",
	"die_rejected",
	"trim_checked",
	"staple_checked",
	"staple_rejected",
	"tape_checked",
	"tape_rejected",
	"sheet_cleaning_qty",
)


def _sort_key(production_date, shift):
	if not production_date or shift not in SHIFT_RANK:
		return None
	return (getdate(production_date), SHIFT_RANK[shift])


def get_previous_shift(production_date, shift, exclude_name=None):
	current_key = _sort_key(production_date, shift)
	if not current_key:
		return None

	params = {
		"production_date": getdate(production_date),
		"shift_type": shift,
	}
	exclude_clause = ""
	if exclude_name:
		params["exclude_name"] = exclude_name
		exclude_clause = " AND name != %(exclude_name)s"

	rows = frappe.db.sql(
		f"""
		SELECT
			name, production_date, shift_type, {", ".join(CARRY_FORWARD_SOURCE_FIELDS)}
		FROM `tabBox Production`
		WHERE docstatus = 1
			AND (
				production_date < %(production_date)s
				OR (
					production_date = %(production_date)s
					AND CASE shift_type WHEN 'Day' THEN 0 WHEN 'Night' THEN 1 ELSE 999 END
						< CASE %(shift_type)s WHEN 'Day' THEN 0 WHEN 'Night' THEN 1 ELSE 999 END
				)
			)
			{exclude_clause}
		ORDER BY
			production_date DESC,
			CASE shift_type WHEN 'Day' THEN 0 WHEN 'Night' THEN 1 ELSE 999 END DESC
		LIMIT 1
		""",
		params,
		as_dict=True,
	)
	return rows[0] if rows else None


def apply_opening_balances(doc) -> None:
	prior = get_previous_shift(doc.production_date, doc.shift_type, exclude_name=getattr(doc, "name", None))
	if not prior:
		return
	for fieldname, value in _compute_next_opening_from_doc(prior).items():
		setattr(doc, fieldname, value)


@frappe.whitelist()
def get_plant_balance_carry_forward(production_date, shift_type):
	_ensure_production_day_and_shift(production_date, shift_type)
	prior = get_previous_shift(production_date, shift_type)
	if not prior:
		return {fieldname: 0 for fieldname in OPENING_BALANCE_FIELDS}
	return _compute_next_opening_from_doc(prior)


def _ensure_production_day_and_shift(production_date, shift_type):
	if not production_date:
		frappe.throw(_("Production date is required."), title=_("Missing date"))
	if shift_type not in ALLOWED_SHIFTS:
		frappe.throw(_("Shift must be Day or Night."), title=_("Invalid shift"))
	getdate(production_date)


def _normalize_user_counts(doc):
	for fieldname in USER_COUNT_FIELDS:
		value = cint(doc.get(fieldname))
		if value < 0:
			frappe.throw(
				_("{0} cannot be negative.").format(doc.meta.get_label(fieldname)),
				title=_("Invalid quantity"),
			)
		setattr(doc, fieldname, value)


def _validate_printing_limits(doc):
	front_printed = cint(doc.front_printed)
	back_printed = cint(doc.back_printed)
	sheet_received = cint(doc.sheet_received)
	print_available = cint(doc.print_available_in_plant)
	total_printed = front_printed + back_printed
	max_printable = sheet_received + print_available

	if total_printed > max_printable:
		frappe.throw(
			_(
				"Front Printed + Back Printed ({0}) cannot be greater than "
				"Sheet Received + Available in Plant ({1})."
			).format(total_printed, max_printable),
			title=_("Invalid printing quantity"),
		)

	in_area_reject = cint(doc.in_area_checked)
	out_area_reject = (
		cint(doc.rejected_for_dry_problem) + cint(doc.rejected_for_printing) + cint(doc.rejected_for_broken)
	)

	if in_area_reject > total_printed:
		frappe.throw(
			_("Rejected by In-Area ({0}) cannot be greater than printed total ({1}).").format(
				in_area_reject, total_printed
			),
			title=_("Invalid rejection quantity"),
		)

	if out_area_reject > total_printed:
		frappe.throw(
			_("Out-Area rejection total ({0}) cannot be greater than printed total ({1}).").format(
				out_area_reject, total_printed
			),
			title=_("Invalid rejection quantity"),
		)


def _validate_department_dependencies(doc):
	def _validate_stage(stage_label, available, incoming, completed, rejected=0):
		available = cint(available)
		incoming = cint(incoming)
		completed = cint(completed)
		rejected = cint(rejected)
		input_qty = available + incoming

		if completed > input_qty:
			frappe.throw(
				_("{0}: Work Completed ({1}) cannot be greater than input quantity ({2}).").format(
					stage_label, completed, input_qty
				),
				title=_("Invalid stage quantity"),
			)

		if rejected > completed:
			frappe.throw(
				_("{0}: Rejected ({1}) cannot be greater than Work Completed ({2}).").format(
					stage_label, rejected, completed
				),
				title=_("Invalid rejection quantity"),
			)

		if input_qty == 0 and (completed > 0 or rejected > 0):
			frappe.throw(
				_("{0}: No input available, so Work Completed and Rejected must be zero.").format(
					stage_label
				),
				title=_("Invalid stage quantity"),
			)

	_validate_stage(
		_("Die Punching Dept"),
		doc.die_available_in_plant,
		doc.received_from_printing_dept,
		doc.die_checked,
		doc.die_rejected,
	)
	_validate_stage(
		_("Trimming Dept"),
		doc.trim_available_in_plant,
		doc.received_from_die_punching_dept,
		doc.trim_checked,
	)
	_validate_stage(
		_("Stapling Dept"),
		doc.staple_available_in_plant,
		doc.received_from_trimming_dept,
		doc.staple_checked,
		doc.staple_rejected,
	)
	_validate_stage(
		_("Taping Dept"),
		doc.tape_available_in_plant,
		doc.received_from_stapling_dept,
		doc.tape_checked,
		doc.tape_rejected,
	)


def _finished_goods_rows(doc):
	return [row for row in (doc.table_aqtt or []) if row]


def _validate_finished_goods_table(doc):
	rows = _finished_goods_rows(doc)
	if not rows:
		frappe.throw(
			_("Add at least one row in Finished Goods with quantities."),
			title=_("Finished Goods required"),
		)

	tape_checked = cint(doc.tape_checked)
	tape_rejected = cint(doc.tape_rejected)
	tape_net_good = tape_checked - tape_rejected
	if tape_net_good < 0:
		frappe.throw(
			_("Taping rejected ({0}) cannot be greater than taping checked ({1}).").format(
				tape_rejected, tape_checked
			),
			title=_("Invalid taping quantities"),
		)

	if tape_net_good <= 0:
		frappe.throw(
			_("Net good tape (checked - rejected) must be greater than zero."),
			title=_("No finished goods quantity available"),
		)

	total_fg = 0
	finished_items = set()
	for row in rows:
		qty = cint(row.finished_qty)
		if qty <= 0:
			frappe.throw(
				_("Finished Qty must be greater than zero for each finished goods row."),
				title=_("Invalid finished quantity"),
			)
		if not row.finished_item:
			frappe.throw(_("Finished Item is required on each row."), title=_("Missing finished item"))
		if not row.fg_target_warehouse:
			frappe.throw(
				_("FG Target Warehouse is required on each row."),
				title=_("Missing warehouse"),
			)
		finished_items.add(row.finished_item)
		total_fg += qty

	# User must distribute the full good-tape quantity across finished items.
	if total_fg > tape_net_good:
		frappe.throw(
			_(
				"Total Finished Qty ({0}) cannot be greater than Net Good Tape (checked - rejected) ({1})."
			).format(total_fg, tape_net_good),
			title=_("Finished quantity exceeds net good tape"),
		)

	if total_fg != tape_net_good:
		frappe.throw(
			_("Total Finished Qty ({0}) must exactly equal Net Good Tape (checked - rejected) ({1}).").format(
				total_fg, tape_net_good
			),
			title=_("Finished quantity mismatch"),
		)

	# ERPNext 'Manufacture' supports multiple finished-goods rows as long
	# as they're the same finished item code.
	if len(finished_items) > 1:
		frappe.throw(
			_(
				"Finished Goods must use a single Finished Item code for Manufacture (multiple finished items cannot be marked as finished)."
			),
			title=_("Invalid finished goods"),
		)


def _validate_submit_required_fields(doc):
	required_fields = (
		"production_date",
		"shift_type",
		"machine_name",
		"sheet_received",
		"front_printed",
		"back_printed",
		"in_area_checked",
		"raw_material",
		"rm_source_warehouse",
		"cleaning_item",
		"sheet_cleaning_qty",
		"target_warehouse",
	)
	for fieldname in required_fields:
		value = doc.get(fieldname)
		if value in (None, "") or (value == 0 and fieldname != "sheet_cleaning_qty"):
			label = doc.meta.get_label(fieldname)
			if not label or str(label).strip().lower() == "no label":
				label = fieldname.replace("_", " ").title()
			frappe.throw(
				_("{0} is mandatory before submit.").format(label),
				title=_("Missing mandatory field"),
			)
	_validate_finished_goods_table(doc)


def apply_derived_quantities(doc) -> None:
	reject_in_area = cint(doc.in_area_checked)
	rejected_for_dry = cint(doc.rejected_for_dry_problem)
	rejected_for_printing = cint(doc.rejected_for_printing)
	rejected_for_broken = cint(doc.rejected_for_broken)

	# Printing dept "Transfer to Clean Sheet" excludes "Rejected for Broken".
	transfer_to_clean_sheet = reject_in_area + rejected_for_dry + rejected_for_printing
	doc.transfer_to_clean_sheet = transfer_to_clean_sheet
	doc.sheet_cleaning_qty = transfer_to_clean_sheet

	front = cint(doc.front_printed)
	back = cint(doc.back_printed)
	# All rejects that leave printing must reduce sheets forwarded to die punching.
	printing_outbound_rejects = transfer_to_clean_sheet + rejected_for_broken
	doc.received_from_printing_dept = max(0, front + back - printing_outbound_rejects)

	die_ok = cint(doc.die_checked)
	die_fail = cint(doc.die_rejected)
	doc.received_from_die_punching_dept = max(0, die_ok - die_fail)

	doc.received_from_trimming_dept = cint(doc.trim_checked)

	staple_ok = cint(doc.staple_checked)
	staple_fail = cint(doc.staple_rejected)
	net_staple_ok = max(0, staple_ok - staple_fail)
	doc.box_produced = net_staple_ok // 2
	doc.received_from_stapling_dept = max(0, doc.box_produced)


def _get_company_from_warehouses(*warehouses):
	companies = {
		frappe.db.get_value("Warehouse", warehouse, "company") for warehouse in warehouses if warehouse
	}
	companies.discard(None)

	if len(companies) > 1:
		frappe.throw(
			_("Selected warehouses belong to different companies."),
			title=_("Invalid warehouses"),
		)

	if companies:
		return companies.pop()

	default_company = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value(
		"Global Defaults", "default_company"
	)
	if not default_company:
		frappe.throw(_("Unable to determine company for Stock Entry."), title=_("Missing company"))
	return default_company


def apply_closing_balances(doc) -> None:
	opening_print = cint(doc.print_available_in_plant)
	opening_die = cint(doc.die_available_in_plant)
	opening_trim = cint(doc.trim_available_in_plant)
	opening_staple = cint(doc.staple_available_in_plant)
	opening_tape = cint(doc.tape_available_in_plant)

	sheet_received = cint(doc.sheet_received)
	front_printed = cint(doc.front_printed)
	back_printed = cint(doc.back_printed)
	recv_printing = cint(doc.received_from_printing_dept)
	die_checked = cint(doc.die_checked)
	recv_die = cint(doc.received_from_die_punching_dept)
	trim_checked = cint(doc.trim_checked)
	recv_trim = cint(doc.received_from_trimming_dept)
	staple_checked = cint(doc.staple_checked)
	staple_rejected = cint(doc.staple_rejected)
	recv_staple = max(0, staple_checked - staple_rejected) // 2
	tape_checked = cint(doc.tape_checked)

	# One odd usable sheet can remain in stapling since 2 sheets make 1 box.
	staple_odd_remainder = max(0, staple_checked - staple_rejected) % 2

	doc.print_available_in_plant = max(0, opening_print + sheet_received - front_printed - back_printed)
	doc.die_available_in_plant = max(0, opening_die + recv_printing - die_checked)
	doc.trim_available_in_plant = max(0, opening_trim + recv_die - trim_checked)
	doc.staple_available_in_plant = max(0, opening_staple + recv_trim - staple_checked + staple_odd_remainder)
	doc.tape_available_in_plant = max(0, opening_tape + recv_staple - tape_checked)


def _compute_next_opening_from_doc(doc) -> dict:
	opening_print = cint(doc.get("print_available_in_plant"))
	opening_die = cint(doc.get("die_available_in_plant"))
	opening_trim = cint(doc.get("trim_available_in_plant"))
	opening_staple = cint(doc.get("staple_available_in_plant"))
	opening_tape = cint(doc.get("tape_available_in_plant"))

	sheet_received = cint(doc.get("sheet_received"))
	front_printed = cint(doc.get("front_printed"))
	back_printed = cint(doc.get("back_printed"))
	recv_printing = cint(doc.get("received_from_printing_dept"))
	die_checked = cint(doc.get("die_checked"))
	recv_die = cint(doc.get("received_from_die_punching_dept"))
	trim_checked = cint(doc.get("trim_checked"))
	recv_trim = cint(doc.get("received_from_trimming_dept"))
	staple_checked = cint(doc.get("staple_checked"))
	staple_rejected = cint(doc.get("staple_rejected"))
	recv_staple = max(0, staple_checked - staple_rejected) // 2
	tape_checked = cint(doc.get("tape_checked"))

	staple_odd_remainder = max(0, staple_checked - staple_rejected) % 2

	return {
		"print_available_in_plant": max(0, opening_print + sheet_received - front_printed - back_printed),
		"die_available_in_plant": max(0, opening_die + recv_printing - die_checked),
		"trim_available_in_plant": max(0, opening_trim + recv_die - trim_checked),
		"staple_available_in_plant": max(
			0, opening_staple + recv_trim - staple_checked + staple_odd_remainder
		),
		"tape_available_in_plant": max(0, opening_tape + recv_staple - tape_checked),
	}


class BoxProduction(Document):
	def validate(self):
		_ensure_production_day_and_shift(self.production_date, self.shift_type)
		self._reject_duplicate_shift()
		if self.is_new() and not self.amended_from:
			apply_opening_balances(self)
		_normalize_user_counts(self)
		apply_derived_quantities(self)

	def before_submit(self):
		_validate_submit_required_fields(self)
		_validate_printing_limits(self)
		_validate_department_dependencies(self)

	def _reject_duplicate_shift(self):
		filters = {
			"production_date": self.production_date,
			"shift_type": self.shift_type,
			"docstatus": ["!=", 2],
		}
		if self.name:
			filters["name"] = ["!=", self.name]
		match = frappe.db.exists("Box Production", filters)
		if match:
			frappe.throw(
				_("This shift and date already have a Box Production ({0}).").format(match),
				title=_("Duplicate"),
			)

	def on_submit(self):
		self._create_submit_stock_entries()

	def _create_submit_stock_entries(self):
		if self.box_stock_entry_id and self.stock_entry_id:
			return

		raw_qty = cint(self.sheet_received)
		rows = _finished_goods_rows(self)
		fg_qty = sum(cint(r.finished_qty) for r in rows)
		cleaning_qty = cint(self.sheet_cleaning_qty)

		if raw_qty <= 0:
			frappe.throw(_("Sheet Received must be greater than zero for Stock Entry."))
		if fg_qty <= 0:
			frappe.throw(_("Total Finished Qty must be greater than zero for Stock Entry."))
		if cleaning_qty < 0:
			frappe.throw(_("Sheet Cleaning Qty cannot be negative for Stock Entry."))

		fg_warehouses = [r.fg_target_warehouse for r in rows]
		company = _get_company_from_warehouses(
			self.rm_source_warehouse,
			self.target_warehouse,
			*fg_warehouses,
		)

		if not self.box_stock_entry_id:
			items = [
				{
					"item_code": self.raw_material,
					"qty": raw_qty,
					"s_warehouse": self.rm_source_warehouse,
				}
			]
			for row in rows:
				items.append(
					{
						"item_code": row.finished_item,
						"qty": cint(row.finished_qty),
						"t_warehouse": row.fg_target_warehouse,
						"is_finished_item": 1,
					}
				)

			manufacture = frappe.get_doc(
				{
					"doctype": "Stock Entry",
					"stock_entry_type": "Manufacture",
					# Prevent ERPNext from overriding posting_date with "today"
					# (see TransactionBase.validate_posting_time).
					"set_posting_time": 1,
					"posting_date": self.production_date,
					"posting_time": nowtime(),
					"company": company,
					"remarks": _("Auto-created from Box Production {0}").format(self.name),
					"items": items,
				}
			)
			manufacture.insert()
			manufacture.submit()
			self.db_set("box_stock_entry_id", manufacture.name, update_modified=False)

		if cleaning_qty > 0 and not self.stock_entry_id:
			cleaning_receipt = frappe.get_doc(
				{
					"doctype": "Stock Entry",
					"stock_entry_type": "Material Receipt",
					"set_posting_time": 1,
					"posting_date": self.production_date,
					"posting_time": nowtime(),
					"company": company,
					"remarks": _("Created from Box Production {0}").format(self.name),
					"items": [
						{
							"item_code": self.cleaning_item,
							"qty": cleaning_qty,
							"t_warehouse": self.target_warehouse,
						}
					],
				}
			)
			cleaning_receipt.insert()
			cleaning_receipt.submit()
			self.db_set("stock_entry_id", cleaning_receipt.name, update_modified=False)
