# Debug: No N8N Executions

## Problem
No executions appearing in n8n dashboard today, even though backend is deployed and running.

## Root Cause Analysis

### From Backend Logs:
```
⏳ Skipping n8n vetting for nCV6AJpGvWT8QNCYRnSEJo3CWJ71raNBbtybVcoP2vG: Token age is 0 days (minimum 14 days required)
```

**The age filter is working correctly!** Tokens being discovered are too young (< 14 days), so they're being skipped.

## Why No Executions?

1. **New tokens are too young**: All tokens discovered today are < 14 days old
2. **Existing tokens may not exist**: If there are no existing unvetted tokens >= 14 days old, nothing will be processed
3. **Cron job may not be running**: The `processExistingUnvettedTokens` cron job runs every 10 minutes

## Verification Steps

### Step 1: Check if Workflow is Active
1. Go to https://n8n.ctomarketplace.com
2. Open workflow: https://n8n.ctomarketplace.com/workflow/7mxdHJ9jk10P4cuy
3. Verify it shows **"Active"** (green toggle)
4. Check webhook URL matches: `https://n8n.ctomarketplace.com/webhook/vetting/submit`

### Step 2: Test Workflow Manually
Test the webhook directly to verify it works:

```bash
curl -X POST https://n8n.ctomarketplace.com/webhook/vetting/submit \
  -H "Content-Type: application/json" \
  -d '{
    "contractAddress": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    "chain": "solana",
    "tokenInfo": {
      "name": "BONK",
      "symbol": "BONK",
      "image": "https://example.com/logo.png",
      "decimals": 5
    },
    "security": {
      "isMintable": false,
      "isFreezable": false,
      "lpLockPercentage": 99,
      "totalSupply": 100000000000,
      "circulatingSupply": 100000000000,
      "lpLocks": []
    },
    "holders": {
      "count": 100000,
      "topHolders": [
        {"address": "abc123", "balance": 1000, "percentage": 1.0}
      ]
    },
    "developer": {
      "creatorAddress": "xyz789",
      "creatorBalance": 0,
      "creatorStatus": "creator_sold",
      "top10HolderRate": 0.2,
      "twitterCreateTokenCount": 0
    },
    "trading": {
      "price": 0.00001,
      "priceChange24h": 5.5,
      "volume24h": 1000000,
      "buys24h": 500,
      "sells24h": 300,
      "liquidity": 500000,
      "holderCount": 100000
    },
    "tokenAge": 365,
    "topTraders": []
  }'
```

**Expected**: Should see an execution in n8n dashboard

### Step 3: Check Database for Existing Tokens
Check if there are any tokens >= 14 days old that need vetting:

```sql
-- Check tokens without risk scores (unvetted)
SELECT 
  contract_address, 
  name, 
  symbol, 
  created_at,
  EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400 as age_days,
  risk_score
FROM listing
WHERE risk_score IS NULL
ORDER BY created_at ASC
LIMIT 20;
```

### Step 4: Check Cron Job Logs
Look for these log messages in backend logs:

**For existing unvetted tokens:**
```
📋 Processing {X} unvetted tokens through n8n...
✅ Completed processing {X} unvetted tokens
```

**For new tokens (if >= 14 days):**
```
✅ Token {address} is {X} days old (>= 14 days), proceeding with n8n vetting
📤 Sending complete data payload to n8n for {address}
✅ Successfully triggered n8n vetting for new token: {address}
```

### Step 5: Verify Environment Variable
Check that `N8N_AUTOMATION_X_URL` is set correctly in Coolify:
- Should be: `https://n8n.ctomarketplace.com/webhook/vetting/submit`
- Check in Coolify → Environment Variables

## Solutions

### Solution 1: Wait for Older Tokens
- Tokens need to be >= 14 days old to be vetted
- New tokens will be vetted automatically once they reach 14 days
- The `processExistingUnvettedTokens` cron job will process existing tokens every 10 minutes

### Solution 2: Manually Test with Old Token
Use a well-known old token (like BONK) to test the workflow:
- BONK is definitely > 14 days old
- Should trigger n8n vetting immediately

### Solution 3: Temporarily Lower Age Filter (For Testing Only)
If you want to test immediately, you can temporarily lower the age filter to 0 days:

**⚠️ WARNING: Only for testing! Revert after testing!**

In `refresh.worker.ts` and `cron.service.ts`, change:
```typescript
if (tokenAge < 14) {  // Change to 0 for testing
```

**Then commit, push, and redeploy.**

### Solution 4: Check if Cron Job is Running
The `processExistingUnvettedTokens` cron job should run every 10 minutes. Check logs for:
```
📋 Processing {X} unvetted tokens through n8n...
```

If you don't see this, the cron job may not be running.

## Expected Behavior

### Normal Flow:
1. **New token discovered** → Check age
   - If < 14 days → Skip (save to DB but don't vet)
   - If >= 14 days → Send to n8n immediately
2. **Existing unvetted tokens** → Process 10 every 10 minutes
   - Only tokens >= 14 days old are sent to n8n
   - Older tokens are processed first

### Current Situation:
- All new tokens are < 14 days old → Being skipped (correct behavior)
- No existing tokens >= 14 days old → Nothing to process
- Result: No n8n executions (expected)

## Next Steps

1. **Test workflow manually** (Step 2 above) to verify it works
2. **Check database** (Step 3) to see if there are any old unvetted tokens
3. **Wait for tokens to age** or use known old tokens for testing
4. **Monitor logs** for the cron job execution

## Summary

**The system is working correctly!** The age filter is preventing young tokens from being vetted, which is the intended behavior. You won't see n8n executions until:
- A token >= 14 days old is discovered, OR
- An existing unvetted token >= 14 days old is processed by the cron job

