# N8N Workflow Updated - Summary

## ✅ Changes Made

### 1. Updated Workflow JSON File
**File:** `CTOMarketplace - Pillar 1 Vetting System (SOL) - simple.json`

**Changes:**
- ✅ "Insert All Data" node now uses `"Listing"` table instead of `tokens` table
- ✅ Stores all data in `Listing` table with `metadata` JSONB field
- ✅ Updates `riskScore`, `tier`, and `summary` fields directly
- ✅ "Insert Each Holder" node now updates `Listing.metadata` instead of separate `holders` table

### 2. Improved Backend Age Calculation
**File:** `src/listing/workers/refresh.worker.ts`

**Changes:**
- ✅ Tries multiple sources for creation timestamp (Helius, DexScreener, GMGN)
- ✅ Falls back to database `createdAt` if no timestamp available
- ✅ Estimates minimum age (7 days) for tokens with significant activity
- ✅ Added detailed logging for debugging age calculation

## 📋 Next Steps

### Step 1: Upload Updated Workflow to N8N

1. Go to https://n8n.ctomarketplace.com
2. Open workflow: https://n8n.ctomarketplace.com/workflow/7mxdHJ9jk10P4cuy
3. Click **"Import from File"** or **"Replace with File"**
4. Upload: `CTOMarketplace - Pillar 1 Vetting System (SOL) - simple.json`
5. Review the "Insert All Data" node - verify SQL uses `"Listing"` table
6. Activate the workflow

### Step 2: Deploy Backend Changes

1. Commit and push the improved age calculation:
   ```bash
   cd cto-backend-old-fresh
   git add src/listing/workers/refresh.worker.ts
   git commit -m "feat: improve token age calculation with multiple sources and fallbacks"
   git push origin backend-auth-scan
   ```

2. Wait for Coolify to auto-deploy

### Step 3: Test Again

1. Test webhook manually (should still work)
2. Check backend logs for improved age calculation details
3. Verify data is saved to `Listing` table:
   ```sql
   SELECT * FROM "Listing" 
   WHERE "contractAddress" = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
   ```

## 🔍 Why Tokens Aren't Being Sent

### The Issue:
1. **New tokens from DexScreener** are typically **minutes/hours old**
2. **Creation timestamps** are often **not available** from APIs
3. **Token age defaults to 0** when no timestamp found
4. **Age filter skips** tokens < 14 days
5. **Result:** No tokens sent to n8n (expected for new tokens)

### The Solution:
The improved age calculation will:
- ✅ Try multiple data sources for creation date
- ✅ Use database `createdAt` as fallback
- ✅ Estimate minimum age for tokens with activity
- ✅ Provide better logging to understand why age is 0

### Expected Behavior After Fix:
- **Tokens with timestamps** → Age calculated correctly → Vetted if >= 14 days
- **Tokens with activity** → Estimated 7 days minimum → Still skipped (needs 14 days)
- **Very new tokens** → Age = 0 → Skipped (expected)
- **Better logging** → You'll see why each token is skipped

## 📊 Current Status

| Component | Status | Notes |
|-----------|--------|-------|
| N8N Workflow | ✅ Updated | Now uses `Listing` table |
| Backend Age Calc | ✅ Improved | Multiple sources + fallbacks |
| Manual Test | ✅ Working | Webhook responds correctly |
| Backend → N8N | ⏳ Waiting | Tokens too young (< 14 days) |

## 🎯 Summary

**The system is working correctly!** The issue is:
- All discovered tokens are **too young** (< 14 days)
- Age calculation was **too simple** (only 2 sources)
- Now **improved** to try multiple sources and fallbacks

**After deploying the improved age calculation:**
- More tokens will have accurate ages
- Tokens with activity will get estimated ages
- Better logging will show why tokens are skipped
- Eventually, tokens will age and be vetted automatically

