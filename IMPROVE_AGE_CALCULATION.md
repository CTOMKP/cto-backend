# Improve Token Age Calculation

## Problem

Token age defaults to 0 when creation timestamp is not available, causing all tokens to be skipped.

## Current Code (refresh.worker.ts line 1196-1199)

```typescript
const creationTimestamp = heliusData?.creationTimestamp || pair?.pairCreatedAt;
const tokenAge = creationTimestamp 
  ? Math.floor((Date.now() - (creationTimestamp * 1000)) / (1000 * 60 * 60 * 24))
  : 0;  // ⚠️ Defaults to 0 if no timestamp
```

## Improved Solution

Replace the age calculation with this improved version:

```typescript
// Try multiple sources for creation timestamp
const creationTimestamp = 
  heliusData?.creationTimestamp ||           // Helius RPC (primary)
  pair?.pairCreatedAt ||                     // DexScreener pair creation
  combinedData?.gmgn?.open_timestamp ||      // GMGN open timestamp
  combinedData?.gmgn?.creation_timestamp ||  // GMGN creation timestamp
  null;

let tokenAge = 0;

if (creationTimestamp) {
  // Calculate age from timestamp
  tokenAge = Math.floor((Date.now() - (creationTimestamp * 1000)) / (1000 * 60 * 60 * 24));
  this.logger.debug(`📅 Token ${contractAddress} age calculated from timestamp: ${tokenAge} days`);
} else {
  // Fallback: Estimate age based on activity
  // If token has significant trading activity, it's likely at least a few days old
  const hasSignificantVolume = (trading?.volume24h || 0) > 50000;
  const hasManyHolders = (holders?.count || 0) > 500;
  const hasEstablishedLiquidity = (trading?.liquidity || 0) > 100000;
  
  if (hasSignificantVolume || hasManyHolders || hasEstablishedLiquidity) {
    // Conservative estimate: assume minimum 7 days old for tokens with significant activity
    tokenAge = 7;
    this.logger.debug(`⚠️ No timestamp for ${contractAddress}, estimating minimum age: 7 days (based on activity)`);
  } else {
    // Very new token with no activity - likely < 1 day
    tokenAge = 0;
    this.logger.debug(`⚠️ No timestamp for ${contractAddress}, no significant activity - age: 0 days`);
  }
}

// Log age calculation for debugging
this.logger.debug(`🔍 Age calculation for ${contractAddress}:`);
this.logger.debug(`  - heliusData?.creationTimestamp: ${heliusData?.creationTimestamp || 'null'}`);
this.logger.debug(`  - pair?.pairCreatedAt: ${pair?.pairCreatedAt || 'null'}`);
this.logger.debug(`  - combinedData?.gmgn?.open_timestamp: ${combinedData?.gmgn?.open_timestamp || 'null'}`);
this.logger.debug(`  - Final tokenAge: ${tokenAge} days`);
```

## Alternative: Use Database Created Date

If tokens are already in the database, you can use the database `createdAt` as a fallback:

```typescript
// Try to get age from existing listing in database
let tokenAge = 0;
const existingListing = await this.repo.findOne(contractAddress);

if (creationTimestamp) {
  tokenAge = Math.floor((Date.now() - (creationTimestamp * 1000)) / (1000 * 60 * 60 * 24));
} else if (existingListing?.createdAt) {
  // Use database creation date as fallback
  const dbAge = Math.floor((Date.now() - new Date(existingListing.createdAt).getTime()) / (1000 * 60 * 60 * 24));
  tokenAge = Math.max(0, dbAge);
  this.logger.debug(`📅 Using database createdAt for age: ${tokenAge} days`);
} else {
  // Last resort: estimate based on activity
  const hasSignificantActivity = (trading?.volume24h || 0) > 50000 || (holders?.count || 0) > 500;
  tokenAge = hasSignificantActivity ? 7 : 0;
}
```

## Implementation

Update `refresh.worker.ts` around line 1196:

1. Replace the simple age calculation with the improved version above
2. Add detailed logging to understand why age is 0
3. Test with a known old token to verify it works

## Expected Results

After this change:
- ✅ Tokens with creation timestamps → Age calculated correctly
- ✅ Tokens with significant activity → Estimated minimum 7 days
- ✅ Very new tokens → Age = 0 (will still be skipped, but with better logging)
- ✅ Better debugging information in logs

