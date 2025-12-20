# Hopper Stock Entry - Rate Fetching Implementation

## ✅ Enhanced Rate Fetching Logic

The Hopper Stock Entry now uses a **multi-layered approach** to ensure the valuation rate is **always fetched** and **never zero** (unless truly no rate exists).

## 🔄 Rate Fetching Priority (5 Methods)

### Method 1: ERPNext's get_incoming_rate() ⭐ PRIMARY
```python
from erpnext.stock.utils import get_incoming_rate
```
- **Most reliable method**
- Uses ERPNext's built-in valuation logic
- Considers stock balance, FIFO/Moving Average, etc.
- **Best for accurate valuation**

### Method 2: Latest Stock Ledger Entry (Target Warehouse)
```sql
SELECT valuation_rate 
FROM `tabStock Ledger Entry`
WHERE item_code = ? AND warehouse = ? AND valuation_rate > 0
ORDER BY posting_date DESC, posting_time DESC
LIMIT 1
```
- Gets latest valuation from the **specific warehouse**
- Uses actual stock transactions

### Method 3: Latest Stock Ledger Entry (Any Warehouse)
```sql
SELECT valuation_rate 
FROM `tabStock Ledger Entry`
WHERE item_code = ? AND valuation_rate > 0
ORDER BY posting_date DESC, posting_time DESC
LIMIT 1
```
- Falls back to **any warehouse** if target warehouse has no stock
- Useful for new warehouses

### Method 4: Item Master Fields
Priority order:
1. `item.valuation_rate`
2. `item.standard_rate`
3. `item.last_purchase_rate`

### Method 5: Latest Purchase Receipt
```sql
SELECT rate 
FROM `tabPurchase Receipt Item`
WHERE item_code = ? AND rate > 0 AND docstatus = 1
ORDER BY creation DESC
LIMIT 1
```
- Last resort: Get from latest purchase

## 🔧 Post-Insert Rate Recalculation

After Stock Entry is inserted, the code **recalculates** the rate if it's still 0:

```python
stock_entry.insert(ignore_permissions=True)

# Recalculate rate if still 0
for item in stock_entry.items:
    if flt(item.basic_rate) == 0:
        # Try get_incoming_rate again with Stock Entry context
        calculated_rate = get_incoming_rate({...})
        if flt(calculated_rate) > 0:
            item.basic_rate = calculated_rate
            item.amount = calculated_rate * item.qty

# Save again if rate was updated
stock_entry.save(ignore_permissions=True)
stock_entry.submit()
```

This ensures ERPNext's rate calculation engine has a chance to set the rate.

## 📊 Logging & Debugging

### Log Messages

When a Production Log Book is submitted, check the logs:

```
INFO: Hopper Stock Entry - Item: HOPPER-001, Warehouse: Production - HEX, Valuation Rate: 150.50, Qty: 100
INFO: Rate fetched via get_incoming_rate for HOPPER-001: 150.50
```

### View Logs

**In Frappe:**
1. Go to **Error Log** (search in awesome bar)
2. Filter by **Title**: Contains "Hopper" or item code
3. Check error details if rate is 0

**In Terminal:**
```bash
tail -f ~/frappe-bench/logs/bench-start.log
```

Look for lines containing "Hopper Stock Entry"

## ⚠️ Troubleshooting Rate = 0

If rate is still coming as 0, check:

### 1. Item Master
- [ ] Item exists and is active
- [ ] `valuation_rate` field is set
- [ ] `standard_rate` field is set
- [ ] `last_purchase_rate` exists

### 2. Stock Ledger
- [ ] Item has previous stock transactions
- [ ] Valuation rate is set in Stock Ledger Entry
- [ ] Check: `SELECT * FROM tabStock Ledger Entry WHERE item_code = 'YOUR-ITEM' ORDER BY posting_date DESC LIMIT 10`

### 3. Warehouse
- [ ] Warehouse exists: "Production - HEX"
- [ ] Warehouse is active
- [ ] Item has stock balance in warehouse

### 4. Permissions
- [ ] User has permission to read Stock Ledger Entry
- [ ] User has permission to read Item

### 5. Company
- [ ] Default company is set
- [ ] Item is linked to the company

## 🔍 Manual Rate Check

Run this in **Frappe Console** to check what rate will be fetched:

```python
from hexplastics.hexplastics.doctype.production_log_book.production_log_book import _get_item_valuation_rate

item_code = "HOPPER-001"  # Replace with your item
warehouse = "Production - HEX"

rate = _get_item_valuation_rate(item_code, warehouse)
print(f"Fetched Rate: {rate}")
```

## 🎯 Expected Results

For a typical Hopper item with stock:

| Scenario | Expected Rate Source | Expected Rate |
|----------|---------------------|---------------|
| Item with stock in warehouse | Stock Ledger Entry | Moving Average / FIFO |
| Item without stock in warehouse | Item Master valuation_rate | Item's valuation rate |
| New item, no transactions | Item Master standard_rate | Standard rate |
| Item with purchases | Purchase Receipt | Last purchase rate |

## 🔐 Fallback to Zero

Rate will only be 0 if:
- ❌ Item doesn't exist
- ❌ No stock transactions ever
- ❌ No valuation rate set in Item master
- ❌ No standard rate set
- ❌ No purchase receipts
- ❌ All 5 methods failed

In this case, an **Error Log** will be created with details.

## 🚀 Testing Checklist

- [ ] Submit Production Log Book with hopper closing qty
- [ ] Check Stock Entry created
- [ ] Verify rate is **NOT zero**
- [ ] Check logs for rate source
- [ ] Verify amount = rate × qty
- [ ] Check stock balance updated
- [ ] Verify valuation report shows correct rate

## 📌 Code Location

**File**: `production_log_book.py`

**Function**: `_get_item_valuation_rate(item_code, warehouse)`

**Lines**: ~480-600 (enhanced rate fetching logic)

## 🎨 Customization

### Change Rate Calculation Method

Edit the priority order in `_get_item_valuation_rate()`:

```python
def _get_item_valuation_rate(item_code: str, warehouse: str) -> float:
    # Add your custom method here
    custom_rate = your_custom_logic(item_code, warehouse)
    if flt(custom_rate) > 0:
        return flt(custom_rate)
    
    # Then continue with existing methods...
```

### Force a Specific Rate

To always use a specific rate:

```python
# In create_hopper_stock_entry(), before adding item:
valuation_rate = 100.0  # Your fixed rate
```

Or set it in Item master's `valuation_rate` field.

---

**Last Updated**: December 2025  
**Status**: ✅ Production Ready  
**Rate Fetching Methods**: 5 (cascading priority)

