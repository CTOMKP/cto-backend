# Migration Instructions for Coolify Database

## Step 1: Generate Prisma Migration

Run this locally (or in your development environment) to create the migration file:

```bash
cd cto-backend-old-fresh
npx prisma migrate dev --name add_vetted_field
```

This will:
1. Create a migration file in `prisma/migrations/`
2. Update your local Prisma client

## Step 2: Apply Migration on Coolify

You have a few options:

### Option A: Through Coolify (Recommended)
1. Push your code changes (including the migration file) to your repository
2. Coolify should automatically run migrations during deployment
3. If not, you may need to configure Coolify to run `npx prisma migrate deploy` as part of the deployment

### Option B: Manual SQL on Coolify Database
If you need to run it manually on Coolify:

1. Connect to your Coolify database (via Coolify's database console or SSH)
2. Run this SQL:

```sql
-- Add vetted column to Listing table
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "vetted" BOOLEAN NOT NULL DEFAULT false;

-- Update existing tokens: if they have a riskScore, they've been vetted
UPDATE "Listing" SET "vetted" = true WHERE "riskScore" IS NOT NULL;
```

### Option C: Generate Migration SQL Only
If you want to see the SQL first:

```bash
cd cto-backend-old-fresh
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script > migration.sql
```

Then run the SQL on your Coolify database.

## Step 3: Verify Migration

After applying the migration, verify it worked:

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

## Important Notes

- The `vetted` field defaults to `false` for new tokens
- Existing tokens with `riskScore IS NOT NULL` should be set to `vetted = true`
- After migration, new tokens will automatically have `vetted = false`
- Pillar 1 will process unvetted tokens and set `vetted = true` after vetting
- Pillar 2 will only process tokens where `vetted = true`

