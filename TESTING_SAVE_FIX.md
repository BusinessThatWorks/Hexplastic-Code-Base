# Testing Production Log Book Save Fix

## Issue Fixed
The form was becoming "Not Saved" immediately after clicking Save due to auto-calculations running during the save/refresh cycle.

## Changes Made

### 1. Added Save State Tracking
- `before_save`: Sets `frm._is_saving = true`
- `after_save`: Sets `frm._just_saved = true` for 1 second, then clears it

### 2. Updated All Calculation Functions
All calculation functions now check these flags and skip execution:
- `calculate_hopper_closing_qty()`
- `calculate_mip_closing_qty()`
- `calculate_net_weight()`
- `calculate_closing_stock_for_row()`
- `calculate_PRIME_item_closing_stock()`
- `recalculate_closing_stock_for_raw_materials()`
- `recalculate_PRIME_items_closing_stock()`
- `assign_warehouses_for_all_rows()`

### 3. Added Guards to Field Handlers
All field change handlers now have `if (frm.doc.docstatus !== 0) return;` guard:
- `opening_qty_in_hopper_and_tray`
- `add_or_used`
- `net_weight`
- `mip_used`
- `mip_generate`
- `process_loss_weight`
- `opening_qty_mip`
- `gross_weight`
- `weight_of_fabric_packing`
- `opp_in_plant` (child table)
- `issued` (child table)
- `consumption` (child table)

### 4. Modified Refresh Handler
- Only runs calculations for NEW documents (`frm.is_new()`)
- Skips all calculations if `frm._just_saved` is true
- Always skips for submitted/cancelled documents

### 5. Changed Value Setting Method
For read-only calculated fields, changed from:
```js
frm.set_value("closing_qty", value); // This marks form as dirty
```

To:
```js
frm.doc.closing_qty = value; // Direct assignment doesn't mark as dirty
frm.refresh_field("closing_qty");
```

## How to Test

### Test Case 1: New Document Save
1. Open Production Log Book list
2. Click "New"
3. Fill required fields (BOM, dates, shift, etc.)
4. Click **Save**
5. ✅ Status should show "Saved" (not "Not Saved")
6. No second save required

### Test Case 2: Edit Existing Document
1. Open an existing draft Production Log Book
2. Make ANY change (edit a field, change qty_to_manufacture, etc.)
3. Click **Save**
4. ✅ Status should show "Saved" (not "Not Saved")
5. No second save required

### Test Case 3: Child Table Edit
1. Open an existing draft Production Log Book with material_consumption rows
2. Edit any child table field (consumption, issued, opp_in_plant, etc.)
3. Click **Save**
4. ✅ Status should show "Saved" (not "Not Saved")
5. No second save required

### Test Case 4: Calculated Fields Still Work
1. Open Production Log Book
2. Change `gross_weight` → `net_weight` should auto-calculate
3. Change `qty_to_manufacture` → `issued` should auto-calculate in child table
4. Change `manufactured_qty` → `consumption` should auto-calculate
5. ✅ All calculations still work during data entry
6. Click **Save** → Status should remain "Saved"

### Test Case 5: Submit Works Normally
1. Open a saved Production Log Book
2. Click **Submit**
3. ✅ Document should submit successfully
4. ✅ Stock Entry should be created
5. ✅ Status should show "Submitted"

## Expected Behavior

### ✅ CORRECT:
- User edits → Save → "Saved" status
- Calculations run during data entry
- Submit works normally
- No second save needed

### ❌ INCORRECT (Old Behavior):
- User edits → Save → "Not Saved" status
- User forced to click Save again
- Form becomes dirty after save

## Debugging

If issue persists, open browser console (F12) and check for:
1. Any errors during save
2. Look for `_just_saved` flag: `cur_frm._just_saved`
3. Look for `_is_saving` flag: `cur_frm._is_saving`
4. Check if calculations are being called: search console for "calculate" or "recalculate"

## Quick Console Test

Run this in browser console after saving:
```js
// Check flags
console.log("_just_saved:", cur_frm._just_saved);
console.log("_is_saving:", cur_frm._is_saving);
console.log("is_dirty:", cur_frm.is_dirty());
console.log("docstatus:", cur_frm.doc.docstatus);
```

If `is_dirty()` returns `true` after save, the issue persists.

## Rollback Instructions

If this fix causes issues, you can:
1. Restore from git: `git checkout HEAD -- hexplastics/hexplastics/doctype/production_log_book/production_log_book.js`
2. Reload the page in browser
3. Clear browser cache (Ctrl+F5)



