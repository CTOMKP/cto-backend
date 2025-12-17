# Test N8N Workflow - Manual Verification

## Quick Test: Verify Workflow is Working

### Step 1: Test Webhook Directly

Run this command to test if the n8n workflow responds:

```bash
curl -X POST https://n8n.ctomarketplace.com/webhook/vetting/submit \
  -H "Content-Type: application/json" \
  -d '{
    "contractAddress": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    "chain": "solana",
    "tokenInfo": {
      "name": "BONK",
      "symbol": "BONK",
      "image": "https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I",
      "decimals": 5
    },
    "security": {
      "isMintable": false,
      "isFreezable": false,
      "lpLockPercentage": 99,
      "totalSupply": 100000000000000,
      "circulatingSupply": 100000000000000,
      "lpLocks": []
    },
    "holders": {
      "count": 1000000,
      "topHolders": [
        {"address": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", "balance": 1000000, "percentage": 0.1}
      ]
    },
    "developer": {
      "creatorAddress": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
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
      "holderCount": 1000000
    },
    "tokenAge": 365,
    "topTraders": []
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "contractAddress": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  "vettingResults": {
    "overallScore": 75,
    "riskLevel": "low",
    ...
  }
}
```

**If you get a response:**
- ✅ Workflow is active and working
- Check n8n dashboard for the execution

**If you get an error:**
- ❌ Workflow may not be active
- Check n8n dashboard to verify workflow status

### Step 2: Check N8N Dashboard

1. Go to https://n8n.ctomarketplace.com
2. Click on "Executions" in the left sidebar
3. Look for recent executions (should show the test from Step 1)
4. Click on an execution to see details

### Step 3: Verify Workflow is Active

1. Go to https://n8n.ctomarketplace.com/workflow/7mxdHJ9jk10P4cuy
2. Check the toggle in the top right - should be **"Active"** (green)
3. If it's inactive, click to activate it

### Step 4: Check Backend Logs

After running the test, check backend logs for:
```
📤 Sending complete data payload to n8n for DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263
✅ Successfully triggered n8n vetting for new token: DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263
```

## Why No Executions from Backend?

### Current Situation:
From your logs:
```
⏳ Skipping n8n vetting for nCV6AJpGvWT8QNCYRnSEJo3CWJ71raNBbtybVcoP2vG: Token age is 0 days (minimum 14 days required)
```

**This is correct behavior!** The age filter is working as intended.

### Reasons for No Executions:

1. **All new tokens are too young** (< 14 days old)
   - They're being saved to the database
   - But NOT sent to n8n (by design)
   - They'll be vetted once they reach 14 days

2. **No existing unvetted tokens >= 14 days**
   - The `processExistingUnvettedTokens` cron job runs every 10 minutes
   - It only processes tokens >= 14 days old
   - If all existing tokens are < 14 days, nothing will be processed

3. **Cron job may not have run yet**
   - Runs every 10 minutes
   - Check logs for: `📋 Processing {X} unvetted tokens through n8n...`

## Solutions

### Option 1: Wait for Tokens to Age
- Tokens will automatically be vetted once they reach 14 days old
- The cron job will process them gradually

### Option 2: Test with Known Old Token
Use a well-known old token (like BONK, SOL, etc.) that's definitely > 14 days old to test the workflow.

### Option 3: Check Database
Query the database to see if there are any tokens >= 14 days old:

```sql
SELECT 
  contract_address, 
  name, 
  symbol, 
  created_at,
  EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400 as age_days,
  risk_score
FROM listing
WHERE risk_score IS NULL
  AND EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400 >= 14
ORDER BY created_at ASC
LIMIT 20;
```

If this returns results, those tokens should be processed by the cron job.

## Summary

**The system is working correctly!** The age filter is preventing young tokens from being vetted, which is the intended behavior. You won't see n8n executions until:
- A token >= 14 days old is discovered, OR
- An existing unvetted token >= 14 days old is processed by the cron job

**To verify the workflow works:**
1. Test the webhook manually (Step 1 above)
2. Check n8n dashboard for the execution
3. If it works, the workflow is fine - you just need to wait for tokens to age

