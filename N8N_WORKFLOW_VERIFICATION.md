# N8N Workflow Verification Checklist

## Workflow Details
- **Workflow ID**: `7mxdHJ9jk10P4cuy`
- **URL**: https://n8n.ctomarketplace.com/workflow/7mxdHJ9jk10P4cuy
- **Webhook Path**: `/vetting/submit`
- **Full Webhook URL**: `https://n8n.ctomarketplace.com/webhook/vetting/submit`

## ✅ Verification Checklist

### 1. **Webhook Configuration**
- [x] Webhook path: `/vetting/submit` ✅
- [ ] **ACTION REQUIRED**: Set `N8N_AUTOMATION_X_URL` environment variable in backend:
  ```
  N8N_AUTOMATION_X_URL=https://n8n.ctomarketplace.com/webhook/vetting/submit
  ```

### 2. **Workflow Status**
- [ ] **ACTION REQUIRED**: Ensure workflow is **ACTIVE** in n8n dashboard
- [ ] Test webhook manually to verify it's accessible

### 3. **Age Check (Double Protection)**
✅ **Both Backend AND N8N check age >= 14 days:**
- **Backend**: Filters tokens < 14 days before sending to n8n (saves API calls)
- **N8N**: Also checks age >= 14 days (safety net)
- **Result**: Tokens < 14 days are rejected at both levels

### 4. **Request Payload Format**
✅ **Backend sends:**
```json
{
  "contractAddress": "...",
  "chain": "solana",
  "tokenInfo": { ... },
  "security": { ... },
  "holders": { ... },
  "developer": { ... },
  "trading": { ... },
  "tokenAge": 20,
  "topTraders": []
}
```

✅ **N8N expects:** (from "Validate Input" node)
- `contractAddress` ✅
- `chain` ✅
- `tokenInfo` ✅
- `security` ✅
- `holders` ✅
- `developer` ✅
- `trading` ✅
- `tokenAge` ✅

**Status**: ✅ **MATCHES**

### 5. **Response Format**
✅ **N8N returns:** (from "Code in JavaScript" node)
```json
{
  "success": true,
  "contractAddress": "...",
  "tokenInfo": { ... },
  "holders": { ... },
  "vettingResults": {
    "componentScores": { ... },
    "overallScore": 75,
    "riskLevel": "low",
    "eligibleTier": "sprout",
    ...
  },
  "scannedAt": "..."
}
```

✅ **Backend expects:**
- `response.data.tokenInfo` ✅
- `response.data.vettingResults` ✅
- `response.data.scannedAt` ✅

**Status**: ✅ **MATCHES**

### 6. **Error Handling**
✅ **N8N returns for tokens < 14 days:**
```json
{
  "error": "Token too young for vetting",
  "code": "TOKEN_TOO_NEW",
  "tokenAge": 5,
  "minimumAge": 14
}
```

⚠️ **Backend handling**: Backend checks `result.success` - if false, logs error
- Need to verify backend handles the error response correctly

### 7. **Database Integration**
✅ **N8N workflow saves to:**
- `tokens` table
- `vetting_results` table
- `lp_data` table
- `launch_analysis` table
- `holders` table

**Note**: N8N saves directly to database, so backend doesn't need to save vetting results separately.

## 🔧 Configuration Steps

### Step 1: Set Environment Variable
In your backend environment (Coolify/Railway), add:
```
N8N_AUTOMATION_X_URL=https://n8n.ctomarketplace.com/webhook/vetting/submit
```

### Step 2: Activate Workflow
1. Go to https://n8n.ctomarketplace.com/workflow/7mxdHJ9jk10P4cuy
2. Click "Activate" button (top right)
3. Verify workflow shows as "Active"

### Step 3: Test Webhook
Test the webhook manually:
```bash
curl -X POST https://n8n.ctomarketplace.com/webhook/vetting/submit \
  -H "Content-Type: application/json" \
  -d '{
    "contractAddress": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    "chain": "solana",
    "tokenInfo": { "name": "Test", "symbol": "TEST" },
    "security": {},
    "holders": { "count": 0, "topHolders": [] },
    "developer": {},
    "trading": {},
    "tokenAge": 20
  }'
```

Expected response: JSON with `vettingResults` object

## 🚨 Potential Issues

### Issue 1: Database Schema Mismatch
**Problem**: N8N workflow uses tables (`tokens`, `vetting_results`, etc.) that might not match your Prisma schema

**Solution**: 
- Verify N8N database connection points to the same database as backend
- Check if table names match (N8N uses `tokens`, backend uses `listing`)

### Issue 2: Response Format Mismatch
**Problem**: Backend expects `response.data.vettingResults`, but N8N might return it differently

**Solution**: 
- Check n8n execution logs to see actual response format
- Update backend parsing if needed

### Issue 3: Age Check Conflict
**Problem**: Both backend and n8n check age - might cause confusion

**Solution**: 
- This is actually good (double protection)
- Backend check saves unnecessary API calls
- N8N check is safety net

## 📊 Testing Checklist

After configuration:
1. [ ] Verify `N8N_AUTOMATION_X_URL` is set correctly
2. [ ] Verify workflow is active
3. [ ] Test webhook manually (see Step 3 above)
4. [ ] Check backend logs for n8n calls
5. [ ] Check n8n execution logs
6. [ ] Verify tokens >= 14 days get vetted
7. [ ] Verify tokens < 14 days are rejected
8. [ ] Check database for vetting results

## 🎯 Next Steps

1. **Set environment variable** in backend
2. **Activate workflow** in n8n
3. **Test with a real token** (>= 14 days old)
4. **Monitor logs** for any errors
5. **Verify database** gets updated correctly

