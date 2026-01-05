# Jupiter API Integration & Address Mismatch Fix

## Summary

Fixed the address mismatch issue where pair addresses were being saved to the database instead of mint addresses, causing holder data to display as "---".

## Changes Made

### 1. Added Jupiter API Key Support
- Added `JUPITER_API_KEY` environment variable support in `RefreshWorker` constructor
- Jupiter API key: `91b41fe6-81e7-40f8-8d84-76fdc669838d` (Free tier, 1 RPS rate limit)

### 2. Added Mint Address Verification Method
- Created `verifyMintWithJupiter()` method to validate Solana mint addresses using Jupiter API
- Endpoint: `https://api.jup.ag/tokens/v2/mints?ids={address}`
- Header: `x-api-key: {JUPITER_API_KEY}`
- Returns `true` if address is a valid mint, `false` otherwise

### 3. Fixed Address Extraction Logic
- **For new tokens:** When fetching from DexScreener, the system now:
  1. Extracts token address from DexScreener pairs (via `mergeFeeds()`)
  2. **Prioritizes the original `INITIAL_TOKENS` address** if it's a valid mint (verified via Jupiter)
  3. Only uses DexScreener's address if the original address fails Jupiter validation
  
- **For existing tokens:** When updating holder data for existing tokens:
  1. If the stored address differs from the original `INITIAL_TOKENS` address
  2. Verifies the original address is a valid mint using Jupiter
  3. Uses the original mint address for holder fetching instead of the stored (potentially incorrect) address

## Technical Details

### Problem
- DexScreener returns trading pair data, which contains both `pairAddress` (liquidity pool) and `baseToken.address` (mint)
- The `mergeFeeds()` function correctly extracts `baseToken.address`, but DexScreener's response might still contain a different address format
- When the original `INITIAL_TOKENS` address was a valid mint but DexScreener returned a different format, the system saved DexScreener's address
- Holder APIs (Birdeye, Helius, Solscan) failed because they received pair addresses instead of mint addresses

### Solution
- Use Jupiter API to verify that the original `INITIAL_TOKENS` address is a valid mint
- If valid, always use the original address (the canonical mint address)
- This ensures consistency: the database always stores mint addresses, not pair addresses

## Environment Variable Required

Add to your `.env` file:
```bash
JUPITER_API_KEY=91b41fe6-81e7-40f8-8d84-76fdc669838d
```

## Rate Limits

Jupiter Free Tier:
- **Rate Limit:** 1 request per second (60 requests/minute)
- **Bulk Requests:** Use comma-separated addresses: `?ids=addr1,addr2,addr3`
- Current implementation: Sequential requests with 2-second delays (already in place)

## Testing

To verify the fix works:
1. Check backend logs for: `✅ Verified original address {address} is a valid mint for {symbol}`
2. Verify holder data is fetched successfully using mint addresses
3. Check database `contractAddress` field contains mint addresses, not pair addresses

## Next Steps

1. **Add `JUPITER_API_KEY` to production environment variables** (Coolify)
2. **Deploy the changes**
3. **Monitor logs** to confirm Jupiter validation is working
4. **Optional:** Clean up existing database records that might have pair addresses instead of mint addresses

## Files Modified

- `cto-backend-old-fresh/src/listing/workers/refresh.worker.ts`
  - Added `jupiterApiKey` property
  - Added `verifyMintWithJupiter()` method
  - Updated `ensureInitialTokensExist()` to prioritize original mint addresses


