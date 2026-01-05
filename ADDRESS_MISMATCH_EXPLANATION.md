# Address Mismatch Issue: DexScreener vs Database

## Problem Summary

When tokens are manually added to the database using addresses from the `INITIAL_TOKENS` constant, and then the system attempts to fetch holder data, there's an address mismatch issue that prevents holder data from being retrieved and displayed correctly.

## Root Cause

### 1. **Initial Token Addresses**
- The `INITIAL_TOKENS` array contains hardcoded token addresses (e.g., `gh8ers4yzkr3ukdvgvu8cqjfgzu4cu62mteg9bcj7ug6` for Michi token on Solana)
- These addresses are manually curated and represent the "canonical" token contract addresses

### 2. **DexScreener API Behavior**
When the `ensureInitialTokensExist()` function fetches token data from DexScreener API:
- It calls: `https://api.dexscreener.com/latest/dex/tokens/{address}`
- DexScreener returns a response containing **pair data** (trading pairs), not just token data
- The response structure is: `{ pairs: [...] }` where each pair contains a `baseToken` or `quoteToken` object
- **DexScreener may return a different address format or normalization** in the response:
  - The address might be in a different case (upper/lower)
  - The address might be from the pair's base/quote token, not the original token address
  - DexScreener may return the "best" pair's token address, which could differ slightly

### 3. **Database Storage**
When the token data is saved to the database:
- The system uses `tokenData.address` from DexScreener's response (line 1303 in `refresh.worker.ts`)
- This address (`address = tokenData.address`) is what gets stored as `contractAddress` in the database
- **If DexScreener returns a different address format**, the database will store that address instead of the original `INITIAL_TOKENS` address

### 4. **Holder Data Fetching Failure**
When the system later tries to fetch holder data:
- The `ensureInitialTokensExist()` function checks for existing tokens by:
  1. First trying to find by the original `INITIAL_TOKENS` address: `await this.repo.findOne(t.address)`
  2. If not found, trying to find by symbol + chain: `await this.repo.findBySymbolAndChain(t.symbol, t.chain)`
- If a token is found by symbol+chain (because the address doesn't match), the code uses `existing.contractAddress` (line 1215)
- However, when fetching holder data via `analyticsService.getHolderCount(address, chain)`, it uses the database address
- **If the API endpoints (Birdeye, Helius, Solscan) don't recognize the normalized address**, they return null, resulting in `holders` being stored as `null` or displayed as "---" on the frontend

## Example Scenario

1. **INITIAL_TOKENS contains:** `{ address: 'gh8ers4yzkr3ukdvgvu8cqjfgzu4cu62mteg9bcj7ug6', chain: 'SOLANA', symbol: 'Michi' }`

2. **System fetches from DexScreener:**
   - Calls: `GET https://api.dexscreener.com/latest/dex/tokens/gh8ers4yzkr3ukdvgvu8cqjfgzu4cu62mteg9bcj7ug6`
   - DexScreener returns pairs data, and the `tokenData.address` might be normalized or different

3. **Database stores:**
   - `contractAddress`: `5mbK36SZ7J19An8jFochhQS4of8g6BwUjbeCSxBSoWdp` (example - different from INITIAL_TOKENS address)
   - `symbol`: `MICHI`
   - `chain`: `SOLANA`

4. **Holder data fetch fails:**
   - System tries to fetch holders for `5mbK36SZ7J19An8jFochhQS4of8g6BwUjbeCSxBSoWdp`
   - Birdeye/Helius/Solscan APIs might not recognize this address format
   - Returns `null`, so `holders` field remains `null`

5. **Frontend displays:** "---" because `holders` is `null`

## Solution Implemented

The code now uses a two-step lookup strategy:
1. **Primary lookup:** Try to find token by the original `INITIAL_TOKENS` address
2. **Fallback lookup:** If not found, search by `symbol + chain` combination (line 1207)
3. **Use database address:** When found via fallback, use `existing.contractAddress` for holder fetching (line 1215)

However, the holder data APIs may still fail if they don't recognize the normalized address format returned by DexScreener.

## Why This Happens

- **DexScreener normalizes addresses:** Different address formats may be used (case differences, pair addresses vs token addresses)
- **Multiple address formats:** Solana addresses can appear in different formats (base58 encoded strings)
- **API response structure:** DexScreener returns pair data, and the "best" pair's token address might differ from the original query address

## Impact

- Holder data appears as "---" on the frontend
- Risk score calculations may be incomplete (holder count is a factor)
- Token analytics are incomplete


