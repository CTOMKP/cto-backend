# Phase 1 (Vetting) Testing Guide

## Pre-Deployment Checklist

### 1. Environment Variables
Verify these are set in your backend (Coolify):
```
N8N_AUTOMATION_X_URL=https://n8n.ctomarketplace.com/webhook/vetting/submit
```

### 2. N8N Workflow Status
- [ ] Go to https://n8n.ctomarketplace.com/workflow/7mxdHJ9jk10P4cuy
- [ ] Verify workflow is **ACTIVE**
- [ ] Check webhook path: `/vetting/submit`

### 3. Database Connection
- [ ] Verify n8n workflow database connection points to same database as backend
- [ ] Check that tables exist: `tokens`, `vetting_results`, `lp_data`, `launch_analysis`, `holders`

## Testing Steps

### Test 1: Manual Webhook Test (Token >= 14 days)

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

**Expected Response:**
```json
{
  "success": true,
  "contractAddress": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  "tokenInfo": { ... },
  "vettingResults": {
    "overallScore": 75,
    "riskLevel": "low",
    "eligibleTier": "stellar",
    ...
  },
  "scannedAt": "..."
}
```

### Test 2: Manual Webhook Test (Token < 14 days)

```bash
curl -X POST https://n8n.ctomarketplace.com/webhook/vetting/submit \
  -H "Content-Type: application/json" \
  -d '{
    "contractAddress": "TestToken123456789012345678901234567890",
    "chain": "solana",
    "tokenInfo": { "name": "Test", "symbol": "TEST" },
    "security": {},
    "holders": { "count": 0, "topHolders": [] },
    "developer": {},
    "trading": {},
    "tokenAge": 5
  }'
```

**Expected Response:**
```json
{
  "error": "Token too young for vetting",
  "code": "TOKEN_TOO_NEW",
  "tokenAge": 5,
  "minimumAge": 14
}
```

### Test 3: Backend Integration Test

After deployment, check backend logs for:

1. **New token discovery:**
   ```
   ✅ Token {address} is {X} days old (>= 14 days), proceeding with n8n vetting
   📤 Sending complete data payload to n8n for {address}
   ✅ Successfully triggered n8n vetting for new token: {address}
   ```

2. **Young token rejection:**
   ```
   ⏳ Skipping n8n vetting for {address}: Token age is {X} days (minimum 14 days required)
   ```

3. **Existing token processing:**
   ```
   📋 Processing {X} unvetted tokens through n8n...
   ✅ Completed processing {X} unvetted tokens
   ```

### Test 4: Database Verification

Check database for vetting results:

```sql
-- Check tokens with risk scores (vetted)
SELECT contract_address, name, symbol, 
       (SELECT overall_score FROM vetting_results WHERE token_id = tokens.id) as risk_score,
       (SELECT risk_level FROM vetting_results WHERE token_id = tokens.id) as risk_level
FROM tokens
WHERE (SELECT overall_score FROM vetting_results WHERE token_id = tokens.id) IS NOT NULL
LIMIT 10;

-- Check tokens without risk scores (unvetted or too young)
SELECT contract_address, name, symbol, token_age_days
FROM tokens
WHERE (SELECT overall_score FROM vetting_results WHERE token_id = tokens.id) IS NULL
ORDER BY token_age_days ASC
LIMIT 10;
```

### Test 5: Frontend Verification

1. Go to listings page
2. Verify tokens >= 14 days show risk scores
3. Verify tokens < 14 days show "Not Scanned"
4. Check that both types are displayed (as requested)

## Troubleshooting

### Issue: "N8N_AUTOMATION_X_URL is not configured"
**Solution:** Set environment variable in Coolify backend settings

### Issue: "Failed to trigger n8n vetting"
**Solution:** 
- Check n8n workflow is active
- Check webhook URL is correct
- Check n8n execution logs for errors

### Issue: "Token too young" for tokens >= 14 days
**Solution:**
- Verify age calculation is correct
- Check creation timestamp is being fetched properly
- Check Helius API is returning creation date

### Issue: No executions in n8n
**Solution:**
- Verify workflow is active
- Check webhook path matches environment variable
- Test webhook manually (see Test 1)

## Success Criteria

✅ Tokens >= 14 days are automatically vetted when discovered
✅ Tokens < 14 days are saved but not vetted (show "Not Scanned")
✅ Existing unvetted tokens are processed gradually (10 every 10 minutes)
✅ N8N executions appear in n8n dashboard
✅ Database gets updated with vetting results
✅ Frontend displays both vetted and unvetted tokens

