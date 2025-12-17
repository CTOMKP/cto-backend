# Verify Database Save - N8N Workflow

## ✅ Workflow Execution Status

**Great news!** The n8n workflow executed successfully:
- ✅ Webhook received data
- ✅ Token age check passed (365 days >= 14)
- ✅ Risk scores calculated (100/100 - stellar tier)
- ✅ "Insert All Data" node succeeded (60ms)
- ✅ Holders data inserted

## ⚠️ Potential Issue: Table Name Mismatch

The n8n workflow may be using different table names than your backend:

**N8N Workflow uses:**
- `tokens` table
- `vetting_results` table
- `launch_analysis` table
- `holders` table

**Backend uses:**
- `listing` table (not `tokens`)

## Verify Database Save

### Step 1: Check if Data Was Saved

Run these SQL queries to check if the data was saved:

```sql
-- Check if token was saved (using 'tokens' table - n8n workflow)
SELECT * FROM tokens 
WHERE contract_address = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

-- Check if token was saved (using 'listing' table - backend)
SELECT * FROM listing 
WHERE "contractAddress" = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

-- Check vetting results
SELECT * FROM vetting_results 
WHERE token_id IN (
  SELECT id FROM tokens WHERE contract_address = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
);

-- Check launch analysis
SELECT * FROM launch_analysis 
WHERE token_id IN (
  SELECT id FROM tokens WHERE contract_address = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
);

-- Check holders
SELECT * FROM holders 
WHERE token_id IN (
  SELECT id FROM tokens WHERE contract_address = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
);
```

### Step 2: Check All Tables

List all tables to see what exists:

```sql
-- List all tables in the database
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;
```

### Step 3: Check Recent Inserts

Check for recent inserts in both table naming conventions:

```sql
-- Recent tokens (n8n workflow table)
SELECT contract_address, name, symbol, created_at, last_scanned
FROM tokens
ORDER BY created_at DESC
LIMIT 10;

-- Recent listings (backend table)
SELECT "contractAddress", name, symbol, "createdAt", "lastScannedAt"
FROM listing
ORDER BY "createdAt" DESC
LIMIT 10;
```

## Possible Scenarios

### Scenario 1: Data Saved to `tokens` Table
- ✅ N8N workflow saved data successfully
- ⚠️ Backend uses `listing` table (different table)
- **Solution:** Either:
  - Update n8n workflow to use `listing` table, OR
  - Create a sync mechanism between `tokens` and `listing` tables

### Scenario 2: Data Saved to `listing` Table
- ✅ N8N workflow saved data successfully
- ✅ Backend can read it
- **Status:** Everything working!

### Scenario 3: Data Not Saved
- ❌ Database connection issue in n8n
- ❌ Table doesn't exist
- ❌ Permission issue
- **Solution:** Check n8n database connection and table existence

## Check N8N Database Connection

1. Go to n8n workflow: https://n8n.ctomarketplace.com/workflow/7mxdHJ9jk10P4cuy
2. Click on any database node (PostgreSQL)
3. Check the connection credentials
4. Verify it points to the same database as your backend

## Next Steps

1. **Run the SQL queries above** to check if data was saved
2. **Check which tables exist** in your database
3. **Verify table names match** between n8n workflow and backend
4. **If mismatch found:** Update n8n workflow to use `listing` table instead of `tokens`

## Quick Test Query

Run this to see all recent database activity:

```sql
-- Check all recent activity
SELECT 
  'tokens' as table_name,
  contract_address,
  name,
  created_at
FROM tokens
WHERE created_at > NOW() - INTERVAL '1 hour'
UNION ALL
SELECT 
  'listing' as table_name,
  "contractAddress",
  name,
  "createdAt"
FROM listing
WHERE "createdAt" > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

