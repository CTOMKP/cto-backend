# CTO Marketplace Complete Backend + Infra Handover
Date: 2026-04-07  
Owner handing over: Emmanuel  
Codebase: `cto-backend-old-fresh`

---

## 1) Executive Summary
This document covers the full backend stack, not only recent work.  
It includes:
- backend architecture and modules
- API surface and route inventory
- database schema and operational SQL
- scheduled jobs and websocket channels
- payments, listings, scan/vetting, messaging, marketplace, XP, escrow
- image/storage (S3), email providers (SendGrid/Resend/SES)
- deployment/runtime (Coolify/Contabo)
- Namecheap DNS + email setup details
- handover/rotation checklist

---

## 2) Repositories, Branches, and Recent Relevant Commits

## 2.1 Backend
- Repo: `https://github.com/CTOMKP/cto-backend`
- Working branch used for recent changes: `backend-auth-scan`
- Recent key commits:
  - `90d045f` Default email provider to sendgrid while keeping SES support
  - `a2e7cc8` Add Amazon SES email provider and keep SendGrid fallback config
  - `ee5b1c2` Improve listing emails with branded template and safer send config
  - `59d6d4e` Send pending-listing email after Movement payment verification
  - `49129d4` Make Movement payment debit idempotent by tx hash
  - `7bc76b9` Route rejected listing notifications to listing detail
  - `e7ba4a4` Add automatic listing lifecycle emails with SendGrid support

## 2.2 Frontend dependency for listing notification links
- Repo: `https://github.com/CTOMKP/cto-frontend`
- Branch: `doye`
- Commit: `0b997e6`
- Why relevant: adds routes used by notifications/emails:
  - `/user-listings/mine`
  - `/user-listings/:id`
  - `/user-listings/:id/live`

---

## 3) Runtime Architecture

## 3.1 Framework and bootstrapping
- NestJS application (`src/main.ts`, `src/app.module.ts`)
- Global config:
  - global prefix: `/api/v1`
  - CORS configured from env
  - validation pipe + global exception filter + response transform interceptor + request logging interceptor
- Health checks:
  - `/health`
  - `/api/v1/health`
- Swagger:
  - `/api/docs` (enabled in non-prod or `ENABLE_SWAGGER=true`)

## 3.2 Core infrastructure layers
- Config: `@nestjs/config`, `.env` chain loading
- DB: Prisma/Postgres
- Schedules: `@nestjs/schedule`
- Websocket: Socket.IO namespace `/ws`
- Storage abstraction: `STORAGE_PROVIDER` with S3 implementation

---

## 4) Full Module Inventory (Backend)
App imports all below in `src/app.module.ts`:
- `AuthModule`
- `PrismaModule`
- `ScanModule`
- `ListingModule`
- `UserListingsModule`
- `PaymentModule`
- `Wallet MovementWalletModule`
- `AdminModule`
- `NotificationsModule`
- `MessagingModule`
- `MarketplaceModule`
- `EscrowModule`
- `XpModule`
- `TradesModule`
- `TokenVettingModule`
- `SentioModule`
- `ImageModule`
- `AssetsModule`
- `MemeModule`
- `PfpModule`
- `WaitlistModule`
- `StatsModule`
- `DuneModule`
- `HealthController` is mounted at app level

---

## 5) API Route Inventory (Controller-Level)
All routes are under `/api/v1` unless explicitly root health.

## 5.1 Auth
Controller base: `auth`
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/google-login`
- `GET /auth/profile`
- `POST /auth/logout`
- `POST /auth/refresh`
- `PUT /auth/users/me`

Privy controller base: `auth/privy`
- `POST /auth/privy/sync`
- `GET /auth/privy/me`
- `POST /auth/privy/verify`
- `POST /auth/privy/create-aptos-wallet`
- `GET /auth/privy/wallets`
- `POST /auth/privy/sync-wallets`

## 5.2 Token listing feed + vetting
Listing controller base: `listing`
- `GET /listing/listings`
- `GET /listing/metrics`
- `GET /listing/:contractAddress`
- `POST /listing/scan`
- `POST /listing/refresh`
- `GET /listing/holders/:contractAddress`
- `GET /listing/transfers/:contractAddress`
- `GET /listing/chart/:contractAddress`
- `POST /listing/refresh-holders`
- `POST /listing/add`
- `POST /listing/delete`

Scan controller base: `scan`
- `POST /scan/scan`
- `POST /scan/scan-batch`

## 5.3 User listings (submit/moderate flow)
Controller base: `user-listings`
- `GET /user-listings`
- `GET /user-listings/:id`
- `POST /user-listings/scan`
- `GET /user-listings/mine/all`
- `GET /user-listings/mine/:id`
- `POST /user-listings`
- `PUT /user-listings/:id`
- `POST /user-listings/:id/publish`
- `POST /user-listings/:id/ads`
- `DELETE /user-listings/:id`

## 5.4 Movement payments
Controller base: `payment/movement`
- `POST /payment/movement/listing/:listingId`
- `POST /payment/movement/escrow/:escrowId`
- `POST /payment/movement/verify/:paymentId`

## 5.5 Movement wallets
Controller base: `wallet/movement`
- `GET /wallet/movement/balance/:walletId`
- `POST /wallet/movement/sync/:walletId`
- `GET /wallet/movement/transactions/:walletId`
- `POST /wallet/movement/poll/:walletId`

## 5.6 Admin
Controller base: `admin` (JWT + admin guards)
- listing moderation:
  - `GET /admin/listings/pending`
  - `GET /admin/listings/published`
  - `GET /admin/listings/rejected`
  - `POST /admin/listings/approve`
  - `POST /admin/listings/reject`
- users:
  - `GET /admin/users`
  - `POST /admin/users/update-role`
- dashboard/stats:
  - `GET /admin/dashboard/stats`
  - `GET /admin/payments`
  - `GET /admin/ad-boosts/active`
- marketplace ad moderation:
  - `GET /admin/marketplace-ads/pending`
  - `GET /admin/marketplace-ads/published`
  - `GET /admin/marketplace-ads/rejected`
  - `POST /admin/marketplace-ads/approve`
  - `POST /admin/marketplace-ads/reject`
- escrow admin operations:
  - `GET /admin/escrows`
  - `POST /admin/escrows/release`
  - `POST /admin/escrows/refund`
  - `POST /admin/escrows/extend`
  - `POST /admin/escrows/freeze`
  - `POST /admin/escrows/unfreeze`
  - `POST /admin/escrows/flag`
  - `POST /admin/escrows/resolve-dispute`

## 5.7 Notifications
Controller base: `notifications`
- `GET /notifications`
- `POST /notifications/:id/read`
- `POST /notifications/read-all`
- `DELETE /notifications/:id`

## 5.8 Messaging
Controller base: `messages`
- `POST /messages/apply/:adId`
- `GET /messages/threads`
- `GET /messages/threads/:id`
- `POST /messages/threads/:id/messages`
- `POST /messages/threads/:id/read`
- `POST /messages/reactions/:id`

## 5.9 Marketplace
Controller base: `marketplace`
- `GET /marketplace/pricing`
- `GET /marketplace/ads`
- `GET /marketplace/ads/trending`
- `GET /marketplace/ads/for-you`
- `POST /marketplace/ads`
- `PUT /marketplace/ads/:id`
- `GET /marketplace/ads/mine`
- `GET /marketplace/ads/:id`
- `POST /marketplace/ads/:id/pay`
- `POST /marketplace/ads/payments/:paymentId/verify`
- `POST /marketplace/ads/:id/extend`
- `POST /marketplace/ads/:id/sold`
- `POST /marketplace/ads/:id/share`

## 5.10 XP
Controller base: `xp`
- `GET /xp/me`

## 5.11 Escrow
Controller base: `escrow`
- `POST /escrow/offer`
- `GET /escrow/conversation/:conversationId`
- `GET /escrow/:id`
- `POST /escrow/:id/accept`
- `POST /escrow/:id/decline`
- `POST /escrow/:id/fund`
- `POST /escrow/:id/submit`
- `POST /escrow/:id/release`
- `POST /escrow/:id/refund`
- `POST /escrow/:id/cancel`
- `POST /escrow/:id/review`
- `POST /escrow/:id/dispute-response`

## 5.12 Trades
Controller base: `trades`
- `GET /trades/my-trades`
- `POST /trades/quote`
- `POST /trades/build-transaction`
- `POST /trades/execute`
- `POST /trades/sentio-webhook`

## 5.13 Image/Assets/Memes/PFP
Image base: `images`
- `POST /images/presign`
- `GET /images/ping`
- `GET /images/view/**`
- `GET /images/download/*key`
- `GET /images/test/*key`
- `GET /images`
- `DELETE /images/*key`
- `PUT /images/:id`

Assets base: `assets`
- `GET /assets/*path`

Memes base: `memes`
- `POST /memes/presign`
- `GET /memes`
- `GET /memes/:id/download`
- `GET /memes/:id`
- `PUT /memes/:id`
- `DELETE /memes/:id`
- `POST /memes/bulk-import`
- `GET /memes/:id/verify-s3`

PFP base: `pfp`
- `POST /pfp/save`

 5.14 Waitlist
Controller base: `waitlist`
- `POST /waitlist`
- `GET /waitlist`
- `GET /waitlist/count`

 5.15 Stats/Dune/Sentio
Stats base: `stats`
- `GET /stats/memecoin`

Dune controller also uses `stats` base
- `GET /stats/memecoin`
- `POST /stats/memecoin/refresh`

Sentio controller base: `tokens`
- `GET /tokens/:address/trades`

 5.16 Legacy (still present in codebase)
Circle base: `circle`  
Funding base: `funding`  
Transfers base: `transfers`  
Legacy payment base: `payment`, `payment/privy`

These include old Circle/Privy payment and transfer flows and should be considered technical debt unless still used by active frontend paths.

---

 6) WebSocket Inventory
Namespace for all gateways: `/ws`

 6.1 ListingGateway
- emits:
  - `listing.new`
  - `listing.update`

 6.2 NotificationsGateway
- subscribe event:
  - client emits `notifications.subscribe` with JWT
- server emits:
  - `notifications.subscribed`
  - `notifications.new`
  - `notifications.error`
- room model:
  - user room: `user:{userId}`

 6.3 TradesGateway
- client events:
  - `trades.subscribe`
  - `trades.unsubscribe`
- server events:
  - `trades.update`
  - `trades.error`
- room model:
  - `trades:{chain}:{tokenAddress}`
- polling interval: every 2 seconds per active room

---

 7) Scheduled Jobs (Cron)

 7.1 Pillar 1 / Listing refresh worker
- File: `src/listing/workers/refresh.worker.ts`
- Job: `pillar1-vet-tokens`
- Cron: `5,15,25,35,45,55 * * * *`
- Purpose: process unvetted tokens and trigger risk/vetting flow

 7.2 Pillar 2 monitoring
- File: `src/services/cron.service.ts`
- Job: `pillar2-token-monitoring`
- Cron: `0,30 * * * *`
- Purpose: monitor already vetted listings in batches

 7.3 Movement wallet sync
- File: `src/wallet/movement-wallet-cron.service.ts`
- Cron: `0 */5 * * * *`
- Purpose: sync balances + detect new wallet txs

 7.4 Trade sync (Sentio to UserTrade)
- File: `src/trades/trade-sync-cron.service.ts`
- Cron: `0 */5 * * * *`
- Purpose: sync indexed trades into local DB

 7.5 Marketplace expiry
- File: `src/marketplace/marketplace-cron.service.ts`
- Cron: `0 2 * * *`
- Purpose: flag expiry notices and expire ads

## 7.6 Escrow deadline automation
- File: `src/escrow/escrow-cron.service.ts`
- Cron: `0 * * * * *` (every minute)
- Purpose: process expired escrow deadline transitions

## 7.7 XP account age milestones
- File: `src/xp/xp-cron.service.ts`
- Cron: `0 10 0 * * *`
- Purpose: award account-age rank milestones

---

## 8) Database / Prisma Complete Inventory

## 8.1 Schema source
- `prisma/schema.prisma`

## 8.2 Models
- `User`
- `ScanResult`
- `Listing`
- `Wallet`
- `UserListing`
- `AdBoost`
- `Meme`
- `Waitlist`
- `Payment`
- `MarketplaceAd`
- `MarketplaceAdInteraction`
- `MarketplacePricing`
- `Conversation`
- `Message`
- `MessageReaction`
- `Escrow`
- `EscrowMilestone`
- `XpTransaction`
- `RankScoreTransaction`
- `Notification`
- `WalletBalance`
- `WalletTransaction`
- `MonitoringSnapshot`
- `Alert`
- `UserTrade`
- `PendingOrder`

## 8.3 Enums
- `UserRole`
- `Chain`
- `ListingCategory`
- `PaymentType`
- `PaymentStatus`
- `MarketplaceAdStatus`
- `MarketplacePostType`
- `MarketplaceTier`
- `MarketplacePricingKind`
- `ConversationStatus`
- `MessageType`
- `EscrowStatus`
- `NotificationType`

## 8.4 Operational SQL snippets

### List users
```sql
SELECT id, email, name, role, "createdAt"
FROM "User"
ORDER BY id;
```

### List users + wallets
```sql
SELECT
  u.id, u.email, u.name,
  w.id AS wallet_id, w.address, w.blockchain, w."isPrimary", w."createdAt"
FROM "User" u
LEFT JOIN "Wallet" w ON w."userId" = u.id
ORDER BY u.id, w."isPrimary" DESC, w."createdAt" DESC;
```

### Find user by wallet
```sql
SELECT u.id, u.email, u.name, w.address, w.blockchain, w."isPrimary"
FROM "Wallet" w
JOIN "User" u ON u.id = w."userId"
WHERE lower(w.address) = lower('<wallet_address>');
```

### Recent user listings
```sql
SELECT l.id, l.title, l.status, l.chain, l."contractAddr", l."createdAt", u.email
FROM "UserListing" l
JOIN "User" u ON u.id = l."userId"
ORDER BY l."createdAt" DESC
LIMIT 50;
```

### Payments status audit
```sql
SELECT id, "userId", "paymentType", status, amount, currency, "txHash", "createdAt", "completedAt"
FROM "Payment"
ORDER BY "createdAt" DESC
LIMIT 100;
```

---

## 9) Scan and Vetting System Coverage

## 9.1 Chains supported in practice
- SOLANA (primary live vetting)
- APTOS (added/hardened with confidence gates and fallbacks)
- EVM coverage exists across listing/trades modules (ETH, BASE, BSC etc.) for quote/trade/listing metadata paths

## 9.2 Providers used across scan/listing stack
- DexScreener
- GeckoTerminal
- CoinGecko
- Panora (Aptos)
- Aptos fullnode/indexer
- Helius/Solscan (Solana contexts)
- optional integrations: Moralis, Birdeye, Dune, Sentio, Shyft, Blockvision, Bitquery, OneInch, Alchemy, Etherscan, etc.

## 9.3 Aptos-specific controls implemented
- strict date handling toggle
- required confidence fields
- Aptos min qualifying score override
- holder/volume/liquidity sanity checks
- fallback market sources when primary provider misses data

---

## 10) Payments + Listing Approval Flow (Current)

## 10.1 Primary path now
1. User scans token (`/user-listings/scan`)
2. User creates DRAFT listing (`/user-listings`)
3. User creates payment (`/payment/movement/listing/:listingId`)
4. Frontend signs tx
5. Backend verifies tx (`/payment/movement/verify/:paymentId`)
6. Listing transitions to `PENDING_APPROVAL`
7. Pending notification/email sent
8. Admin approves/rejects
9. Approval/rejection notification sent
10. Approval email sent with direct link

## 10.2 Reliability fix
- Tx debit/record logic is idempotent on `walletId + txHash`.

---

## 11) Email System (Complete Status)

## 11.1 Implemented providers
- `sendgrid`
- `resend`
- `ses`

## 11.2 Runtime switch
- Use env: `EMAIL_PROVIDER`
- No code change required to switch provider.

## 11.3 Current default behavior
- If `EMAIL_PROVIDER` missing, fallback defaults to `sendgrid`.

## 11.4 Lifecycle emails implemented
- pending listing email
- approved listing email
- branded HTML templates + text fallback
- CTA links include profile/listing/live pages

## 11.5 Provider switch examples

### SendGrid active
```env
EMAIL_ENABLED=true
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=...
EMAIL_FROM=no-reply@ctomarketplace.com
EMAIL_REPLY_TO=support@ctomarketplace.com
FRONTEND_BASE_URL=https://www.ctomarketplace.com
```

### SES active
```env
EMAIL_ENABLED=true
EMAIL_PROVIDER=ses
EMAIL_FROM=no-reply@ctomarketplace.com
EMAIL_REPLY_TO=support@ctomarketplace.com
FRONTEND_BASE_URL=https://www.ctomarketplace.com
SES_AWS_REGION=...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
SES_FROM_ARN=
SES_CONFIGURATION_SET=
AWS_SESSION_TOKEN=
```

---

## 12) AWS S3 / Image Infrastructure

## 12.1 What exists
- S3-backed storage provider (`S3StorageService`)
- presigned PUT for uploads
- presigned GET / proxy/fallback for views/download
- CDN-aware URL generation if `ASSETS_CDN_BASE` set

## 12.2 Main files
- `src/storage/s3-storage.service.ts`
- `src/storage/storage.provider.ts`
- `src/image/image.controller.ts`
- `src/image/image.service.ts`
- `src/assets/assets.controller.ts`

## 12.3 Required env
- `AWS_REGION`
- `AWS_S3_BUCKET_NAME`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- optional: `ASSETS_CDN_BASE`, `CLOUDFRONT_DOMAIN`

---

## 13) Coolify / Server / Runtime Notes

## 13.1 Platform
- Coolify-managed backend on Contabo VPS.

## 13.2 Build and start
- Build command: `npm run build`
- Runtime start in `package.json`:
  - `prisma migrate deploy && node dist/main`

## 13.3 Health probes
- `/health`
- `/api/v1/health`

## 13.4 Deploy sequence
1. Update env vars in Coolify
2. Redeploy service
3. Check health endpoint
4. Run smoke tests for core flows

## 13.5 Smoke tests (minimum)
- auth profile request works
- user listing scan/create works
- payment verify updates listing
- admin approve/reject works
- notification click routes are correct
- pending + approved emails deliver

---

## 14) Namecheap + DNS + Mail Configuration

## 14.1 Domain and website records in use
- `A @ -> 84.54.23.80`
- `A api -> 84.54.23.80`
- `A links -> 84.54.23.80`
- `A n8n -> 84.54.23.80`
- `A www -> 84.54.23.80`

## 14.2 SendGrid domain auth records
- `CNAME em8911 -> u82871072.wl073.sendgrid.net`
- `CNAME s1._domainkey -> s1.domainkey.u82871072.wl073.sendgrid.net`
- `CNAME s2._domainkey -> s2.domainkey.u82871072.wl073.sendgrid.net`
- `CNAME url5875 -> sendgrid.net`
- `CNAME 82871072 -> sendgrid.net`
- `TXT _dmarc -> v=DMARC1; p=none;`

## 14.3 Namecheap private email records
- `MX @ -> mx1.privateemail.com` (priority 10)
- `MX @ -> mx2.privateemail.com` (priority 10)
- `TXT @ -> v=spf1 include:spf.privateemail.com include:sendgrid.net ~all`

## 14.4 Mailbox/alias setup used for app mail
- mailbox: `support@ctomarketplace.com`
- alias: `no-reply@ctomarketplace.com`

---

## 15) Environment Variables Master Index

## 15.1 Variables from `.env.example`
- `REACT_APP_PRIVY_APP_ID`
- `PORT`, `NODE_ENV`, `CORS_ORIGINS`, `BACKEND_BASE_URL`, `KEEP_ALIVE_INTERVAL`
- `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`
- `CIRCLE_ENV`, `CIRCLE_API_KEY`, `CIRCLE_WEB_CLIENT_ID`
- DB vars: `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`, `DATABASE_URL`
- Solana/Aptos scan vars and keys:
  - `HELIUS_API_KEY`, `SOLSCAN_API_KEY`
  - `APTOS_NETWORK`, `APTOS_FULLNODE_URL`, `APTOS_INDEXER_URL`
  - `APTOS_STRICT_DATE`, `APTOS_CONFIDENCE_REQUIRED_FIELDS`, `APTOS_MIN_QUALIFYING_SCORE`
  - `APTOS_API_KEY`, `APTOS_INDEXER_API_KEY`
  - `GEOMI_API_KEY`, `GEOMI_FULLNODE_URL`, `GEOMI_INDEXER_URL`
  - `GECKOTERMINAL_BASE_URL`, `COINGECKO_BASE_URL`, `COINGECKO_API_KEY`
  - `PANORA_BASE_URL`, `PANORA_API_KEY`, `PANORA_API_SECRET`
- Redis vars: `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB`
- Email vars:
  - `EMAIL_ENABLED`, `EMAIL_PROVIDER`, `EMAIL_FROM`, `EMAIL_REPLY_TO`
  - `SENDGRID_API_KEY`, `RESEND_API_KEY`
  - SES: `SES_AWS_REGION`, `SES_FROM_ARN`, `SES_CONFIGURATION_SET`
  - AWS creds: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`
  - `FRONTEND_BASE_URL`

## 15.2 Additional vars referenced in codebase (advanced/optional)
Examples:
- `AWS_REGION`, `AWS_S3_BUCKET_NAME`, `ASSETS_CDN_BASE`
- `MORALIS_API_KEY`, `BIRDEYE_API_KEY`, `DUNE_API_KEY`, `SENTIO_API_KEY`
- `ONEINCH_API_KEY`, `ALCHEMY_API_KEY`, `ETHERSCAN_API_KEY`
- `TOKEN_MONITORING_ENABLED`, `TOKEN_MONITORING_BATCH_SIZE`
- `MOVEMENT_RPC_URL`, `MOVEMENT_ADMIN_WALLET`, `MOVEMENT_TEST_TOKEN_ADDRESS`
- and others in integrations/trading modules.

---

## 16) Security and Operational Risks

## 16.1 Immediate actions
- Rotate any exposed keys/tokens:
  - SendGrid API keys
  - JWTs
  - AWS keys

## 16.2 Recommendations
- keep secrets only in Coolify/vault
- enable provider-level webhooks (bounces/complaints)
- add fallback/circuit breaker for provider rotation if required by product
- formalize change lock before infra work

---

## 17) Known Gaps / Constraints
- Some legacy Circle/Privy payment controllers still exist; clarify if still in active frontend use.
- Frontend must include `/user-listings/:id/live` and related routes to avoid 404 on notification/email CTA.
- Aptos data quality still depends on external provider uptime and response consistency.

---

## 18) Handover Checklist (Transfer Completion)
- [ ] Backend repo/branch and commit history shared
- [ ] Coolify service access shared
- [ ] Production env vars shared in secure channel
- [ ] Database access/shared SQL runbook handed over
- [ ] S3 bucket + IAM ownership/credentials transferred
- [ ] SES/SendGrid account access + DNS ownership transferred
- [ ] Namecheap DNS + mailbox ownership transferred
- [ ] Smoke tests executed live with receiver
- [ ] Secret rotation completed post-transfer

---

## 19) Final Notes
Current backend is in a switchable email-provider state:
- SendGrid active by config today
- SES implemented and can be enabled by env switch
- No code rollback needed for provider switching

This handover should be treated as the baseline operational map for whoever picks up backend, infra, and platform operations.

Tokens to test swap (real Solana mainnet)
Use these for Jupiter swap tests:

USDC mint (mainnet):
EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v (solana.stackexchange.com)

Wrapped SOL (for SOL/USDC pairs):
So11111111111111111111111111111111111111112 (solana.com)

BONK mint (popular meme token):
DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 (solflare.com)

If you want a different token, tell me the symbol and I’ll verify the mint.

