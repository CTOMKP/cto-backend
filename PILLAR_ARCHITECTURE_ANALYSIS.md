# Pillar 1 & Pillar 2 Architecture Analysis

## Current Implementation Overview

### PILLAR 1 (RefreshWorker) - Token Discovery & Initial Vetting

**Location**: `src/listing/workers/refresh.worker.ts`

**On Startup (`onModuleInit`)**:
- Calls `ensurePinnedTokensExist()` - Ensures 18 pinned tokens are in DB
- This fetches data from DexScreener, gets holder data via AnalyticsService, calculates risk score, saves to DB

**Scheduled Cron Jobs**:
1. `scheduledFetchFeed()` - Every 5 minutes (`@Cron('0 */5 * * * *')`)
   - Calls `ensurePinnedTokensExist()` first
   - Fetches feeds from DexScreener, Birdeye, Helius, Moralis, Solscan
   - Merges feeds and upserts tokens (14+ days old filter)
   - This is TOKEN DISCOVERY (new tokens)

2. `scheduledRefreshAll()` - Every 5 minutes (`@Cron('0 */5 * * * *')`)
   - Gets ALL tokens from DB
   - Enqueues them for enrichment (calls `enqueue()`)
   - `enqueue()` triggers `run()` which calls `triggerN8nVettingForNewToken()`
   - This RE-VETTS existing tokens

3. `dailyRotation()` - Every midnight (`@Cron('0 0 * * *')`)
   - Deletes all non-pinned tokens
   - Calls `ensurePinnedTokensExist()`
   - Calls `scheduledFetchFeed()` 3 times

4. `processExistingUnvettedTokens()` - Every 30 minutes (`@Cron('0 */30 * * * *')`)
   - Gets tokens without riskScore
   - Vets them

**What Pillar 1 Does**:
- Discovers new tokens from feeds
- Ensures pinned tokens exist
- Vets tokens (calculates risk score) using Pillar1RiskScoringService
- Saves ALL data including holders to DB

---

### PILLAR 2 (CronService) - Token Monitoring

**Location**: `src/services/cron.service.ts`

**On Startup (`onModuleInit`)**:
- Calls `recalculateRiskScoresForExistingTokens(10, 0)` - Processes ALL tokens with `lastScannedAt`
- This calls `recalculateRiskScoreForToken()` for each token
- `recalculateRiskScoreForToken()` calls `fetchAllTokenData()` which calls `fetchCombinedTokenData()`
- `fetchCombinedTokenData()` was calling Birdeye (NOW REMOVED)
- Also calls `analyticsService.getHolderCount()` for holder data

**Scheduled Cron Jobs**:
1. `handleTokenDiscovery()` - Every 20 minutes (`@Cron('0 */20 * * * *')`)
   - Discovers new tokens (similar to RefreshWorker's scheduledFetchFeed)
   - This seems redundant with RefreshWorker

2. `handleTokenMonitoring()` - Every 30 minutes (`@Cron('0 */30 * * * *')`)
   - Gets tokens with riskScore that need monitoring
   - Calls `processListingMonitoring()` which uses `Pillar2MonitoringService.monitorListing()`
   - This is the ACTUAL Pillar 2 monitoring

**What Pillar 2 Does**:
- Monitors existing tokens (tokens already vetted/scanned)
- Re-evaluates metrics that change over time
- Recalculates risk scores
- Updates holder data

---

## THE PROBLEM

### On Startup:
1. **RefreshWorker.onModuleInit** runs → `ensurePinnedTokensExist()` → Processes 18 pinned tokens
2. **CronService.onModuleInit** runs → `recalculateRiskScoresForExistingTokens()` → Processes ALL tokens including pinned ones

**Result**: Pinned tokens processed TWICE simultaneously!

### Why Rate Limiting?
Even with 2-second delays between tokens in `ensurePinnedTokensExist()`:
- RefreshWorker processes 18 pinned tokens (with 2s delay = 36 seconds)
- CronService processes ALL tokens including the same 18 pinned tokens (in parallel)
- Both call Birdeye API simultaneously
- Birdeye free tier = 60 requests/minute = 1 req/sec
- 2 services hitting it = rate limit exceeded (429 errors)

---

## THE FIX NEEDED

CronService's `recalculateRiskScoresForExistingTokens()` should:
1. **Skip pinned tokens** (they're handled by RefreshWorker)
2. **OR** not run on startup if tokens are already being processed

Current fix: Exclude pinned tokens from CronService's recalculation query.

