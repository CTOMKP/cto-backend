# Coolify Database Migration Steps

Since your database is on Coolify, here's how to apply the `vetted` field migration:

## Quick SQL to Run on Coolify

Connect to your Coolify PostgreSQL database and run:

```sql
-- Add vetted column to Listing table
ALTER TABLE "Listing" ADD COLUMN "vetted" BOOLEAN NOT NULL DEFAULT false;

-- Update existing tokens: if they have a riskScore, they've been vetted
UPDATE "Listing" SET "vetted" = true WHERE "riskScore" IS NOT NULL;
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

