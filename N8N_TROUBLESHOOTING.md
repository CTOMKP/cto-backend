# N8N Workflow Troubleshooting Guide

## Problem: No Executions in N8N Dashboard

### Step 1: Verify Workflow is Active

1. Go to https://n8n.ctomarketplace.com
2. Navigate to: https://n8n.ctomarketplace.com/workflow/7mxdHJ9jk10P4cuy
3. Check the toggle in the top-right corner
   - Should be **"Active"** (green/enabled)
   - If it's **"Inactive"** (gray/disabled), click to activate it

### Step 2: Test Webhook Manually

#### Option A: PowerShell (Windows)

**Single-line command:**
```powershell
Invoke-RestMethod -Uri "https://n8n.ctomarketplace.com/webhook/vetting/submit" -Method Post -Headers @{"Content-Type"="application/json"} -Body '{"contractAddress":"DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263","chain":"solana","tokenInfo":{"name":"BONK","symbol":"BONK","image":"https://example.com/logo.png","decimals":5},"security":{"isMintable":false,"isFreezable":false,"lpLockPercentage":99,"totalSupply":100000000000,"circulatingSupply":100000000000,"lpLocks":[]},"holders":{"count":100000,"topHolders":[{"address":"abc123","balance":1000,"percentage":1.0}]},"developer":{"creatorAddress":"xyz789","creatorBalance":0,"creatorStatus":"creator_sold","top10HolderRate":0.2,"twitterCreateTokenCount":0},"trading":{"price":0.00001,"priceChange24h":5.5,"volume24h":1000000,"buys24h":500,"sells24h":300,"liquidity":500000,"holderCount":100000},"tokenAge":365,"topTraders":[]}'
```

**Or use the script file:**
```powershell
cd C:\Users\EMMA\Desktop\cto\cto-backend-old-fresh
.\TEST_N8N_POWERSHELL.ps1
```

#### Option B: Using Git Bash (if installed)

```bash
curl -X POST https://n8n.ctomarketplace.com/webhook/vetting/submit \
  -H "Content-Type: application/json" \
  -d '{
    "contractAddress": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    "chain": "solana",
    "tokenInfo": {"name": "BONK", "symbol": "BONK", "image": "https://example.com/logo.png", "decimals": 5},
    "security": {"isMintable": false, "isFreezable": false, "lpLockPercentage": 99, "totalSupply": 100000000000, "circulatingSupply": 100000000000, "lpLocks": []},
    "holders": {"count": 100000, "topHolders": [{"address": "abc123", "balance": 1000, "percentage": 1.0}]},
    "developer": {"creatorAddress": "xyz789", "creatorBalance": 0, "creatorStatus": "creator_sold", "top10HolderRate": 0.2, "twitterCreateTokenCount": 0},
    "trading": {"price": 0.00001, "priceChange24h": 5.5, "volume24h": 1000000, "buys24h": 500, "sells24h": 300, "liquidity": 500000, "holderCount": 100000},
    "tokenAge": 365,
    "topTraders": []
  }'
```

### Step 3: Check N8N Dashboard for Execution

1. Go to https://n8n.ctomarketplace.com
2. Click **"Executions"** in the left sidebar
3. Look for the most recent execution (should appear immediately after the test)
4. Click on it to see details

**If you see an execution:**
- ✅ Workflow is working!
- The issue is that backend tokens are too young (< 14 days)

**If you DON'T see an execution:**
- ❌ Workflow may not be active
- ❌ Webhook URL may be wrong
- ❌ There may be an error in the workflow

### Step 4: Check Workflow Webhook URL

1. Open the workflow: https://n8n.ctomarketplace.com/workflow/7mxdHJ9jk10P4cuy
2. Click on the **"Webhook"** node (first node)
3. Check the **"Path"** field:
   - Should be: `/vetting/submit`
   - Full URL should be: `https://n8n.ctomarketplace.com/webhook/vetting/submit`

### Step 5: Check Workflow Execution Logs

1. In n8n dashboard, go to **"Executions"**
2. If there are any executions (even failed ones), click on them
3. Check the error messages
4. Look for:
   - Database connection errors
   - Missing environment variables
   - Invalid data format

### Step 6: Verify Backend Environment Variable

In Coolify backend settings, verify:
- Variable: `N8N_AUTOMATION_X_URL`
- Value: `https://n8n.ctomarketplace.com/webhook/vetting/submit`

### Step 7: Check Backend Logs

After running the test, check backend logs for:
```
📤 Sending complete data payload to n8n for {address}
✅ Successfully triggered n8n vetting for new token: {address}
```

Or errors like:
```
❌ Failed to trigger n8n vetting: {error}
```

## Common Issues

### Issue 1: "Workflow is not active"
**Solution:** Activate the workflow in n8n dashboard

### Issue 2: "Webhook URL not found (404)"
**Solution:** 
- Check webhook path in workflow matches: `/vetting/submit`
- Verify n8n instance URL is correct: `https://n8n.ctomarketplace.com`

### Issue 3: "Database connection error"
**Solution:**
- Check PostgreSQL credentials in n8n
- Verify database connection is configured correctly
- Check if database tables exist

### Issue 4: "No executions from backend"
**This is expected!** Tokens < 14 days old are skipped by design.

## Next Steps

1. **Test webhook manually** (Step 2) to verify it works
2. **Check n8n dashboard** (Step 3) for execution
3. **If workflow works but no backend executions:**
   - Wait for tokens to reach 14 days old
   - Or check database for existing tokens >= 14 days old
   - The cron job will process them automatically

## Summary

**If manual test works but no backend executions:**
- ✅ Workflow is fine
- ✅ Age filter is working (skipping young tokens)
- ⏳ Just need to wait for tokens to age, or use old tokens for testing

**If manual test fails:**
- ❌ Workflow may not be active
- ❌ Check webhook URL and path
- ❌ Check workflow for errors

