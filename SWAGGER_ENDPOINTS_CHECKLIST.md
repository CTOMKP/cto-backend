# Swagger Endpoints Verification Checklist

## Token Types Clarification

### Privy Token (ES256 algorithm)
- Starts with: `eyJhbGciOiJFUzI1NiIs...` (ES256 = ECDSA)
- Used for: `/api/auth/privy/verify`, `/api/auth/privy/sync`
- Get from: Browser cookies (`privy-token=...`) or `await window.privy.getAccessToken()`

### JWT Token (HS256 algorithm)  
- Starts with: `eyJhbGciOiJIUzI1NiIs...` (HS256 = HMAC)
- Used for: All other protected endpoints (`/me`, `/wallets`, `/sync-wallets`, etc.)
- Get from: Response of `/api/auth/privy/sync` or `/api/auth/login`

---

## Complete Endpoint List

### Authentication (Traditional)
- [x] `POST /api/auth/register` - Register new user
- [x] `POST /api/auth/login` - Login with email/password
- [x] `POST /api/auth/google-login` - Google OAuth login
- [x] `GET /api/auth/profile` - Get user profile (JWT required)
- [x] `POST /api/auth/logout` - Logout
- [x] `POST /api/auth/refresh` - Refresh JWT token

### PrivyAuth
- [x] `POST /api/auth/privy/sync` - Sync user from Privy (Privy token required)
- [x] `GET /api/auth/privy/me` - Get current user info (JWT required) ✅ Fixed
- [x] `POST /api/auth/privy/verify` - Verify Privy token (Privy token required)
- [x] `POST /api/auth/privy/create-aptos-wallet` - Create Aptos wallet (JWT required, deprecated)
- [x] `GET /api/auth/privy/wallets` - Get user wallets (JWT required)
- [x] `POST /api/auth/privy/sync-wallets` - Sync wallets from Privy (JWT required)

### Circle Programmable Wallets
- [ ] `POST /api/circle/users` - Create Circle user
- [ ] `POST /api/circle/users/login` - Circle user login
- [ ] `POST /api/circle/users/forgot-password` - Reset password
- [ ] `POST /api/circle/users/token` - Get Circle token
- [ ] `POST /api/circle/users/initialize` - Initialize Circle user
- [ ] `POST /api/circle/wallets` - Create Circle wallet
- [ ] `GET /api/circle/users/:userId/wallets` - Get user wallets
- [ ] `GET /api/circle/wallets/:walletId/balances` - Get wallet balances
- [ ] `GET /api/circle/wallets/:walletId/transactions` - Get wallet transactions
- [ ] `GET /api/circle/transactions/recent` - Get recent transactions

### Transfers
- [ ] `POST /api/transfers/cctp` - CCTP transfer
- [ ] `POST /api/transfers/wormhole/attestation` - Wormhole attestation
- [ ] `POST /api/transfers/wormhole/redeem` - Wormhole redeem
- [ ] `POST /api/transfers/panora/swap` - Panora swap
- [ ] `GET /api/transfers/status/:transactionId` - Get transfer status

### Funding
- [ ] `GET /api/funding/methods/:userId` - Get funding methods
- [ ] `POST /api/funding/deposit` - Create deposit
- [ ] `GET /api/funding/deposit/:depositId/status` - Get deposit status
- [ ] `GET /api/funding/balance/:userId` - Get user balance
- [ ] `POST /api/funding/withdraw` - Create withdrawal
- [ ] `GET /api/funding/withdraw/:withdrawalId/status` - Get withdrawal status

### Token Scanning
- [ ] `POST /api/scan/scan` - Scan a token
- [ ] `POST /api/scan/scan-batch` - Batch scan tokens

### Listing
- [ ] `GET /api/listing/listings` - Get paginated listings
- [ ] `GET /api/listing/metrics` - Get listing metrics
- [ ] `GET /api/listing/:contractAddress` - Get listing by contract
- [ ] `POST /api/listing/scan` - Scan and create listing (JWT required)
- [ ] `POST /api/listing/refresh` - Refresh listing (JWT required)
- [ ] `GET /api/listing/holders/:contractAddress` - Get token holders
- [ ] `GET /api/listing/transfers/:contractAddress` - Get transfers
- [ ] `GET /api/listing/chart/:contractAddress` - Get chart data
- [ ] `POST /api/listing/refresh-holders` - Refresh holders

### UserListings
- [ ] `GET /api/user-listings` - Get user listings
- [ ] `GET /api/user-listings/:id` - Get listing by ID
- [ ] `POST /api/user-listings/scan` - Scan token for listing
- [ ] `GET /api/user-listings/mine/all` - Get all my listings
- [ ] `GET /api/user-listings/mine/:id` - Get my listing by ID
- [ ] `POST /api/user-listings` - Create listing (JWT required)
- [ ] `PUT /api/user-listings/:id` - Update listing (JWT required)
- [ ] `POST /api/user-listings/:id/publish` - Publish listing (JWT required)
- [ ] `POST /api/user-listings/:id/ads` - Create ad boost (JWT required)
- [ ] `DELETE /api/user-listings/:id` - Delete listing (JWT required)

### Waitlist
- [ ] `POST /api/waitlist` - Join waitlist (Public)
- [ ] `GET /api/waitlist` - Get all entries (Admin, JWT required)
- [ ] `GET /api/waitlist/count` - Get waitlist count (Admin, JWT required)

### Stats
- [ ] `GET /api/stats/memecoin` - Get memecoin stats (Public)

### Dune
- [ ] `GET /api/dune/memecoin` - Get Dune memecoin stats
- [ ] `POST /api/dune/memecoin/refresh` - Refresh Dune stats

### Memes
- [ ] `POST /api/memes/presign` - Get presigned URL for upload (JWT required)
- [ ] `GET /api/memes` - Get all memes (Public)
- [ ] `GET /api/memes/:id/download` - Download meme (Public)
- [ ] `GET /api/memes/:id` - Get meme by ID (Public)
- [ ] `PUT /api/memes/:id` - Update meme (JWT required)
- [ ] `DELETE /api/memes/:id` - Delete meme (JWT required)
- [ ] `POST /api/memes/bulk-import` - Bulk import memes (JWT required)
- [ ] `GET /api/memes/:id/verify-s3` - Verify S3 file exists (JWT required)

### Images
- [ ] `POST /api/images/presign` - Get presigned URL (JWT required)
- [ ] `GET /api/images/view/*key` - View image (Public)
- [ ] `GET /api/images/download/*key` - Download image (Public)
- [ ] `GET /api/images` - List images (JWT required)
- [ ] `DELETE /api/images/*key` - Delete image (JWT required)
- [ ] `PUT /api/images/:id` - Update image (JWT required)

### Assets
- [ ] `GET /api/assets/*path` - Serve static assets (Public)

### Payment
- [ ] `GET /api/payment/pricing` - Get pricing info
- [ ] `POST /api/payment/listing` - Create listing payment (JWT required)
- [ ] `POST /api/payment/ad-boost` - Create ad boost payment (JWT required)
- [ ] `GET /api/payment/verify/:paymentId` - Verify payment
- [ ] `GET /api/payment/history/:userId` - Get payment history (JWT required)

### Privy Payment
- [ ] `POST /api/payment/privy/listing` - Create Privy listing payment
- [ ] `POST /api/payment/privy/verify/:paymentId` - Verify Privy payment

### Admin
- [ ] `GET /api/admin/dashboard/stats` - Get dashboard stats (Admin, JWT required)
- [ ] `GET /api/admin/listings/pending` - Get pending listings (Admin, JWT required)
- [ ] `GET /api/admin/listings/published` - Get published listings (Admin, JWT required)
- [ ] `POST /api/admin/listings/approve` - Approve listing (Admin, JWT required)
- [ ] `POST /api/admin/listings/reject` - Reject listing (Admin, JWT required)
- [ ] `GET /api/admin/payments` - Get all payments (Admin, JWT required)
- [ ] `GET /api/admin/ad-boosts/active` - Get active ad boosts (Admin, JWT required)
- [ ] `POST /api/admin/users/update-role` - Update user role (Admin, JWT required)

### Health
- [ ] `GET /api/health/health` - Health check (Public)

---

## Issues Found

1. ✅ `/api/auth/privy/me` - Fixed: Changed from PrivyAuthGuard to JwtAuthGuard
2. ⚠️ `/api/auth/privy/verify` - Description updated to clarify it needs Privy token, not JWT
3. ⚠️ Need to verify all endpoints have proper Swagger decorators
4. ⚠️ Need to verify all examples use correct token types

---

## Next Steps

1. Verify all controllers have `@ApiTags`
2. Verify all endpoints have `@ApiOperation` with clear descriptions
3. Verify all protected endpoints have `@ApiBearerAuth('JWT-auth')`
4. Verify all request/response examples are correct
5. Test each endpoint category systematically

