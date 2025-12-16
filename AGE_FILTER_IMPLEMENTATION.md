# 14-Day Age Filter Implementation

## Overview

Added a **14-day minimum age requirement** for tokens before they can be vetted through n8n automation. This ensures only tokens that are at least 14 days old are processed and displayed with risk scores.

## Changes Made

### 1. **RefreshWorker - New Token Vetting**
**File:** `src/listing/workers/refresh.worker.ts`

**Location:** `triggerN8nVettingForNewToken()` method

**Change:**
- Added age check after calculating token age from creation timestamp
- Only tokens with `tokenAge >= 14 days` are sent to n8n for vetting
- Tokens < 14 days are skipped with a debug log message

**Code:**
```typescript
// Calculate token age
const creationTimestamp = heliusData?.creationTimestamp || pair?.pairCreatedAt;
const tokenAge = creationTimestamp 
  ? Math.floor((Date.now() - (creationTimestamp * 1000)) / (1000 * 60 * 60 * 24))
  : 0;

// ⚠️ AGE FILTER: Only vet tokens that are >= 14 days old (client requirement)
const MIN_TOKEN_AGE_DAYS = 14;
if (tokenAge < MIN_TOKEN_AGE_DAYS) {
  this.logger.debug(`⏳ Skipping n8n vetting for ${contractAddress}: Token age is ${tokenAge} days (minimum ${MIN_TOKEN_AGE_DAYS} days required)`);
  return;
}
```

### 2. **CronService - Token Discovery**
**File:** `src/services/cron.service.ts`

**Location:** `processNewToken()` method

**Change:**
- Added age check after fetching all token data
- Only tokens with `tokenAge >= 14 days` are sent to n8n for vetting
- Tokens < 14 days are skipped with a debug log message

**Code:**
```typescript
// Fetch all token data from various APIs
const tokenData = await this.fetchAllTokenData(contractAddress, chain);

// ⚠️ AGE FILTER: Only vet tokens that are >= 14 days old (client requirement)
const MIN_TOKEN_AGE_DAYS = 14;
if (tokenData.tokenAge < MIN_TOKEN_AGE_DAYS) {
  this.logger.debug(`⏳ Skipping n8n vetting for ${contractAddress}: Token age is ${tokenAge} days (minimum ${MIN_TOKEN_AGE_DAYS} days required)`);
  return;
}
```

## Behavior

### For New Tokens:
1. **RefreshWorker** discovers token from DexScreener
2. Token is **saved to database** with basic market data (regardless of age)
3. Token age is calculated from creation timestamp
4. **If age < 14 days**: Token is NOT sent to n8n, remains in DB with `riskScore = null` (shows as "Not Scanned")
5. **If age >= 14 days**: Token is sent to n8n for vetting, gets risk score

### For Existing Unvetted Tokens:
1. **Cron job** finds unvetted tokens (every 10 minutes)
2. Calls `triggerN8nVettingForNewToken()` for each token
3. **Age check happens inside** the method
4. **If age < 14 days**: Token is skipped, remains unvetted
5. **If age >= 14 days**: Token is vetted through n8n

### Display Behavior:
- **Tokens < 14 days**: Displayed with "Not Scanned" (no risk score)
- **Tokens >= 14 days**: Displayed with risk score after vetting completes

## Age Calculation

Token age is calculated from:
1. **Helius API**: `creationTimestamp` from token metadata
2. **DexScreener**: `pairCreatedAt` as fallback
3. **Formula**: `Math.floor((Date.now() - creationTimestamp) / (1000 * 60 * 60 * 24))` (days)

## Logging

### When Token is Too Young:
```
⏳ Skipping n8n vetting for {address}: Token age is {X} days (minimum 14 days required)
```

### When Token is Old Enough:
```
✅ Token {address} is {X} days old (>= 14 days), proceeding with n8n vetting
```

## Configuration

The minimum age is currently hardcoded as:
```typescript
const MIN_TOKEN_AGE_DAYS = 14;
```

To change this, update the constant in:
- `src/listing/workers/refresh.worker.ts` (line ~1198)
- `src/services/cron.service.ts` (line ~554)

## Testing

After deployment:
1. Check logs for age filter messages
2. Verify tokens < 14 days show "Not Scanned"
3. Verify tokens >= 14 days get vetted and show risk scores
4. Check database: `SELECT COUNT(*) FROM listing WHERE riskScore IS NULL AND age < 14` (should match unvetted young tokens)

## Example Scenarios

### Scenario 1: 5-minute-old token
- Discovered by RefreshWorker
- Saved to database with basic data
- Age calculated: ~0.003 days
- **Result**: NOT sent to n8n, shows "Not Scanned"
- **After 14 days**: Will be picked up by existing token processor and vetted

### Scenario 2: 20-day-old token
- Discovered by RefreshWorker
- Saved to database with basic data
- Age calculated: 20 days
- **Result**: Sent to n8n immediately, gets risk score
- **Display**: Shows risk score and tier

### Scenario 3: Existing 10-day-old token
- Already in database (unvetted)
- Picked up by `processExistingUnvettedTokens()` cron
- Age calculated: 10 days
- **Result**: NOT sent to n8n (too young)
- **After 4 more days**: Will be picked up again and vetted (now 14 days old)

