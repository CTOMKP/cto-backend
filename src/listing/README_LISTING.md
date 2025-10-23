# Listing Module

The Listing module provides production-ready endpoints for token listing data: scanning, retrieval, pagination, and background refreshes.

## Endpoints
- GET `/api/listing/listings` — Paginated list with filters: `q`, `tier`, `minRisk`, `maxRisk`, `sort`, `page`, `limit`
- GET `/api/listing/:contractAddress` — Get a single listing by contract address
- POST `/api/listing/scan` — Scan a token and upsert a listing (JWT required)
- POST `/api/listing/refresh` — Enqueue a background refresh (JWT required)

## Background Refresh
- Every 30 minutes, fetches trending/new Solana tokens from DexScreener and upserts basic market metadata (price, liquidity, volumes, FDV, txns).
- Every 60 minutes, enriches known listings by running the full scan to compute riskScore, tier, and summary.
- Every 6 hours, cleans up old records to keep database lean.
- Structured logs report: refreshed count, API calls, failures, and duration.

## Environment
- DATABASE_URL
- REDIS_URL (recommended; short-lived cache for external feeds)
- DEXSCREENER_URL (optional override, defaults to https://api.dexscreener.com/latest)
- BIRDEYE_API_KEY (for BirdEye trending endpoints)
- HELIUS_API_KEY (optional; enables additional popularity heuristics)
- External APIs used by ScanService (e.g., Solscan/Moralis/Helius)

## Metrics
- GET `/api/listing/metrics` exposes Prometheus metrics:
  - listing_refresh_total
  - listing_refresh_failures_total
  - listing_api_calls_total
  - listing_scan_enrichments_total
  - listing_refresh_duration_seconds (histogram)

## Migrations
1. Update Prisma client and apply migrations:
```
npm run db:generate
npx prisma migrate dev --name rename_marketplace_to_listing
```
2. If you want a clean slate, you can reset dev DB first:
```
npx prisma migrate reset
```

## Notes
- Module is designed so a future Marketplace module (ads/user postings) can live separately.
- Rate limiting is lightweight and can be replaced with a Redis-backed limiter later.