# 🚨 FIX MIGRATION - DO THIS FIRST

## The Problem
Prisma sees a failed migration and won't deploy. But the `vetted` column already exists in your database.

## The Fix (Do This NOW)

### Step 1: Connect to Your Database

In Coolify:
1. Go to your **PostgreSQL** resource
2. Click **"Database Console"** or **"Query"** tab
3. Or use the terminal/psql if you have access

### Step 2: Run This SQL Command

Copy and paste this into the database console:

```sql
UPDATE "_prisma_migrations"
SET 
  "finished_at" = NOW(),
  "applied_steps_count" = 1,
  "logs" = NULL
WHERE "migration_name" = '20250101_add_vetted_field'
AND "finished_at" IS NULL;
```

This tells Prisma: "This migration is done, don't worry about it."

### Step 3: Verify It Worked

Run this to check:

```sql
SELECT "migration_name", "finished_at", "applied_steps_count"
FROM "_prisma_migrations"
WHERE "migration_name" = '20250101_add_vetted_field';
```

You should see `finished_at` is now set (not NULL).

---

## Step 4: NOW Redeploy

After fixing the database:
1. Go back to your backend deployment in Coolify
2. Click **"Redeploy"** or wait for auto-deploy
3. The deployment should now succeed! ✅

---

## Why This Works

- The `vetted` column already exists (you added it manually)
- Prisma just needs to know the migration is "done"
- Once marked as applied, Prisma will continue normally

