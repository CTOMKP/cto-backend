# Pillar 1 & Pillar 2 Architecture Refactor Summary

## Changes Implemented

### 1. Database Schema Update
- **Added `vetted` boolean field** to `Listing` model with `@default(false)`
  - Tracks if token has undergone Pillar 1 (risk scoring)
  - New tokens default to `vetted = false`
  - Set to `true` after Pillar 1 completes (via `saveVettingResults`)

### 2. Pillar 1 (RefreshWorker) - Token Discovery & Initial Vetting

**Changes:**
- ✅ **`processExistingUnvettedTokens`**: Now queries for tokens where `vetted = false OR riskScore IS NULL`
  - Runs every 10 minutes at :05, :15, :25, :35, :45, :55 (offset from discovery)
  - Only processes tokens that haven't undergone Pillar 1
  
- ✅ **`scheduledFetchFeed`**: Token discovery from feeds
  - Runs every 10 minutes at :00, :10, :20, :30, :40, :50
  - Only triggers vetting for unvetted tokens (checks `vetted = false OR riskScore IS NULL`)
  
- ✅ **`ensurePinnedTokensExist`**: Only triggers vetting for unvetted pinned tokens

- ✅ **`upsertFromMerged`**: Only triggers vetting for new/existing tokens if `vetted = false OR riskScore IS NULL`

- ✅ **REMOVED `scheduledRefreshAll`**: This was re-vetting ALL tokens, which is Pillar 2's job

- ✅ **`saveVettingResults`**: Sets `vetted = true` after vetting completes

### 3. Pillar 2 (CronService) - Token Monitoring

**Changes:**
- ✅ **REMOVED `onModuleInit` startup recalculation**: This was causing duplicate processing with Pillar 1
  
- ✅ **REMOVED `handleTokenDiscovery`**: Redundant with RefreshWorker.scheduledFetchFeed

- ✅ **`handleTokenMonitoring`**: 
  - Now only processes tokens where `vetted = true` (Pillar 1 completed)
  - Runs every 30 minutes at :00 and :30 (offset from Pillar 1)
  - Monitors all vetted tokens (re-fetches changing metrics, recalculates risk scores)

- ✅ **`getListingsForMonitoring`**: Updated query to only fetch tokens where `vetted = true`

### 4. Repository Updates

**Changes:**
- ✅ **`upsertMarketMetadata`**: Preserves `vetted` field when updating market metadata
  - New tokens: `vetted = false` (default)
  - Existing tokens: preserves current `vetted` status

- ✅ **`saveVettingResults`**: Sets `vetted = true` after vetting completes

## Architecture Flow

### Pillar 1 (Discovery & Initial Vetting)
1. **Token Discovery** (`scheduledFetchFeed`): Every 10 min at :00, :10, :20, :30, :40, :50
   - Fetches tokens from DexScreener, Birdeye, Helius, Moralis, Solscan
   - Upserts tokens to DB with `vetted = false` (default)
   
2. **Vetting** (`processExistingUnvettedTokens`): Every 10 min at :05, :15, :25, :35, :45, :55
   - Processes tokens where `vetted = false OR riskScore IS NULL`
   - Fetches data/metrics from APIs
   - Calculates risk score
   - Updates DB with risk score and sets `vetted = true`

### Pillar 2 (Monitoring)
1. **Token Monitoring** (`handleTokenMonitoring`): Every 30 min at :00 and :30
   - Processes tokens where `vetted = true`
   - Re-fetches changing metrics (price, volume, holders, etc.)
   - Recalculates risk scores and tiers
   - Updates DB with new data

## Key Benefits

1. **No Duplicate Processing**: Tokens are only processed by Pillar 1 once
2. **Clear Separation**: Pillar 1 = initial vetting, Pillar 2 = ongoing monitoring
3. **No Simultaneous Execution**: Pillar 1 and Pillar 2 run at different times (5-min offset)
4. **Reduced API Calls**: Unnecessary duplicate API calls eliminated
5. **Rate Limit Friendly**: Processes don't run simultaneously, reducing API rate limit issues

## Migration Required

**Since your database is on Coolify, see `COOLIFY_MIGRATION_STEPS.md` for instructions.**

The SQL to run on Coolify:

```sql
-- Add vetted column to Listing table
ALTER TABLE "Listing" ADD COLUMN "vetted" BOOLEAN NOT NULL DEFAULT false;

-- Update existing tokens: if they have a riskScore, they've been vetted
UPDATE "Listing" SET "vetted" = true WHERE "riskScore" IS NOT NULL;
```

## Testing Checklist

- [ ] New tokens added to DB have `vetted = false`
- [ ] After Pillar 1 completes, `vetted = true`
- [ ] Pillar 1 only processes unvetted tokens
- [ ] Pillar 2 only processes vetted tokens
- [ ] No duplicate processing of same token
- [ ] Scheduling doesn't overlap (Pillar 1 at :05/:15/:25/:35/:45/:55, Pillar 2 at :00/:30)
