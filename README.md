# CTO Marketplace Backend (NestJS + Prisma + PostgreSQL)

A production-ready Solana token vetting API focused on accuracy, speed, and scalability. Built with NestJS, documented with Swagger, persists with Prisma/PostgreSQL, and supports Redis caching and optional image storage on a VPS.

---

## Highlights

- **NestJS + Swagger**: Modular, typed API with interactive docs at `/api/docs`
- **Speed-focused scanning**: Clear validation, graceful fallbacks, and structured errors
- **JWT auth**: Access/refresh tokens with guards and DTO validation
- **Risk & Tiers**: Tier classifier + risk scoring + AI summary
- **Prisma + PostgreSQL**: Strong schema with migrations
- **Redis-ready**: Caching hook points in scan services
- **VPS integration**: Optional SFTP image handling via Contabo

---

## Clean project structure

```
cto-backend/
├─ src/                    # NestJS source
│  ├─ auth/                # Auth module (JWT, guards)
│  ├─ scan/                # Scan controller + services
│  ├─ image/               # Image controller, Redis service, types
│  ├─ prisma/              # Prisma module/service
│  ├─ utils/               # Helpers (formatters, validation)
│  ├─ main.ts              # Nest bootstrap
│  └─ app.module.ts        # Root module
├─ prisma/
│  ├─ schema.prisma        # DB schema (User, ScanResult)
│  └─ migrations/          # Prisma migrations
├─ dist/                   # Build output
├─ .env                    # Local/server env (ignored in Git)
├─ .env.example            # Safe template for required variables
├─ package.json
├─ tsconfig.json
└─ README.md               # This file
```

Removed legacy/duplicates to keep the repo professional and minimal:
- Removed `lagacy/` (old Express implementation)
- Removed duplicate `src/utils/ageFormatter.ts` (kept `age-formatter.ts`)
- Removed empty `config/` and stray `.txt`

---

## Environment variables

Copy `.env.example` to `.env` and fill in values.

Security: `.env` is Git-ignored. Set production values on the server or your hosting provider (Vercel/Railway/VPS) and never commit secrets to Git.

---

## Local development

1) Install dependencies
```bash
npm install
```

2) Prepare environment
```bash
# copy and edit .env
type .env.example > .env  # Windows PowerShell shortcut or copy manually
```

3) Prisma client and migrations
```bash
npm run db:generate
npm run db:migrate
```

4) Start API
```bash
npm run dev
# Swagger: http://localhost:3001/api/docs
```

5) Auth in Swagger
- Click Authorize and paste `Bearer <access_token>` from login.

---

## Deployment (VPS/Containers/Platforms)

- Ensure environment variables are set in the platform:
  - DATABASE_URL, JWT_SECRET, CORS_ORIGINS, HELIUS_API_KEY, MORALIS_API_KEY (optional), BIRDEYE_API_KEY (optional), REDIS_*, CONTABO_*
- Build and run:
```bash
npm run build
npm start
```
- Prisma in production:
```bash
npm run db:generate
npm run db:deploy
```

### VPS notes (PostgreSQL/Redis/Image storage)
- PostgreSQL: create `cto_db` and user; set `DATABASE_URL`
- Redis (optional): enable and set password if desired; configure `REDIS_*`
- Image storage (optional): ensure `CONTABO_IMAGE_PATH` and `CONTABO_BASE_URL`

---

## API usage

- Swagger: `/api/docs`
- Endpoints:
  - POST `/api/auth/register` — register user
  - POST `/api/auth/login` — login and receive tokens
  - GET `/api/auth/profile` — current user (Bearer)
  - POST `/api/auth/refresh` — refresh access token
  - POST `/api/scan/scan` — scan a single token (200 OK)
  - POST `/api/scan/scan-batch` — scan multiple tokens

Example single scan body:
```json
{
  "contractAddress": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
}
```

---

## Design choices for performance & reliability

- Strict input validation and early exits (bad addresses/too-young tokens)
- Clear error mapping with consistent HTTP codes
- External API fallbacks and timeouts recommended
- Redis integration points for hot-result caching (TTL 5–15m)
- DB writes minimized (single scans persist only when authenticated)

---

## Development checklist

- Keep `.env` off Git; use `.env.example` for onboarding
- Run Prisma migrations after schema changes
- Keep Swagger docs aligned with controller status codes
- Prefer Helius for RPC-heavy calls to avoid rate limits
- Add tests for new modules/services/DTOs

---

## Scripts

```bash
npm run dev         # Start Nest in watch mode
npm run build       # Compile to dist/
npm start           # Run compiled build
npm run db:generate # Prisma client
npm run db:migrate  # Dev migrations
npm run db:deploy   # Deploy migrations in prod
```

---

## Contributing standards

- TypeScript only; DTOs for all inputs
- Controllers thin; logic in services
- Explicit status codes; add Swagger decorators
- Add/adjust tests when modifying behavior

---

## Contact / Maintenance

- Keep environment variables synchronized between environments via platform settings
- Review logs and metrics regularly; consider adding APM/monitoring
- Use semantic commits and PR reviews for changes

---

## Changelog (2025-09-19)
- Preserve metadata on upserts
  - upsertMarketMetadata merges `metadata.market` instead of overwriting.
  - persistScanAndUpsertListing merges `metadata.token` instead of overwriting.
- Listing response enrichment
  - Falls back to `metadata.market` for price/liquidity/volume/tx counts and returns `null` when missing (no 0 placeholders).
  - Surfaces `logoUrl` from `metadata.market`.
- Optional DB backfill
  - SQL provided (in chat/ops docs) to hydrate top-level numeric columns from `metadata.market` where NULL.
- Moralis Solana integration
  - RefreshWorker fetches tokens from Moralis Solana endpoint and merges into feed (priceUsd, liquidityUsd, fdv, volume24h, holders).
  - Holders from feed are considered in communityScore and surfaced via metadata.market.holders.
- Windows EPERM (frontend)
  - Switched Next.js dev/build to Webpack; excluded .next from VS Code watchers; clean .next when issues occur.

## Multi-chain Roadmap
- Client priority: Sol, Eth, Bsc, Sui, Base, Aptos.
- Phase 0 (done): Partial market data for non-Solana via DexScreener; enrichment message for unsupported chains.
- Phase 1: EVM family (Ethereum, BSC, Base) — per-chain fetchers, keep merge semantics, enable refresh endpoints; scanners remain Solana-only initially.
- Phase 2: Sui & Aptos — add enums and market fetchers; enrichment to follow.
- Phase 3: Chain-specific scanners — implement risk/tier per chain and unify outputs.

## Multi-chain Phase 1 (completed 2025-09-19)
- Backend schema and validation updated:
  - Prisma enum Chain: SOLANA, ETHEREUM, BSC, SUI, BASE, APTOS, NEAR, OSMOSIS, OTHER, UNKNOWN.
  - ListingQueryDto ChainDto updated to accept the same.
- Worker ingestion expanded:
  - DexScreener queries broadened for ETH/BSC/BASE/SUI/APTOS; dedupe and merge preserved.
  - mapChainIdToEnum returns distinct enums for ETHEREUM, BSC, SUI, BASE, APTOS (no EVM lumping).
  - Non-Solana listings get market snapshot + "<CHAIN> enrichment not supported yet" summary.
- Repository unions updated to include the six chains for upserts and updates.
- Migration applied: 20250919074304_add_chains (use: `npx prisma migrate dev -n add_chains`; `npx prisma generate`).
- Ops: restart API/worker after migration.

## Phase 2 (next)
Goal: Add per-chain enrichment beyond Solana, starting with EVM (Ethereum, BSC, Base), then Sui and Aptos. Keep existing merge semantics and caching/backoff.

Planned changes:
1) Configuration
- Add env keys: ALCHEMY_API_KEY or QUICKNODE_URL (EVM), MORALIS_API_KEY (optional), SUI_RPC_URL, APTOS_RPC_URL.
- Document in .env.example.

2) Enrichment services
- Create chain-specific enrichment services with a common interface, e.g. `IEnrichmentService`.
  - EVMEnrichmentService (Uniswap/Pancake pairs via provider; token metadata; holders/txns snapshot).
  - SuiEnrichmentService; AptosEnrichmentService (RPCs for token metadata and basic stats).
- Wire into refresh.worker to enrich on new/update events when chain !== SOLANA.

3) Data model and persistence
- Reuse Listing.metadata; store per-chain enrichment under metadata.enrichment[chain].
- Continue mapping top-level fields (priceUsd/liquidityUsd/volume24h/txCounts) from the enriched market snapshot.

4) API surface
- Optional: POST /api/listing/refresh to trigger re-enrichment by { chain, contractAddress }.
- Swagger updates for new response fields where applicable.

5) Reliability and performance
- Add retry with jitter/backoff for provider calls; respect rate limits.
- Cache recent enrichments (TTL 5–15m) to reduce provider load.
- Basic metrics/logging per chain for success/error rates.

6) Tests
- Unit: mapChainIdToEnum; each enrichment service’s core parsing logic.
- Integration: ingest->enrich->persist flow for one example per chain.

Rollout checklist
- Add env vars, run locally.
- Deploy with migration already in place; no DB schema changes expected for Phase 2.
- Monitor logs for provider errors and adjust rate limits accordingly.#   F o r c e   r e d e p l o y   0 9 / 2 8 / 2 0 2 5   0 8 : 3 2 : 4 1  
 