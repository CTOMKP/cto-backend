# Trade Tape Handoff (Backend)

Status pinned to commit `815f513` on branch `backend-auth-scan`.

This document explains how trade fetching works, the provider order per chain, required env vars, and what to check when trades are missing.

## Quick Summary

- Trade history is served by `TradeHistoryService` in `src/trades/trade-history.service.ts`.
- Solana uses **Helius Enhanced Transactions** first, with multiple pair fallbacks.
- EVM (Base/ETH/BSC) uses **Bitquery → Birdeye → DexScreener pair → Bitquery (pair)**.
- Sui uses **BlockVision → Birdeye → DexScreener pair → BlockVision/Birdeye (pair)**.
- DexScreener **free API does not provide per‑trade history**; it only helps discover pair addresses.
- Minimum trade filter is **$0.50** (`minTradeUsd = 0.5`). Trades below this are dropped.

## Key Files

- `src/trades/trade-history.service.ts`
  - Provider order, trade normalization, dust filter, and direction inference.
- `src/listing/services/cache.service.ts`
  - Redis cache for listing cache (not trade cache in this commit).
- `src/health/health.controller.ts`
  - Redis health check.

## Provider Order (Current)

### Solana
1. Helius Enhanced Transactions by mint
2. Listing metadata pair (from DB) → Helius
3. Shyft pool → Helius
4. DexScreener pair → Helius
5. Birdeye trades

Relevant logs:
- `Fetching Helius trades for ...`
- `Helius fallback: querying pair address ...`
- `Shyft fallback: querying pool address ...`
- `DexScreener fallback: querying pair address ...`
- `Helius returned no trades ... trying Birdeye fallback`

### Base / Ethereum / BSC (EVM)
1. Bitquery trades (token)
2. Birdeye trades
3. DexScreener pair lookup → Bitquery trades (pair)
4. DexScreener fallback (no trades, only pair discovery)

Important:
- Bitquery free tier returns **402** (payment required). If 402, EVM trades will fall through.
- Birdeye rate‑limits can return **400 / "Compute units usage limit exceeded"**.
- DexScreener free API does **not** supply per‑trade history.

### Sui
1. BlockVision trades
2. Birdeye Sui trades
3. DexScreener pair lookup → BlockVision/Birdeye (pair)

## Env Vars (Coolify)

Required by current code:
- `BIRDEYE_API_KEY`
- `HELIUS_API_KEY`
- `SHYFT_API_KEY`
- `BLOCKVISION_API_KEY`
- `BITQUERY_ACCESS_TOKEN`

Used elsewhere (not directly by trade history):
- `DATABASE_URL`
- `REDIS_URL`

Notes:
- **Bitquery**: 402 on free tier. If this key is unpaid, EVM trades will be sparse.
- **Birdeye**: compute‑unit limits are frequent on free tier.

## Trade Data Shape

Endpoint:
- `GET /api/v1/tokens/:address/trades?limit=50&chain=<chain>&nocache=1`

Response:
```
{
  "data": {
    "data": [
      {
        "txHash": "...",
        "timestamp": "...",
        "type": "BUY" | "SELL",
        "price": number,
        "amount": number,
        "totalValue": number,
        "makerAddress": "..."
      }
    ],
    "count": number
  },
  "statusCode": 200,
  "timestamp": "..."
}
```

## Current Behavior & Known Limitations

- If upstreams rate‑limit or are unpaid, **"No trades yet" is expected**.
- DexScreener only helps resolve pair addresses; **it does not provide trade history**.
- Some Solana tokens show trades via Helius; others may not if pool data isn't indexed.
- The dust filter (`minTradeUsd = 0.5`) will drop small trades.

## Troubleshooting Checklist

1. **Check chain routing**
   - Ensure you pass `chain` query param (`solana`, `base`, `ethereum`, `bsc`, `sui`).

2. **Check provider failures in logs**
   - Birdeye rate limit: `"Compute units usage limit exceeded"`
   - Bitquery: `402`
   - Helius: `400` or empty array

3. **Verify pair address in DB**
   - Listing metadata must have `pairAddress` or `market.pairAddress`.
   - If missing, DexScreener fallback may help only for pair discovery.

4. **Verify dust filter**
   - Trades below $0.50 are dropped.

5. **Confirm Helius Enhanced Transactions**
   - Uses `https://api.helius.xyz/v0/addresses/{address}/transactions`.
   - If token is new, Helius may not return swap events.

## Suggested Next Steps (If Needed)

1. **EVM trade fallback via RPC logs**
   - Use `ALCHEMY_API_KEY` and scan pair Swap/Transfer logs.
   - Current commit does not include this.

2. **Add adaptive backoff**
   - Skip upstreams temporarily on rate limit responses.

3. **Introduce trade cache (Redis)**
   - Cache per‑token trade lists to avoid hammering APIs.
   - No trade cache in this commit.

4. **Paid tiers**
   - Bitquery (EVM) and Birdeye (all) paid tiers are required for consistent coverage.

## Deployment Notes

- Backend running in Coolify on Contabo VPS.
- Redis is configured separately; ensure `REDIS_URL` is set.
- After any env change, **redeploy**.

## Reference Logs (Expected)

Examples:
- `✅ Found 50 trades from Helius for <mint>`
- `Bitquery API error: Request failed with status code 402`
- `Birdeye bsc trades fetch failed ... Compute units usage limit exceeded`
- `DexScreener: Found <chain> pair ..., but individual trades not available in free API`

---

# Marketplace + Frontend Handoff (Feb 14, 2026)

This section documents the current marketplace implementation and the most recent frontend fixes.

## Backend Marketplace Changes

- **Role/category pricing removed from totals** so ads do **not** charge a fixed price based on role/category.
  - Commit: `f784d95` on `backend-auth-scan`.
  - File changed: `src/marketplace/marketplace.service.ts`
    - `baseCategory` forced to `0`
    - `missingCategoryPrice` forced to `false`
- **Action required:** redeploy backend in Coolify so this change is live.

## Frontend (cto-frontend-old-fresh)

### Fixes applied
- `PrivyProfilePage.tsx` was corrupted and restored from git, then updated with:
  - `loadMyAds` function that calls `marketplaceService.listMine()`
  - My Ads tab replaced with an **ads table** showing status (Pending/Published/Rejected/Expired)
- Admin button removed from user profile (admin tools belong to vineyard UI).

### Current file edits
- `src/components/Profile/PrivyProfilePage.tsx`
  - Add `loadMyAds`
  - Replace “Ad management is coming soon” with table
- `src/services/marketplaceService.ts`
  - Includes `listMine()` (GET `/api/v1/marketplace/ads/mine`)

### Known runtime check
If the frontend errors with `loadMyAds is missing`, the file was likely corrupted or the restore wasn’t applied. Restore and re-apply:
```
git checkout -- src/components/Profile/PrivyProfilePage.tsx
```
Then re-apply the `loadMyAds` + My Ads table changes.

## Marketplace Flow Notes

- Ads should show **Pending Approval** in user profile after payment.
- Only **Published** ads appear on public marketplace.
- After payment success, UI should show: “Admin is reviewing” with buttons back to profile/marketplace.
- Preview should highlight selected tier and add-ons.

## DB State

- Marketplace tables and enums were created in production via manual SQL in postgres container.
- Ensure tables exist: `MarketplaceAd`, `MarketplacePricing`, plus `Payment.marketplaceAdId`.

