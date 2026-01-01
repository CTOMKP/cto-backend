# Coolify Database Migration Steps

Since your database is on Coolify, here's how to apply the `vetted` field migration:

## ⚠️ IMPORTANT: If Migration Failed

If you see this error:
```
Error: P3009
migrate found failed migrations in the target database
The `20250101_add_vetted_field` migration started at ... failed
```

**The column already exists, but Prisma marked the migration as failed. You need to resolve it:**

### Step 1: Connect to Database

In Coolify, go to your PostgreSQL resource → **Database Console** or use psql:

```bash
psql -h <your-db-host> -U postgres -d postgres
```

### Step 2: Resolve Failed Migration

Run this SQL to mark the migration as applied:

```sql
-- Mark the failed migration as applied (since column already exists)
UPDATE "_prisma_migrations"
SET 
  "finished_at" = NOW(),
  "applied_steps_count" = 1,
  "logs" = NULL
WHERE "migration_name" = '20250101_add_vetted_field'
AND "finished_at" IS NULL;

-- Verify it worked
SELECT "migration_name", "finished_at", "applied_steps_count"
FROM "_prisma_migrations"
WHERE "migration_name" = '20250101_add_vetted_field';
```

### Step 3: Verify Column Exists

```sql
-- Check that the column exists
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'Listing' AND column_name = 'vetted';
```

After this, redeploy the backend. The migration will be marked as applied and Prisma will continue with future migrations.

---

## Quick SQL to Run on Coolify (If Column Doesn't Exist)

**Only run this if the column doesn't exist yet:**

```sql
-- Add vetted column to Listing table (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'Listing' 
        AND column_name = 'vetted'
    ) THEN
        ALTER TABLE "Listing" ADD COLUMN "vetted" BOOLEAN NOT NULL DEFAULT false;
    END IF;
END $$;

-- Update existing tokens: if they have a riskScore, they've been vetted
UPDATE "Listing" SET "vetted" = true WHERE "riskScore" IS NOT NULL AND "vetted" = false;
```

## How to Access Coolify Database

### Option 1: Coolify Database Console
1. Go to your Coolify dashboard
2. Navigate to your database service
3. Click on "Database Console" or "Query" tab
4. Paste and run the SQL above

### Option 2: Via Coolify CLI/SSH
If you have SSH access to your Coolify instance, you can connect directly:
```bash
psql -h <your-db-host> -U <username> -d <database-name>
```

### Option 3: Through Backend Deployment
If your backend deployment has database access configured, you could also:
1. Push code changes
2. Connect to the backend container in Coolify
3. Run: `npx prisma migrate deploy`

## Verification

After running the migration, verify it worked:

```sql
-- Check that the column exists
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'Listing' AND column_name = 'vetted';

-- Check vetted status distribution
SELECT vetted, COUNT(*) 
FROM "Listing" 
GROUP BY vetted;
```

You should see:
- All existing tokens with `riskScore` should have `vetted = true`
- New tokens will have `vetted = false` by default

## What This Migration Does

1. **Adds `vetted` column**: Boolean field that tracks if a token has undergone Pillar 1 (risk scoring)
2. **Sets defaults**: New tokens default to `vetted = false`
3. **Updates existing tokens**: Tokens that already have a `riskScore` are marked as `vetted = true`

## After Migration

Once the migration is applied:
- ✅ New tokens will have `vetted = false`
- ✅ Pillar 1 will process unvetted tokens and set `vetted = true` after vetting
- ✅ Pillar 2 will only process tokens where `vetted = true`
- ✅ No duplicate processing of the same token

