# ⚠️ Table Name Mismatch Issue

## Problem Identified

**N8N Workflow** uses: `tokens` table  
**Backend** uses: `listing` table

This means:
- ✅ N8N workflow is saving data successfully to `tokens` table
- ❌ Backend cannot read this data because it looks in `listing` table
- ❌ Data is saved but not accessible to your backend/frontend

## Evidence

From the n8n workflow JSON:
```sql
INSERT INTO tokens (contract_address, chain, name, symbol, ...)
```

From backend code:
```typescript
// Backend uses 'listing' table
await this.prisma.listing.findMany({...})
```

## Solutions

### Option 1: Update N8N Workflow to Use `listing` Table (Recommended)

**Update the n8n workflow SQL queries:**

1. Go to n8n workflow: https://n8n.ctomarketplace.com/workflow/7mxdHJ9jk10P4cuy
2. Find the "Insert Token Data" node
3. Change the SQL query from:
   ```sql
   INSERT INTO tokens (contract_address, ...)
   ```
   To:
   ```sql
   INSERT INTO listing ("contractAddress", chain, name, symbol, ...)
   ```

4. Update "Insert Vetting Results" node to reference `listing` instead of `tokens`:
   ```sql
   FROM listing t WHERE t."contractAddress" = '...'
   ```

5. Update all other nodes that reference `tokens` table

**Note:** You'll need to map column names:
- `tokens.contract_address` → `listing."contractAddress"`
- `tokens.token_age_days` → `listing.age` (or similar)
- etc.

### Option 2: Create a View or Sync Mechanism

Create a database view or trigger to sync data between tables:

```sql
-- Option A: Create a view
CREATE VIEW tokens AS 
SELECT 
    "contractAddress" as contract_address,
    chain,
    name,
    symbol,
    ...
FROM listing;

-- Option B: Create a sync trigger
CREATE OR REPLACE FUNCTION sync_tokens_to_listing()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO listing ("contractAddress", chain, name, symbol, ...)
    VALUES (NEW.contract_address, NEW.chain, NEW.name, NEW.symbol, ...)
    ON CONFLICT ("contractAddress") DO UPDATE SET ...;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_tokens_trigger
AFTER INSERT OR UPDATE ON tokens
FOR EACH ROW
EXECUTE FUNCTION sync_tokens_to_listing();
```

### Option 3: Update Backend to Read from `tokens` Table

**Not recommended** - would require significant backend changes.

## Quick Fix: Verify Data Was Saved

Run these queries to check if data was saved:

```sql
-- Check tokens table (n8n workflow)
SELECT * FROM tokens 
WHERE contract_address = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

-- Check listing table (backend)
SELECT * FROM listing 
WHERE "contractAddress" = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
```

## Recommended Action

**Update the n8n workflow** to use the `listing` table so:
1. Data is saved where backend expects it
2. Frontend can display vetted tokens immediately
3. No sync mechanism needed

## Next Steps

1. **Verify data was saved** (run SQL queries above)
2. **Decide on solution** (Option 1 recommended)
3. **Update n8n workflow** if using Option 1
4. **Test again** to ensure data appears in backend

