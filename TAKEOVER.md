# CTO Platform – Technical Takeover and Handoff Guide (Updated)

This document equips the next engineer to continue seamlessly. It summarizes architecture, all changes made in this takeover (frontend + backend), issues encountered and fixes, how to test, and how to align vetting/tiering with the latest business rules. Keep scalability in mind and understand the system architecture before changing components to avoid regressions.

Last updated: 2025-09-28

---

## 1) Read-first mindset
- Understand the end-to-end architecture before edits: data contracts, caches, scan flows, enrichment, and UI merges.
- Prioritize non-breaking changes. When in doubt, add behind feature flags/envs and keep fallbacks.
- Design for scalability: add caching, rate limits, observability, and asynchronous refresh when integrating external APIs.

---

## 2) Architecture overview
- Backend: NestJS (TypeScript) with modules: Auth, Listing, Scan, Image, Storage (S3), Health, Common, Circle.
  - Entrypoint: `cto-backend/src/main.ts`; compiled output: `cto-backend/dist/main.js`.
  - Swagger (dev): `/api/docs`.
- Frontend: React + TypeScript; public listings UI includes client-side market enrichment and controls to refresh/merge fields safely.
- Data enrichment sources (client-first, backend-ready):
  - GMGN (optional, when `REACT_APP_GMGN_API_BASE` is set) – price, market cap, volume, liquidity, holders, tier
  - DexScreener – priceUsd, liquidityUsd, volume24h, marketCap (FDV fallback), best pair by USD liquidity
  - Jupiter – symbol/name/logo
  - Solscan – holders

---

## 3) What changed in this takeover

### 3.1 Frontend: Market enrichment for public listings
- File: `cto-frontend/src/services/marketEnrichment.ts`
  - Queries in parallel: GMGN (if configured), DexScreener, Jupiter, Solscan holders.
  - Merge priority: GMGN > DexScreener > Jupiter; Solscan specifically for holders.
  - Validates numerics via `Number.isFinite` and falls back gracefully.
- File: `cto-frontend/src/components/Listing/ListingDetail.tsx`
  - After initial fetch from backend, auto-enriches missing fields: holders, price, volume, liquidity, market cap.
  - Conservative merge: keep backend fields; fill only gaps from public sources.
  - Background enrichment pass for holders/market cap when still missing.
  - UI controls:
    - Header button “Refresh data”: attempts backend `/api/listing/refresh` then re-fetches and re-merges.
    - Page button “Update market data”: triggers client-side enrichment on demand.

### 3.2 Bug fix: Holders showed "—" incorrectly
- In `ListingDetail.tsx`, holders display now uses `Number.isFinite(Number(holders))` instead of a truthiness check. This ensures `0` holders render as `0` instead of “—”.

### 3.3 Backend: Image presign and auth (from previous update, preserved)
- Swagger Bearer scheme configured, `POST /images/presign` secured; presign PUT/GET implemented via AWS SDK v3.

### 3.4 Bug fix: S3 Image Display Issues with Expired Presigned URLs
- Fixed issue where user listing images were not displaying due to presigned URLs expiring too quickly.
- Extended presigned URL expiration time from 15 minutes to 24 hours to accommodate time synchronization issues.
- Enhanced image handling logic to use appropriate URL types (public vs. presigned) based on image location.
- See detailed explanation in section 12.1.

---

## 4) Configuration

### 4.1 Frontend env
- `REACT_APP_BACKEND_URL=http://localhost:3001` (or your API base)
- Optional GMGN: `REACT_APP_GMGN_API_BASE=https://your-gmgn-endpoint`

Restart the frontend after changing envs.

### 4.2 Backend env (selected)
- PORT=3001
- BACKEND_BASE_URL=http://localhost:3001 (or https://api.ctomemes.xyz)
- Circle (if used): CIRCLE_API_BASE, CIRCLE_API_KEY, CIRCLE_APP_ID
- Redis (if used): REDIS_URL or REDIS_HOST/REDIS_PORT
- S3 (images): AWS_REGION, AWS_S3_BUCKET_NAME, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY

---

## 5) Vetting and tiering – alignment with business rules

Business specification to align:

1) Seed Tier
- Description: Entry-level CTO projects, 14–21 days old, early activity and minimal liquidity.
- Rug Risk Score target: <70 (Medium or better).
- Criteria:
  - LP Amount: $10,000–$20,000 (min $10,000)
  - LP Lock/Burn: 6–12 months (12 recommended)
  - Wallet Activity: 5–15 active wallets in last 7–14 days; flag if >20 or >10% sell-off
  - Smart Contract: No critical vulnerabilities (basic Slither/Mythril)
- Weighting: 30% LP Amount, 30% LP Lock/Burn, 20% Wallet Activity, 20% Smart Contract

2) Sprout Tier
- Description: >21 days, moderate liquidity, more stability.
- Rug Risk Score target: <50 (Low).
- Criteria:
  - LP Amount: $20,000–$50,000 (min $20,000)
  - LP Lock/Burn: 12–18 months (18 recommended)
  - Wallet Activity: No major sell-offs (>10% by top holders) in 30 days
  - Smart Contract: Enhanced analysis (upgradability check)
- Weighting: 30% LP Amount, 30% LP Lock/Burn, 20% Wallet Activity, 20% Smart Contract

3) Bloom Tier
- Description: >1 month old, significant liquidity/security.
- Rug Risk Score target: <50 (Low).
- Criteria:
  - LP Amount: $50,000–$100,000 (min $50,000)
  - LP Lock/Burn: 24–36 months (36 recommended; 15% burn may reduce to 24 months)
  - Wallet Activity: No suspicious activity in 30 days
  - Smart Contract: Comprehensive audit (e.g., Certik)
- Weighting: 30% LP Amount, 30% LP Lock/Burn, 20% Wallet Activity, 20% Smart Contract
- Badge: “Bloom” (full at $50k/24m; Stellar-eligible at $100k/36m)

4) Stellar Tier
- Description: >3 months old, top-tier.
- Rug Risk Score target: <30 (Very Low).
- Criteria:
  - LP Amount: $100,000–$200,000 (min $100,000)
  - LP Lock/Burn: 24–36 months + Burn option; 20% burn yields Elite/lock relax
  - Wallet Activity: No anomalies in 90 days
  - Smart Contract: Multiple audits (Certik + Hacken)
- Weighting: 30% LP Amount, 30% LP Lock/Burn, 20% Wallet Activity, 20% Smart Contract
- Badge: “Stellar” (full at $100k/24m; Stellar Elite at $200k/36m + burn)

Age & maturity overlay:
- Seed: 14–21 days; developer inactivity >= 30 days
- Sprout: 21–30 days; extended LP locks; add upgradability check
- Bloom: 30–60 days; inactivity > 60 days; at least one formal audit
- Stellar: 60–90 days; multiple audits; inactivity > 90 days

Additional safety:
- Verified developer inactivity (wallet/GitHub proof)
- LP lock verification via trusted lockers; disqualify early unlocks
- Wallet activity monitoring for natural patterns; manual review on bot-like ranges
- Tier-appropriate contract scans; comprehensive audits for top tiers

### 5.1 Implementation plan (backend)
- Location: `cto-backend/src/scan/services/tier-classifier.service.ts`
- Current state: Contains internal criteria and checks for age/LP/wallet/smart-contract. Thresholds differ from business spec above.
- Action:
  1) Externalize tier config to a JSON/TS config file (e.g., `src/scan/config/tiers.config.ts`) matching the business criteria above.
  2) Update checks to include:
     - Developer inactivity thresholds
     - LP lock verification (integrate with lock providers; at minimum, ingest verifiable timestamps/tx links)
     - Upgradability and ownership logic checks in contract risk section
     - Multi-audit requirements for Bloom/Stellar
  3) Recalibrate risk score computation to enforce target thresholds per tier; apply weights exactly as specified.
  4) Add unit tests to lock the behavior and avoid regressions.
- Data sourcing:
  - LP Amount: Start from DexScreener liquidityUsd, but prefer on-chain pool TVL if available. Ensure consistent USD valuation.
  - LP Lock/Burn: Requires integration with lock services or on-chain program (Solana-specific). Store verified lock/burn evidence.
  - Wallet Activity: Use recent-horizon tx data (7–90 days based on tier). Track unique active wallets, sell-off %, top-holders deltas.
  - Smart Contract: Pipeline to run basic tools (Slither/Mythril or equivalent for the target chain) and record key risk flags.
- Output: Classifier returns tier name + reasons; store with listing metadata.

---

## 6) Troubleshooting – holders show “—”
1) UI formatting: Fixed to use `Number.isFinite(Number(holders))` so `0` is displayed correctly.
2) Source availability:
   - Solscan rate limits or 429/5xx can return empty; try again or implement backend caching.
   - Invalid `contractAddress` or unsupported chain → no holders.
3) GMGN not configured: Enrichment still functions via DexScreener/Jupiter/Solscan, but tier may remain empty if only GMGN provides it.
4) Network/CORS: Ensure frontend can reach public APIs and your backend base.

---

## 7) How to test the listing detail
1) Start backend (dev) and frontend.
2) Navigate to a public listing detail route with a valid contract address.
3) Verify after initial load:
   - Missing fields (holders, market cap, etc.) are filled by enrichment.
   - “Update market data” updates values; “Refresh data” triggers backend refresh if supported and re-merges.
4) Confirm holders now renders `0` when zero rather than “—”.

---

## 8) Backend image presign troubleshooting (preserved)
- 401 on `POST /images/presign`: add JWT (Swagger → Authorize; app → Axios interceptor).
- 403 on S3 PUT: check IAM principal vs bucket policy; capture XML body; verify region; adjust policy or credentials.

---

## 9) Scalability and reliability
- Move enrichment to backend with caching (Redis) to reduce latency and rate-limit exposure; serve the cached snapshot to all clients.
- Implement rate limiting and exponential backoff for public APIs; detect provider outages and degrade gracefully.
- Normalize numeric formats (prices, caps) across sources; write unit tests for merge/priority logic.
- Add observability: structured logs, request IDs, metrics for enrichment latency, hit/miss, and error rates.
- Use background jobs/queues for refresh tasks and heavy scans. Keep API responsive.

---

## 10) Quick reference – important files
- Frontend
  - `src/services/marketEnrichment.ts` – external market data fetching/merge
  - `src/components/Listing/ListingDetail.tsx` – UI load/merge, buttons, holders fix
  - `src/services/listingService.ts` – `refresh`, `getOne`, `list`, `scan`
- Backend
  - `src/scan/services/tier-classifier.service.ts` – tier checks (to align with business spec)
  - `src/scan/services/scan.service.ts` – overall scan pipeline
  - `src/image/image.controller.ts` – image handling, presign, and URL generation
  - `src/image/image.service.ts` – image service with extended presigned URL expiration
  - `src/storage/s3-storage.service.ts` – S3 storage and URL generation
  - `src/main.ts` – Swagger, global setup

---

## 11) Next steps for the new engineer
- Align `tier-classifier` thresholds and add explicit developer inactivity + lock verification.
- Add a backend enrichment endpoint with caching; update frontend to prefer backend-provided market snapshot.
- Add unit/integration tests for enrichment merge and tier classification.
- Document any new envs and keep feature flags for risky changes.

Always confirm how a change impacts the broader architecture. Favor backward-compatible steps and incremental rollouts to avoid breaking what already works.

---

## 12) Images: URL pipeline and frontend integration

- **Upload flow (presigned PUTs)**:
  1. Frontend requests `POST /api/images/presign` with body `{ type, filename, mimeType }`. This endpoint is protected by JWT (Bearer token).
  2. Backend derives the storage key using the authenticated `userId` and `type`:
     - Resulting key: `user-uploads/<userId>/<type>/<timestamped-filename>`
     - Note: any `projectId` sent by the client is currently ignored; the namespace is per-user by design.
  3. Backend responds with `{ key, uploadUrl, viewUrl, metadata }`.
  4. Frontend performs a direct `PUT` to `uploadUrl` with the image bytes.
  5. Frontend constructs a stable view URL for storage: `${BACKEND_URL}/api/images/view/${key}` and persists it to the listing via `PATCH /api/user-listings/:id` (e.g., `{ logoUrl }` or `{ bannerUrl }`).

- **View flow (short-lived GET redirects)**:
  - Public endpoint `GET /api/images/view/*key` validates/normalizes the key, ensures metadata exists (memory/redis), obtains a short-lived S3 GET URL, and redirects. This hides S3 details and avoids expired URLs in the frontend or DB.
  - Legacy keys using commas are accepted (e.g., `user-uploads,4,generic,foo.jpg` → normalized to `user-uploads/4/generic/foo.jpg`).

- **Frontend helpers**:
  - `normalizeImageUrl(input)`: Converts S3 or raw keys into `${BACKEND_URL}/api/images/view/<key>` and leaves 3rd-party URLs (Dexscreener, etc.) as-is.
  - `buildImageCandidates(input)`: Produces multiple candidates for resilience (slash/comma variants, basename fallback).

- **Common pitfalls**:
  - Missing JWT when calling `POST /api/images/presign` → 401.
  - S3 credentials misconfigured on the server → 403 on PUT (check IAM + bucket policy + region).
  - Storing raw presigned S3 GET URLs in DB → they expire; always store the backend view route.

## 12.1) S3 Image Display Issues with Expired Presigned URLs

- **Issue**: User listing images previously displaying correctly were no longer showing up due to presigned URLs expiring before they could be used. The error message "Request has expired" indicated a time synchronization issue between the local system and AWS servers (approximately 7.5 hours difference).

- **Solution implemented**:
  1. **Extended Presigned URL Expiration Time**: Modified `ImageService` class to increase the default expiration time from 15 minutes (900 seconds) to 24 hours (86400 seconds).
  2. **Enhanced Image Controller**: Updated the `viewImage` method in `ImageController` to handle different image key types more intelligently:
     - For assets: Uses direct public URLs
     - For user uploads: Uses presigned URLs with extended expiration time
     - Added error logging for better debugging
  3. **Added Public URL Support**: Added a new method to `ImageService` to get public URLs for user uploads.
  4. **Modified S3 Storage Service**: Updated `getPublicAssetUrl` method in `S3StorageService` to properly handle user upload keys.
  5. **Improved Download Endpoint**: Enhanced `downloadImage` method to normalize key formats and use the same extended expiration time.

- **Key files modified**:
  - `src/image/image.service.ts`: Extended presigned URL expiration time
  - `src/image/image.controller.ts`: Enhanced image handling logic
  - `src/storage/s3-storage.service.ts`: Improved URL generation

- **Root cause**: Time synchronization issue between the local system and AWS servers causing presigned URLs to expire prematurely.

- **Future considerations**:
  - Implement a time synchronization solution for the server
  - Monitor S3 access patterns and costs (longer presigned URL expiration times might affect billing)
  - Consider implementing a CDN for better performance and reliability of image serving

---

## 13) Draft flow: why it matters

- **Purpose**: Draft listings allow users to progressively upload assets and fill details before publishing. Images get uploaded and their URLs are persisted immediately to prevent losing work.
- **Creation**:
  - A draft is created after the scan passes the risk gate. The frontend helper `ensureDraftExists()` creates a draft when needed and caches its `id` locally.
- **Image persistence**:
  - When the user uploads a logo or banner, the frontend attempts to ensure a draft exists, uploads the image, then calls `PATCH /api/user-listings/:id` to persist `{ logoUrl }` or `{ bannerUrl }` immediately.
- **Publishing**:
  - Minimal validation is enforced (`title`, `description`, and risk score within threshold). After publishing, the record becomes immutable to edits.

---

## 14) Deploying to Railway (always-on API for frontend dev)

- **Branching**:
  1. Push backend to GitHub branch `backend-auth-scan`.
  2. On Railway, create a service from the GitHub repo and select the `backend-auth-scan` branch for deploys.

- **Build/Start**:
  - `railway.json` uses Nixpacks and sets `startCommand: npm start`.
  - Nixpacks detects the Node project and will run `npm run build` if present (we have a `build` script) before starting.

- **Required environment variables**:
  - Core
    - **PORT**: Railway provides automatically; the app binds to `process.env.PORT`.
    - **NODE_ENV=production**
    - **ENABLE_SWAGGER=true** temporarily to help integration; set to `false` later.
    - **CORS_ORIGINS**: Comma-separated list that must include frontend dev origins, e.g. `http://localhost:5173,http://localhost:3000` and any staging domains.
    - **BACKEND_BASE_URL**: e.g., `https://<railway-subdomain>.up.railway.app`
  - Database
    - **DATABASE_URL**: Postgres connection string (Railway Postgres or external).
  - Images (S3)
    - **AWS_REGION**, **AWS_S3_BUCKET_NAME**, **AWS_ACCESS_KEY_ID**, **AWS_SECRET_ACCESS_KEY**.
  - Optional
    - **REDIS_URL** (or host/port), **SOLSCAN_API_KEY**, **HELIUS_API_KEY**, **CIRCLE_API_BASE**, **CIRCLE_API_KEY**, **CIRCLE_APP_ID**.

- **Health and docs**:
  - Health: `GET /health` returns `{ status: 'OK', ... }` for Railway checks.
  - Swagger: `GET /api/docs` when `ENABLE_SWAGGER=true` (disabled in production otherwise).

- **Frontend dev usage**:
  1. Set `REACT_APP_BACKEND_URL` to the Railway base URL (e.g., `https://<railway-subdomain>.up.railway.app`).
  2. Run the frontend locally; the API will be accessible without manually running `npm start` on the backend, because Railway keeps the service running.

---

## 15) Final pre-deploy checklist

- **Backend runtime**
  - Server binds to `PORT` and exposes `/health` (OK).
  - Global prefix `/api` in place; CORS origins read from `CORS_ORIGINS` (OK).
  - Swagger guarded by `ENABLE_SWAGGER` (OK).
- **Images**
  - `POST /api/images/presign` requires JWT; keys are per-user (`user-uploads/<userId>/<type>/...`).
  - `GET /api/images/view/*key` redirect works with slash/comma keys.
  - Frontend uses `normalizeImageUrl` and persists backend view URLs into DB.
- **Listings**
  - Draft creation/update works; `logoUrl` and `bannerUrl` persist immediately after upload.
  - Publishing enforces minimal validation and immutability post-publish.
- **Deployment**
  - Railway service configured on branch `backend-auth-scan` with envs set.
  - CORS includes the frontend dev origins.
  - Database reachable and `DATABASE_URL` set; run `npm run db:deploy` if using migrations on first boot (or initialize via Railway shell).

If any step needs clarification during handoff, check `src/main.ts`, `src/image/*`, and `src/user-listings/*` for the latest implementation details.