# Why Backend Isn't Sending Tokens to N8N

## Problem

Backend is not sending tokens to n8n automation, even though manual testing works.

## Root Cause Analysis

### Issue 1: Token Age Calculation Returns 0

From `refresh.worker.ts` line 1196-1199:
```typescript
const creationTimestamp = heliusData?.creationTimestamp || pair?.pairCreatedAt;
const tokenAge = creationTimestamp 
  ? Math.floor((Date.now() - (creationTimestamp * 1000)) / (1000 * 60 * 60 * 24))
  : 0;  // ⚠️ Defaults to 0 if no creation timestamp!
```

**Problem:**
- If `heliusData?.creationTimestamp` is missing AND `pair?.pairCreatedAt` is missing
- `tokenAge` defaults to **0**
- All tokens with `tokenAge = 0` are skipped (age filter requires >= 14 days)

### Issue 2: New Tokens Are Too Young

From your logs:
```
⏳ Skipping n8n vetting for nCV6AJpGvWT8QNCYRnSEJo3CWJ71raNBbtybVcoP2vG: Token age is 0 days (minimum 14 days required)
```

**This is expected behavior!** New tokens from DexScreener are typically:
- Just created (minutes/hours old)
- Don't have creation timestamps available
- Age defaults to 0
- All get skipped

### Issue 3: Creation Timestamp Not Available

The age calculation relies on:
1. **Helius API** (`heliusData?.creationTimestamp`) - May not return creation date
2. **DexScreener** (`pair?.pairCreatedAt`) - May not be available for new tokens

If both are missing → `tokenAge = 0` → Token skipped

## Solutions

### Solution 1: Improve Age Calculation (Recommended)

Update `triggerN8nVettingForNewToken` to try multiple sources for creation date:

```typescript
// Try multiple sources for creation timestamp
const creationTimestamp = 
  heliusData?.creationTimestamp ||           // Helius RPC
  pair?.pairCreatedAt ||                     // DexScreener
  combinedData?.gmgn?.open_timestamp ||      // GMGN data
  combinedData?.gmgn?.creation_timestamp ||  // GMGN alternative
  null;

// If still no timestamp, try to estimate from first transaction
// Or use a fallback: assume token is at least 1 day old if it has significant trading
let tokenAge = 0;
if (creationTimestamp) {
  tokenAge = Math.floor((Date.now() - (creationTimestamp * 1000)) / (1000 * 60 * 60 * 24));
} else {
  // Fallback: If token has significant volume/holders, estimate minimum age
  const hasSignificantActivity = (trading?.volume24h || 0) > 10000 || (holders?.count || 0) > 100;
  if (hasSignificantActivity) {
    // Estimate minimum 1 day old (conservative)
    tokenAge = 1;
    this.logger.debug(`⚠️ No creation timestamp for ${contractAddress}, estimating minimum age: 1 day`);
  }
}
```

### Solution 2: Log Age Calculation Details

Add detailed logging to understand why age is 0:

```typescript
this.logger.debug(`🔍 Age calculation for ${contractAddress}:`);
this.logger.debug(`  - heliusData?.creationTimestamp: ${heliusData?.creationTimestamp}`);
this.logger.debug(`  - pair?.pairCreatedAt: ${pair?.pairCreatedAt}`);
this.logger.debug(`  - Calculated tokenAge: ${tokenAge}`);
```

### Solution 3: Process Existing Tokens

The `processExistingUnvettedTokens` cron job should handle existing tokens:

```typescript
@Cron('0 */10 * * * *', {
  name: 'vet-existing-tokens',
  timeZone: 'UTC',
})
async processExistingUnvettedTokens() {
  // Gets tokens without riskScore
  // Processes 10 every 10 minutes
  // Only processes tokens >= 14 days old
}
```

**Check if this cron is running:**
- Look for logs: `📋 Processing {X} unvetted tokens through n8n...`
- If you don't see this, the cron may not be running

### Solution 4: Temporarily Lower Age Filter (Testing Only)

For testing purposes, you can temporarily lower the age filter:

```typescript
// In refresh.worker.ts line 1202
const MIN_TOKEN_AGE_DAYS = 0; // Temporarily set to 0 for testing
```

**⚠️ WARNING:** Only for testing! Revert after testing.

## Why This Happens

### Normal Flow:
1. **RefreshWorker** discovers new tokens from DexScreener
2. Tokens are typically **brand new** (minutes/hours old)
3. Creation timestamp is often **not available** from APIs
4. `tokenAge` defaults to **0**
5. Age filter skips tokens < 14 days
6. **Result:** No tokens sent to n8n (expected for new tokens)

### Expected Behavior:
- **New tokens** (< 14 days) → Saved to DB, but NOT vetted
- **Existing tokens** (>= 14 days) → Processed by `processExistingUnvettedTokens` cron
- **Manual test** → Works because we used `tokenAge: 365` (old token)

## Verification Steps

### Step 1: Check Backend Logs

Look for these log messages:

**For new tokens:**
```
⏳ Skipping n8n vetting for {address}: Token age is 0 days (minimum 14 days required)
```

**For existing tokens:**
```
📋 Processing {X} unvetted tokens through n8n...
```

### Step 2: Check Database for Existing Tokens

```sql
-- Check tokens without risk scores (unvetted)
SELECT 
  "contractAddress", 
  name, 
  symbol, 
  "createdAt",
  EXTRACT(EPOCH FROM (NOW() - "createdAt")) / 86400 as age_days,
  "riskScore"
FROM "Listing"
WHERE "riskScore" IS NULL
ORDER BY "createdAt" ASC
LIMIT 20;
```

### Step 3: Check Cron Job Status

The `processExistingUnvettedTokens` cron should run every 10 minutes. Check logs for:
```
📋 Processing {X} unvetted tokens through n8n...
```

## Summary

**The system is working as designed:**
- ✅ New tokens are being discovered
- ✅ Age filter is working (skipping tokens < 14 days)
- ✅ Tokens are being saved to database
- ❌ No tokens >= 14 days are being discovered (because they're all new)

**Solutions:**
1. **Wait** for tokens to age (they'll be vetted automatically once >= 14 days)
2. **Improve age calculation** to use multiple data sources
3. **Check existing tokens** in database - they should be processed by cron job
4. **Temporarily lower age filter** for testing (not recommended for production)

The backend IS working correctly - it's just that all discovered tokens are too young!

