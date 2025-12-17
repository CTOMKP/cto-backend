# N8N Troubleshooting Checklist

## ✅ Current Status
- ✅ Backend deployed successfully
- ✅ Age calculation fixed (detects milliseconds vs seconds)
- ✅ Improved error logging in n8n service
- ✅ Cron jobs configured correctly

## 🔍 What to Check

### 1. **N8N Webhook URL Configuration** (CRITICAL)
The n8n webhook URL **MUST** include port 5678:

**Current (WRONG):**
```
N8N_AUTOMATION_X_URL=https://n8n.ctomarketplace.com/webhook/vetting/submit
```

**Should be:**
```
N8N_AUTOMATION_X_URL=https://n8n.ctomarketplace.com:5678/webhook/vetting/submit
```

**Action:** Update this in Coolify environment variables.

### 2. **Wait for Cron Jobs to Run**
Cron jobs run at specific intervals:
- **Token Discovery**: Every 2 minutes (at :00, :02, :04, :06, :08, :10, etc.)
- **Token Monitoring**: Every 5 minutes (at :00, :05, :10, :15, etc.)
- **Process Unvetted Tokens**: Every 10 minutes (at :00, :10, :20, :30, etc.)

Since the app started at 7:08:33, the next runs are at **7:10:00**.

### 3. **Check Logs for Cron Job Activity**
Look for these log messages:
- `🔄 Starting processExistingUnvettedTokens cron job...`
- `Starting token discovery cron job`
- `Starting token monitoring cron job`
- `✅ Token ... is X days old (>= 14 days), proceeding with n8n vetting`
- `📤 Sending complete data payload to n8n for ...`

### 4. **Check for N8N Webhook Errors**
Look for these error messages:
- `❌ Failed to trigger initial vetting for ...`
- `Error details: ... URL: ...`
- `HTTP ...: ...` (status codes)

### 5. **Verify N8N Workflow is Active**
1. Go to n8n dashboard: `https://n8n.ctomarketplace.com:5678`
2. Check if the workflow "CTOMarketplace - Pillar 1 Vetting System (SOL) - simple" is **Active**
3. Check the webhook URL matches: `/webhook/vetting/submit`

### 6. **Check Database for Unvetted Tokens**
Run this SQL query to see how many tokens need vetting:

```sql
-- Count unvetted tokens (no riskScore)
SELECT COUNT(*) as unvetted_count
FROM "Listing"
WHERE "riskScore" IS NULL;

-- Count tokens that are >= 14 days old and unvetted
SELECT COUNT(*) as eligible_count
FROM "Listing"
WHERE "riskScore" IS NULL
AND (
  "createdAt" <= NOW() - INTERVAL '14 days'
  OR "age" IS NOT NULL
);
```

### 7. **Manual Test N8N Webhook**
Test the webhook directly using PowerShell:

```powershell
Invoke-RestMethod -Uri "https://n8n.ctomarketplace.com:5678/webhook/vetting/submit" -Method Post -Headers @{"Content-Type"="application/json"} -Body '{"contractAddress":"DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263","chain":"solana","tokenInfo":{"name":"BONK","symbol":"BONK","image":"https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I","decimals":5},"security":{"isMintable":false,"isFreezable":false,"lpLockPercentage":99,"totalSupply":100000000000,"circulatingSupply":100000000000,"lpLocks":[]},"holders":{"count":100000,"topHolders":[{"address":"7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU","balance":1000000,"percentage":0.1}]},"developer":{"creatorAddress":"7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU","creatorBalance":0,"creatorStatus":"creator_sold","top10HolderRate":0.2,"twitterCreateTokenCount":0},"trading":{"price":0.00001,"priceChange24h":5.5,"volume24h":1000000,"buys24h":500,"sells24h":300,"liquidity":500000,"holderCount":100000},"tokenAge":365,"topTraders":[]}'
```

## 📊 Expected Behavior

### When a Token is Eligible (>= 14 days old):
1. ✅ Age calculation shows positive days (not negative)
2. ✅ Log: `✅ Token ... is X days old (>= 14 days), proceeding with n8n vetting`
3. ✅ Log: `📤 Sending complete data payload to n8n for ...`
4. ✅ Log: `✅ Initial vetting completed for ...: 200 OK` (if successful)
5. ✅ Or: `❌ Failed to trigger initial vetting for ...: [error details]` (if failed)

### When a Token is Too Young (< 14 days):
1. ✅ Log: `⏳ Skipping n8n vetting for ...: Token age is X days (minimum 14 days required)`

## 🐛 Common Issues

### Issue 1: No Cron Job Logs
**Symptom:** No logs from cron jobs after 10+ minutes
**Solution:** Check if `ScheduleModule.forRoot()` is imported in `app.module.ts` (✅ Already done)

### Issue 2: Webhook URL Error
**Symptom:** `❌ Failed to trigger initial vetting: connect ECONNREFUSED` or `404 Not Found`
**Solution:** Update `N8N_AUTOMATION_X_URL` to include port `:5678`

### Issue 3: All Tokens Too Young
**Symptom:** All tokens show `⏳ Skipping n8n vetting ... Token age is X days (minimum 14 days required)`
**Solution:** This is expected for new tokens. Wait for tokens to age, or manually test with an old token.

### Issue 4: Negative Age Calculation
**Symptom:** Age shows negative days (e.g., `-19549175 days`)
**Solution:** ✅ Fixed in latest deployment - age calculation now detects milliseconds vs seconds

## 📝 Next Steps

1. **Update N8N Webhook URL** in Coolify to include `:5678`
2. **Wait 10 minutes** for cron jobs to run
3. **Check logs** for cron job activity and n8n webhook calls
4. **Verify n8n workflow** is active and receiving webhooks
5. **Check database** to see if vetting results are being saved

