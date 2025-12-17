# Phase 2 (Monitoring) Setup Guide

## Overview

Phase 2 is the **Continuous Monitoring** workflow that:
- Monitors already-vetted tokens every 5 minutes
- Detects changes in price, volume, liquidity, holders
- Re-evaluates risk scores based on new data
- Updates database with monitoring results

## Workflow Details

- **File**: `CTO Marketplace - Phase 2 Monitoring (Every 5 Minutes) (1).json`
- **Webhook Path**: `/monitoring/update`
- **Full URL**: `https://n8n.ctomarketplace.com/webhook/monitoring/update`

## Pre-Upload Checklist

### 1. Verify Phase 1 is Working
- [ ] Phase 1 workflow is active and processing tokens
- [ ] Tokens are being vetted successfully
- [ ] Database has tokens with `vetting_results` entries

### 2. Backend Configuration
- [ ] Set environment variable: `N8N_AUTOMATION_Y_URL=https://n8n.ctomarketplace.com/webhook/monitoring/update`
- [ ] Verify `CronService.handleTokenMonitoring()` is enabled
- [ ] Check cron job runs every 5 minutes

## Upload Steps

### Step 1: Import Workflow to N8N

1. Go to https://n8n.ctomarketplace.com
2. Click **"Workflows"** → **"Add workflow"**
3. Click **"Import from File"** or **"Import from URL"**
4. Upload `CTO Marketplace - Phase 2 Monitoring (Every 5 Minutes) (1).json`
5. Review workflow structure

### Step 2: Configure Database Connection

The workflow uses PostgreSQL. Verify:
- [ ] Database credentials are configured in n8n
- [ ] Connection points to same database as backend
- [ ] Tables exist: `tokens`, `vetting_results`, `monitoring_snapshots`

### Step 3: Configure APIFY API Key (if needed)

The workflow uses Apify for GMGN data:
- [ ] Set `APIFY_API_KEY` in n8n environment variables (if required)
- [ ] Or verify workflow uses free/public endpoints

### Step 4: Activate Workflow

1. Click **"Activate"** button (top right)
2. Verify workflow shows as **"Active"**
3. Note the webhook URL: `https://n8n.ctomarketplace.com/webhook/monitoring/update`

## Backend Integration

### Environment Variable

Add to backend (Coolify):
```
N8N_AUTOMATION_Y_URL=https://n8n.ctomarketplace.com/webhook/monitoring/update
```

### Verify CronService is Enabled

The `CronService.handleTokenMonitoring()` should:
- Run every 5 minutes
- Get listings with `riskScore IS NOT NULL` (already vetted)
- Send them to n8n Phase 2 webhook

Check `src/services/cron.service.ts`:
```typescript
@Cron('0 */5 * * * *', {
  name: 'token-monitoring',
  timeZone: 'UTC',
})
async handleTokenMonitoring() {
  // Should call processListingMonitoring()
  // Which calls n8nService.triggerContinuousMonitoring()
}
```

## Testing Phase 2

### Test 1: Manual Webhook Test

```bash
curl -X POST https://n8n.ctomarketplace.com/webhook/monitoring/update \
  -H "Content-Type: application/json" \
  -d '{
    "contractAddress": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    "chain": "solana"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "contractAddress": "...",
  "monitoringResults": {
    "priceChange": 5.5,
    "volumeChange": 10.2,
    "liquidityChange": -2.1,
    "holderChange": 50,
    "riskScoreChange": 0,
    "tierChange": null,
    "alerts": []
  },
  "scannedAt": "..."
}
```

### Test 2: Check Backend Logs

After deployment, look for:
```
Starting token monitoring cron job
Monitoring {X} listings
Successfully sent listing {address} to N8N Automation Y for monitoring
Token monitoring cron job completed successfully
```

### Test 3: Verify Database Updates

Check `monitoring_snapshots` table:
```sql
SELECT * FROM monitoring_snapshots 
ORDER BY scanned_at DESC 
LIMIT 10;
```

## Workflow Flow

1. **Webhook receives** contract address
2. **Validates** contract address format
3. **Checks cache** (24-hour cooldown)
4. **Fetches current data** from:
   - Jupiter (price, metadata)
   - Raydium (liquidity, volume)
   - GMGN (holders, trading stats)
5. **Calculates risk scores** (same algorithm as Phase 1)
6. **Compares** with previous vetting results
7. **Detects changes** (price, volume, liquidity, holders)
8. **Updates database** with monitoring snapshot
9. **Returns** monitoring results

## Differences from Phase 1

| Feature | Phase 1 (Vetting) | Phase 2 (Monitoring) |
|---------|------------------|----------------------|
| **Trigger** | New token discovery | Already-vetted tokens |
| **Frequency** | On discovery | Every 5 minutes |
| **Data Source** | Backend pre-fetches | N8N fetches fresh data |
| **Purpose** | Initial risk assessment | Change detection |
| **Age Check** | Yes (>= 14 days) | No (already vetted) |
| **Cache** | None | 24-hour cooldown |

## Troubleshooting

### Issue: "N8N_AUTOMATION_Y_URL is not configured"
**Solution:** Set environment variable in backend

### Issue: No tokens being monitored
**Solution:**
- Check `handleTokenMonitoring()` cron is enabled
- Verify tokens have `riskScore IS NOT NULL`
- Check cron job logs

### Issue: Workflow not receiving requests
**Solution:**
- Verify workflow is active
- Check webhook URL matches environment variable
- Test webhook manually

### Issue: Database errors
**Solution:**
- Verify database connection in n8n
- Check table names match (n8n uses `tokens`, backend uses `listing`)
- May need to update n8n queries to use `listing` table instead

## Success Criteria

✅ Phase 2 workflow is active
✅ Backend sends monitoring requests every 5 minutes
✅ N8N processes monitoring requests successfully
✅ Database gets updated with monitoring snapshots
✅ Risk scores are re-evaluated based on new data
✅ Changes are detected and logged

## Next Steps After Phase 2

1. Monitor n8n execution logs
2. Verify monitoring snapshots in database
3. Check for alerts/notifications (if implemented)
4. Verify risk score updates reflect current market conditions

