# New Infrastructure: Manual Token Addition + Pillar 1 & Pillar 2

## Overview

**You now manually add tokens to the database**, and the system processes them through two pillars:

## How Tokens Are Added

### Manual Addition Process
1. **You add tokens to the database** (via API endpoint, database insert, or other method)
2. Tokens are inserted with `vetted = false` (default)
3. The system detects unvetted tokens and processes them

### Current Token Sources
- **Pinned tokens** (18 tokens) - Auto-ensured via `ensurePinnedTokensExist()`
- **Manual additions** - Tokens you add via API/database
- **Feed discovery** (optional) - `scheduledFetchFeed` still runs but you can disable it

## Pillar 1: Initial Vetting (RefreshWorker)

### Purpose
- Processes tokens that **haven't been vetted yet** (`vetted = false OR riskScore IS NULL`)
- Fetches data/metrics from APIs (Birdeye, Helius, DexScreener, etc.)
- Calculates risk score using Pillar1RiskScoringService
- Sets `vetted = true` after completion

### When It Runs
- **`processExistingUnvettedTokens()`**: Every 10 minutes at :05, :15, :25, :35, :45, :55
  - Queries DB for tokens where `vetted = false OR riskScore IS NULL`
  - Processes them through vetting pipeline
  - Sets `vetted = true` after vetting completes

### What It Does
1. Finds unvetted tokens in database
2. Fetches comprehensive data from APIs:
   - Token metadata (name, symbol, decimals)
   - Market data (price, volume, liquidity)
   - Holder data (count, top holders)
   - Security data (mint authority, freeze authority)
   - Developer data (creator address, balance)
3. Calculates risk score
4. Updates database with risk score, tier, and sets `vetted = true`

## Pillar 2: Ongoing Monitoring (CronService)

### Purpose
- Monitors tokens that **have already been vetted** (`vetted = true`)
- Re-fetches changing metrics (price, volume, holders, etc.)
- Recalculates risk scores and tiers based on new data

### When It Runs
- **`handleTokenMonitoring()`**: Every 30 minutes at :00 and :30
  - Queries DB for tokens where `vetted = true`
  - Re-processes them to update metrics

### What It Does
1. Finds vetted tokens in database
2. Re-fetches changing metrics from APIs
3. Recalculates risk scores with updated data
4. Updates database with new risk scores, tiers, and metrics

## Key Differences from Old System

| Old System | New System |
|------------|------------|
| Fetched tokens from feeds automatically | **You manually add tokens to DB** |
| Re-vetted all tokens periodically | Pillar 1 only processes unvetted tokens once |
| Multiple overlapping processes | Clear separation: Pillar 1 → Pillar 2 |
| Duplicate API calls | No duplicates, each token processed once by each pillar |

## Workflow Example

### Adding a New Token

1. **You add token to database** (manual)
   ```sql
   INSERT INTO "Listing" (contractAddress, chain, symbol, name, vetted)
   VALUES ('token_address_here', 'SOLANA', 'TOKEN', 'Token Name', false);
   ```

2. **Pillar 1 picks it up** (within 10 minutes)
   - `processExistingUnvettedTokens()` finds it
   - Fetches data from APIs
   - Calculates risk score
   - Sets `vetted = true`

3. **Pillar 2 monitors it** (every 30 minutes)
   - `handleTokenMonitoring()` finds it (because `vetted = true`)
   - Updates metrics and risk scores

### Adding Multiple Tokens

1. **You add multiple tokens** (all with `vetted = false`)
2. **Pillar 1 processes them** (batches of 20, every 10 minutes)
3. Once processed, they're marked `vetted = true`
4. **Pillar 2 monitors all vetted tokens** continuously

## Optional: Feed Discovery

The `scheduledFetchFeed()` function still runs, but you can:
- **Disable it** by setting an environment variable or removing the cron
- **Keep it enabled** if you want automatic discovery in addition to manual addition

Currently it runs every 10 minutes at :00, :10, :20, :30, :40, :50, but you can disable it if you only want manual additions.

## Configuration

### To Disable Feed Discovery (Manual Only Mode)
You can remove or comment out the `@Cron('0 */10 * * * *')` decorator on `scheduledFetchFeed()` if you want purely manual token addition.

### Current Schedule Summary

- **Pillar 1 Discovery** (optional): :00, :10, :20, :30, :40, :50 (every 10 min)
- **Pillar 1 Vetting**: :05, :15, :25, :35, :45, :55 (every 10 min, offset by 5 min)
- **Pillar 2 Monitoring**: :00, :30 (every 30 min)

## Questions for You

1. **Do you want to keep `scheduledFetchFeed()` enabled**, or disable it for pure manual addition?
2. **How do you currently add tokens manually?** (API endpoint, direct DB insert, etc.)
3. **Should we create/modify an API endpoint** to make manual token addition easier?

