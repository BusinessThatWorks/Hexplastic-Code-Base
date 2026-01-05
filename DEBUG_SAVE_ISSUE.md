# Debug Guide: Production Log Book "Not Saved" Issue

## 🔍 Step-by-Step Debugging

### Step 1: Clear Browser Cache
1. Press `Ctrl + Shift + Delete` (or `Cmd + Shift + Delete` on Mac)
2. Clear cached images and files
3. Close browser completely
4. Reopen browser and login to ERPNext

### Step 2: Open Browser Console
1. Press `F12` to open Developer Tools
2. Click on "Console" tab
3. Keep it open during testing

### Step 3: Test the Save Function

#### A. Open Production Log Book
1. Go to Production Log Book list
2. Open an existing draft document (or create new one)
3. Make a small change (e.g., change a number field)

#### B. Watch Console During Save
1. With console open, click **Save** button
2. Watch for these console messages:
   - `🔵 BEFORE SAVE - Setting _is_saving flag`
   - `🟢 AFTER SAVE - Document saved successfully`
   - `🔄 REFRESH EVENT - docstatus: 0 is_new: false _just_saved: true`
   - `⚠️ REFRESH BLOCKED - Just saved, skipping all calculations`
   - `🟡 SAVE FLAG CLEARED - Normal operations resumed`

#### C. Check Form Status
After save, run this in console:
```javascript
console.log("Is Dirty:", cur_frm.is_dirty());
console.log("_just_saved:", cur_frm._just_saved);
console.log("_is_saving:", cur_frm._is_saving);
console.log("docstatus:", cur_frm.doc.docstatus);
```

### Step 4: Identify the Problem

#### ✅ If you see these messages:
```
🔵 BEFORE SAVE - Setting _is_saving flag
🟢 AFTER SAVE - Document saved successfully
🔄 REFRESH EVENT - docstatus: 0 is_new: false _just_saved: true
⚠️ REFRESH BLOCKED - Just saved, skipping all calculations
```

**AND** `is_dirty()` returns `false` → **Fix is working! 🎉**

#### ❌ If you see calculation messages after save:
```
⚙️ calculate_hopper_closing_qty RUNNING
⚙️ calculate_mip_closing_qty RUNNING
⚙️ calculate_net_weight RUNNING
```

**This means calculations are still running after save → Continue debugging**

#### ❌ If `is_dirty()` returns `true`:
**The form is still being marked as dirty → Continue debugging**

### Step 5: Advanced Debugging

If the issue persists, run this comprehensive check:

```javascript
// Check what fields have changed
console.log("Changed fields:", cur_frm.doc.__unsaved);

// Check if any field handlers are running
frappe.ui.form.events = new Proxy(frappe.ui.form.events, {
  get: function(target, prop) {
    console.log("Event handler called:", prop);
    return target[prop];
  }
});

// Monitor all set_value calls
const original_set_value = frappe.model.set_value;
frappe.model.set_value = function(doctype, docname, fieldname, value) {
  console.log("🔴 set_value called:", fieldname, "=", value);
  console.trace(); // Show call stack
  return original_set_value.apply(this, arguments);
};

// Now click Save and watch console
```

### Step 6: Check for Frappe Framework Issues

Sometimes Frappe's form framework itself causes issues. Try this:

```javascript
// After opening the form, before making changes:
cur_frm.on("after_save", function() {
  console.log("🔴 after_save hook fired");
  console.log("Dirty:", cur_frm.is_dirty());
});

// Now make a change and save
```

### Step 7: Nuclear Option - Disable All Calculations

If nothing works, add this at the top of the form script:

```javascript
frappe.ui.form.on("Production Log Book", {
  setup: function(frm) {
    // Store original dirty check
    const original_is_dirty = frm.is_dirty.bind(frm);
    
    // Override is_dirty to ignore calculated fields
    frm.is_dirty = function() {
      // If we just saved, always return false for 2 seconds
      if (frm._last_save_time && (Date.now() - frm._last_save_time) < 2000) {
        return false;
      }
      return original_is_dirty();
    };
  },
  
  before_save: function(frm) {
    frm._last_save_time = Date.now();
  }
});
```

## 📊 Expected Console Output

### Correct Behavior:
```
User clicks Save
↓
🔵 BEFORE SAVE - Setting _is_saving flag
↓
[Save request to server]
↓
🟢 AFTER SAVE - Document saved successfully
↓
🔄 REFRESH EVENT - docstatus: 0 is_new: false _just_saved: true
↓
⚠️ REFRESH BLOCKED - Just saved, skipping all calculations
↓
[Wait 1.5 seconds]
↓
🟡 SAVE FLAG CLEARED - Normal operations resumed
↓
✅ Form shows "Saved" status
```

### Incorrect Behavior (What we're trying to fix):
```
User clicks Save
↓
🔵 BEFORE SAVE - Setting _is_saving flag
↓
[Save request to server]
↓
🟢 AFTER SAVE - Document saved successfully
↓
🔄 REFRESH EVENT - docstatus: 0 is_new: false _just_saved: true
↓
⚙️ calculate_hopper_closing_qty RUNNING  ← PROBLEM!
↓
🔴 set_value called: closing_qty = 123.45  ← PROBLEM!
↓
❌ Form shows "Not Saved" status
```

## 🐛 Common Issues

### Issue 1: Console shows no messages
**Solution:** Clear browser cache completely and reload

### Issue 2: Calculations still running after save
**Solution:** Check if `_just_saved` flag is being set correctly:
```javascript
console.log("Flag set?", cur_frm._just_saved);
```

### Issue 3: Form dirty even with no calculations
**Solution:** There might be a Frappe framework issue. Use the "Nuclear Option" above.

## 📝 Report Back

Please share:
1. Screenshot of console output during save
2. Result of `cur_frm.is_dirty()` after save
3. Result of `cur_frm.doc.__unsaved` if dirty

This will help me identify the exact root cause!




