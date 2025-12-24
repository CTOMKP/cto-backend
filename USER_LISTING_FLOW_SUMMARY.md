# User Listing Flow Implementation Summary

## Overview

This document summarizes the implementation of the complete user listing flow, including risk score calculation, Movement wallet payments, and all related components.

## Changes Made

### 1. Backend Risk Score Threshold ✅

**File**: `src/user-listings/user-listings.service.ts`

**Changes**:
- Changed `MAX_RISK = 40` to `MIN_QUALIFYING_SCORE = 50`
- Updated all validation logic to require `risk_score >= 50` for qualification
- Fixed validation messages to be clearer

**Impact**: 
- Tokens with risk_score < 50 are now properly rejected
- Tokens with risk_score >= 50 can proceed to listing creation

### 2. Frontend Risk Score Validation ✅

**Files**:
- `src/components/UserListings/steps/Step1Scan.tsx`
- `src/components/UserListings/CreateUserListingNew.tsx`

**Status**: Already correctly implemented
- Step1Scan checks `risk_score >= 50` before allowing continuation
- Shows error message if score is too low
- Blocks user from proceeding if score < 50

### 3. Movement Payment Flow ✅

**Status**: Already fully implemented

**Components**:
- **Backend**: `src/payment/movement-payment.service.ts`
  - Creates payment records
  - Returns transaction data for Privy signing
  - Verifies payments after transaction confirmation

- **Frontend**: 
  - `src/services/movementPaymentService.ts` - API service
  - `src/components/UserListings/steps/Step3Roadmap.tsx` - Payment integration
  - `src/lib/movement-wallet.ts` - Wallet utilities

**Flow**:
1. User completes listing (scan → details → roadmap)
2. Clicks "Submit Listing"
3. Backend checks for payment
4. If no payment, initiates Movement payment flow
5. Frontend creates payment via Movement payment service
6. Privy prompts user to sign transaction
7. Transaction sent to Movement testnet
8. Backend verifies payment
9. Listing status changes to PENDING_APPROVAL

### 4. Movement Wallet Funding Guide ✅

**File**: `cto-frontend-old-fresh/MOVEMENT_WALLET_FUNDING_GUIDE.md`

**Content**:
- How to get test MOV tokens from faucets
- Payment requirements and amounts
- Troubleshooting guide
- Testing checklist

## Complete User Listing Flow

### Step 1: Token Scan
1. User enters token contract address
2. Selects network (currently supports SOLANA primarily)
3. Clicks "Scan Token"
4. Backend calculates risk score using `ScanService`
5. **Validation**: Risk score must be >= 50 to proceed
6. If score < 50: Error message shown, user cannot proceed
7. If score >= 50: User can continue to Step 2

### Step 2: Listing Details
1. User enters listing information:
   - Title
   - Description
   - Bio (optional)
   - Logo URL (optional)
   - Banner URL (optional)
   - Links (website, twitter, telegram, discord)
2. Creates draft listing in database (status: DRAFT)
3. Draft ID saved to localStorage
4. User can proceed to Step 3

### Step 3: Roadmap
1. User enters roadmap information:
   - Roadmap Title (optional)
   - Roadmap Description (optional)
   - Additional Links (optional)
2. Clicks "Submit Listing (Payment Required Next)"
3. System attempts to publish listing
4. Backend checks for payment:
   - If payment exists: Listing published (status: PENDING_APPROVAL)
   - If no payment: Initiates Movement payment flow

### Step 4: Payment (Movement)
1. Payment creation:
   - Frontend calls `/api/v1/payment/movement/listing/:listingId`
   - Backend creates payment record (status: PENDING)
   - Returns transaction data

2. Transaction signing:
   - Frontend uses Privy to sign transaction
   - Movement transaction sent to testnet
   - Transaction hash received

3. Payment verification:
   - Frontend calls `/api/v1/payment/movement/verify/:paymentId`
   - Backend verifies transaction on blockchain
   - Payment status updated to COMPLETED

4. Listing publication:
   - After payment verified, listing published
   - Status changes to PENDING_APPROVAL
   - Admin can approve/reject

## Risk Score Calculation

### Current Implementation

**Service**: `ScanService` → `risk-scoring.service.ts`

**Formula**: Uses tier-based weighted scoring system
- LP Amount: Weighted by tier
- LP Lock/Burn: Weighted by tier
- Wallet Activity: Weighted by tier
- Smart Contract Security: Weighted by tier

**Note**: The N8N workflow uses `Pillar1RiskScoringService` which implements the exact formula from the N8N workflow. The current `ScanService` uses a different formula. If you want to use the Pillar1RiskScoringService formula, you'll need to update the `ScanService.scanToken` method to use `Pillar1RiskScoringService` instead.

### Scoring System

- **Score Range**: 0-100 (higher = safer)
- **Qualification Threshold**: >= 50
- **Score Levels**:
  - 70-100: Low Risk (safe)
  - 50-69: Medium Risk (acceptable)
  - 0-49: High Risk (rejected)

## Movement Payment Details

### Payment Amount

- **Default**: 1 MOV (100000000 in native units, 8 decimals)
- **Configurable**: Via `MOVEMENT_LISTING_PAYMENT_AMOUNT` environment variable
- **Minimum Balance**: User needs at least 1 MOV + small amount for gas

### Token Details

- **Token**: MOV (Movement native token)
- **Network**: Movement Testnet
- **Decimals**: 8
- **Contract**: Native token (no contract address needed for transfers)

### Admin Wallet

- **Configuration**: `MOVEMENT_ADMIN_WALLET` environment variable
- **Purpose**: Receives all listing payments
- **Required**: Must be set in backend `.env` file

## Testing Checklist

### Prerequisites

- [ ] Backend running on `localhost:3001`
- [ ] Frontend running on `localhost:3000`
- [ ] User registered and logged in via Privy
- [ ] Movement wallet created (automatic via Privy)
- [ ] Movement wallet funded with test MOV tokens

### Test Flow

1. **Token Scan**
   - [ ] Enter valid Solana contract address
   - [ ] Scan completes successfully
   - [ ] Risk score >= 50: Can proceed
   - [ ] Risk score < 50: Blocked with error message

2. **Listing Details**
   - [ ] Enter title and description
   - [ ] Draft listing created successfully
   - [ ] Draft ID saved to localStorage
   - [ ] Can proceed to roadmap step

3. **Roadmap**
   - [ ] Enter roadmap information (optional)
   - [ ] Click "Submit Listing"
   - [ ] Payment flow initiates if no payment exists

4. **Payment**
   - [ ] Payment created successfully
   - [ ] Privy prompts for transaction signature
   - [ ] Transaction signed and submitted
   - [ ] Payment verified successfully
   - [ ] Listing status changes to PENDING_APPROVAL

5. **Verification**
   - [ ] Listing visible in "My Listings"
   - [ ] Status is PENDING_APPROVAL
   - [ ] Payment record exists in database
   - [ ] Payment status is COMPLETED

## Known Issues / Future Improvements

1. **Risk Score Calculation**: Currently using `risk-scoring.service.ts` instead of `Pillar1RiskScoringService`. Consider updating to use Pillar1RiskScoringService for consistency with N8N workflow.

2. **Movement Wallet Funding**: No automated faucet integration in UI. Users must manually request tokens from external faucet. Consider adding a "Request Test Tokens" button in Profile page.

3. **Payment Status Polling**: Currently relies on manual verification after transaction. Consider implementing automatic polling to verify payment status.

4. **Multi-Chain Support**: Currently focused on SOLANA for token scanning. Movement payment works, but token scanning is primarily for Solana tokens.

## Environment Variables Required

### Backend (.env)

```bash
# Movement Payment
MOVEMENT_LISTING_PAYMENT_AMOUNT=100000000  # 1 MOV in native units (8 decimals)
MOVEMENT_ADMIN_WALLET=0x...                # Admin wallet address to receive payments
MOVEMENT_TEST_TOKEN_ADDRESS=0x1::aptos_coin::AptosCoin  # Native token address

# Database
DATABASE_URL=postgresql://...

# Privy
PRIVY_APP_ID=...
PRIVY_APP_SECRET=...

# JWT
JWT_SECRET=...
```

### Frontend (.env)

```bash
REACT_APP_BACKEND_URL=http://localhost:3001
REACT_APP_PRIVY_APP_ID=...
```

## API Endpoints

### User Listings

- `POST /api/v1/user-listings/scan` - Scan token and calculate risk score
- `POST /api/v1/user-listings` - Create draft listing
- `PUT /api/v1/user-listings/:id` - Update draft listing
- `POST /api/v1/user-listings/:id/publish` - Publish listing (requires payment)
- `GET /api/v1/user-listings/mine/all` - Get user's listings
- `GET /api/v1/user-listings/mine/:id` - Get specific user listing

### Movement Payments

- `POST /api/v1/payment/movement/listing/:listingId` - Create listing payment
- `POST /api/v1/payment/movement/verify/:paymentId` - Verify payment transaction

## Support

For issues or questions:
1. Check `MOVEMENT_WALLET_FUNDING_GUIDE.md` for funding issues
2. Check backend logs for payment processing errors
3. Verify Movement testnet explorer for transaction status
4. Contact development team for assistance

