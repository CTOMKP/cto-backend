# Deployment Checklist - Phase 1 & Phase 2

## ✅ Phase 1 (Vetting) - COMPLETED

### Code Changes
- [x] 14-day age filter implemented
- [x] Complete data fetching (Helius, Alchemy, BearTree)
- [x] Automatic processing of existing unvetted tokens
- [x] RefreshWorker triggers n8n vetting for new tokens
- [x] Changes committed and pushed to `backend-auth-scan` branch

### Deployment Steps
1. [ ] **Deploy backend** to Coolify (will auto-deploy from GitHub)
2. [ ] **Set environment variable** in Coolify:
   ```
   N8N_AUTOMATION_X_URL=https://n8n.ctomarketplace.com/webhook/vetting/submit
   ```
3. [ ] **Verify Phase 1 workflow is active** in n8n
4. [ ] **Test Phase 1** (see PHASE_1_TESTING_GUIDE.md)

---

## 📋 Phase 2 (Monitoring) - READY TO UPLOAD

### Pre-Upload Checklist
- [ ] Phase 1 is working and processing tokens
- [ ] Backend is deployed with Phase 1 changes
- [ ] Database has vetted tokens (riskScore IS NOT NULL)

### Upload Steps

#### Step 1: Import Workflow
1. Go to https://n8n.ctomarketplace.com
2. Click **"Workflows"** → **"Add workflow"**
3. Click **"Import from File"**
4. Upload: `CTO Marketplace - Phase 2 Monitoring (Every 5 Minutes) (1).json`
5. Review workflow structure

#### Step 2: Configure Database
- [ ] Verify PostgreSQL connection is configured
- [ ] Check connection points to same database as backend
- [ ] Verify tables exist: `tokens`, `vetting_results`, `monitoring_snapshots`

#### Step 3: Configure APIFY (if needed)
- [ ] Set `APIFY_API_KEY` in n8n environment variables (if required)
- [ ] Or verify workflow uses free/public endpoints

#### Step 4: Activate Workflow
1. Click **"Activate"** button
2. Verify workflow shows as **"Active"**
3. Note webhook URL: `https://n8n.ctomarketplace.com/webhook/monitoring/update`

#### Step 5: Backend Configuration
Add environment variable in Coolify:
```
N8N_AUTOMATION_Y_URL=https://n8n.ctomarketplace.com/webhook/monitoring/update
```

#### Step 6: Verify CronService
Check that `handleTokenMonitoring()` is enabled:
- Runs every 5 minutes
- Gets listings with `riskScore IS NOT NULL`
- Calls `n8nService.triggerContinuousMonitoring()`

### Testing Phase 2

#### Test 1: Manual Webhook Test
```bash
curl -X POST https://n8n.ctomarketplace.com/webhook/monitoring/update \
  -H "Content-Type: application/json" \
  -d '{
    "contractAddress": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    "chain": "solana"
  }'
```

#### Test 2: Check Backend Logs
Look for:
```
Starting token monitoring cron job
Monitoring {X} listings
Successfully sent listing {address} to N8N Automation Y for monitoring
```

#### Test 3: Verify Database
```sql
SELECT * FROM monitoring_snapshots 
ORDER BY scanned_at DESC 
LIMIT 10;
```

---

## 🔍 Workflow Comparison

| Feature | Phase 1 (Vetting) | Phase 2 (Monitoring) |
|---------|-------------------|----------------------|
| **Webhook Path** | `/vetting/submit` | `/monitoring/update` |
| **Trigger** | New token discovery | Already-vetted tokens |
| **Frequency** | On discovery | Every 5 minutes |
| **Data Source** | Backend pre-fetches | N8N fetches fresh |
| **Age Check** | Yes (>= 14 days) | No (already vetted) |
| **Cache** | None | 24-hour cooldown |
| **Purpose** | Initial risk assessment | Change detection |

---

## 📊 Expected Behavior

### Phase 1 (Vetting)
- New tokens >= 14 days → Vetted immediately
- New tokens < 14 days → Saved but not vetted
- Existing unvetted tokens → Processed gradually (10 every 10 min)

### Phase 2 (Monitoring)
- Vetted tokens → Monitored every 5 minutes
- Fresh data fetched from APIs
- Risk scores re-evaluated
- Changes detected and logged
- Database updated with snapshots

---

## 🚨 Common Issues

### Phase 1 Issues
- **"N8N_AUTOMATION_X_URL not configured"** → Set env var
- **"Token too young"** → Expected for tokens < 14 days
- **No executions** → Check workflow is active

### Phase 2 Issues
- **"N8N_AUTOMATION_Y_URL not configured"** → Set env var
- **No tokens monitored** → Check tokens have riskScore
- **Database errors** → Verify table names match

---

## ✅ Success Criteria

### Phase 1
- [x] Code committed and pushed
- [ ] Backend deployed
- [ ] Workflow active
- [ ] Tokens >= 14 days being vetted
- [ ] Tokens < 14 days showing "Not Scanned"
- [ ] Database getting updated

### Phase 2
- [ ] Workflow uploaded and active
- [ ] Backend env var set
- [ ] Monitoring cron job running
- [ ] Tokens being monitored every 5 minutes
- [ ] Database getting monitoring snapshots
- [ ] Risk scores being re-evaluated

---

## 📝 Next Steps

1. **Deploy Phase 1** → Wait for Coolify to deploy from GitHub
2. **Test Phase 1** → Follow PHASE_1_TESTING_GUIDE.md
3. **Upload Phase 2** → Follow steps above
4. **Test Phase 2** → Follow PHASE_2_SETUP_GUIDE.md
5. **Monitor both** → Check logs and database regularly

