# Hybrid Wallet System: Privy + Aptos

## Overview
This implementation provides a **hybrid wallet solution** that combines:
- ✅ **Privy** for authentication and EVM/Solana wallets
- ✅ **Server-generated Aptos wallets** for Aptos chain payments

## Architecture

### How It Works

```
User Login (Privy)
    ↓
Backend Sync Endpoint
    ↓
1. Verify Privy Token
2. Create/Update User in DB
3. Sync Privy Wallets (EVM, Solana)
4. AUTO-CREATE Aptos Wallet (server-side)
    ↓
User Has All Wallets:
  - Ethereum (Privy)
  - Solana (Privy)  
  - Aptos (Server-generated)
```

## Key Components

### Backend

#### 1. **AptosWalletService** (`src/auth/aptos-wallet.service.ts`)
- Generates Aptos wallets using `@aptos-labs/ts-sdk`
- Encrypts private keys with AES-256-GCM
- Stores encrypted keys in database
- Provides wallet retrieval for transactions

#### 2. **Privy Auth Controller** (Updated)
- Auto-creates Aptos wallet during sync
- Returns all wallets (Privy + Aptos) to frontend
- Manual creation endpoint still available

#### 3. **Database Schema** (Updated)
```prisma
model Wallet {
  // ... existing fields
  encryptedPrivateKey  String?  // NEW: For Aptos wallets
  walletClient         String?  // e.g., "APTOS_EMBEDDED"
}
```

### Frontend

#### 1. **PrivyLoginPage** (Updated)
- Saves all wallets to localStorage after sync
- Includes Aptos wallet in saved data

#### 2. **PrivyProfilePage** (Updated)
- Displays all wallets (Privy + Aptos)
- Shows Aptos wallet with 🅰️ icon
- Manual creation button (if auto-creation failed)

## Environment Variables

### Required
```env
# Privy Configuration
PRIVY_APP_ID=cmgv7721s00s3l70cpci2e2sa
PRIVY_APP_SECRET=your-secret

# Aptos Wallet Encryption (IMPORTANT!)
APTOS_WALLET_ENCRYPTION_KEY=your-secure-32-byte-key-change-in-production

# Database
DATABASE_URL=postgresql://...
```

## Security Features

### 1. **Private Key Encryption**
- Uses AES-256-GCM (authenticated encryption)
- Random IV for each encryption
- Auth tag prevents tampering
- Encryption key from environment variable

### 2. **Key Storage**
- Private keys NEVER sent to frontend
- Backend signs transactions server-side
- Frontend only sees public addresses

## API Endpoints

### POST `/api/auth/privy/sync`
**Purpose:** Sync user after Privy login

**Request:**
```json
{
  "privyToken": "eyJhbGci..."
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": 5,
    "email": "user@example.com",
    "walletsCount": 3
  },
  "token": "jwt-token",
  "wallets": [
    {
      "address": "0x1234...",
      "chainType": "ethereum",
      "walletClient": "privy"
    },
    {
      "address": "So1...",
      "chainType": "solana",
      "walletClient": "privy"
    },
    {
      "address": "0xaptos...",
      "chainType": "aptos",
      "walletClient": "APTOS_EMBEDDED"
    }
  ]
}
```

### POST `/api/auth/privy/create-aptos-wallet`
**Purpose:** Manually create Aptos wallet (if auto-creation failed)

**Request:**
```json
{
  "userId": 5
}
```

**Response:**
```json
{
  "success": true,
  "wallet": {
    "address": "0xaptos...",
    "chainType": "aptos"
  }
}
```

## User Flow

### 1. **Login**
```
User clicks "Login with Privy"
  ↓
Privy modal appears (Email/Wallet/Social)
  ↓
User authenticates
  ↓
Frontend calls backend /sync
  ↓
Backend creates Aptos wallet automatically
  ↓
Frontend saves all wallets to localStorage
  ↓
User redirected to profile
```

### 2. **Profile Page**
```
Shows all wallets:
  ⟠ Ethereum: 0x1234...
  ◎ Solana: So1...
  🅰️ Aptos: 0xaptos...
```

### 3. **Payments**
```
User pays for listing
  ↓
Chooses payment chain (EVM or Aptos)
  ↓
If Aptos: Backend uses server wallet to sign
If EVM: Frontend uses Privy wallet
```

## Migration Steps (For Railway)

### 1. Run Migration
```bash
npx prisma migrate deploy
```

### 2. Add Environment Variable
```bash
# In Railway dashboard:
APTOS_WALLET_ENCRYPTION_KEY=your-secure-32-byte-key-change-in-production
```

### 3. Deploy
Push to GitHub → Railway auto-deploys

## Testing Locally

### 1. Start Backend
```bash
cd cto-backend
npm run start:dev
```

### 2. Start Frontend
```bash
cd cto-frontend
npm start
```

### 3. Test Flow
1. Go to http://localhost:3000/login
2. Click "Login with Privy"
3. Authenticate with email
4. Check console logs for Aptos wallet creation
5. Go to Profile → see all 3 wallets

## Advantages of This Approach

### ✅ **User Experience**
- Single login (Privy)
- All wallets created automatically
- No manual setup required

### ✅ **Security**
- Private keys encrypted at rest
- Backend controls Aptos transactions
- No risk of users losing Aptos keys

### ✅ **Hackathon Ready**
- Aptos support without waiting for Privy
- Payments work on Aptos chain
- Multi-chain from day one

### ✅ **Future Proof**
- Can switch to Privy's Aptos support later
- Modular architecture
- Easy to extend to other chains

## Troubleshooting

### Issue: Aptos wallet not created
**Check:**
1. `APTOS_WALLET_ENCRYPTION_KEY` is set
2. Database migration applied
3. Backend logs show wallet creation

### Issue: Private key decryption fails
**Solution:**
1. Ensure same encryption key on all environments
2. Re-generate wallets if key changed

### Issue: Wallet not showing in profile
**Check:**
1. localStorage has `cto_user_wallets`
2. Backend sync response includes Aptos wallet
3. Frontend loads wallets on mount

## Next Steps

1. ✅ Test payment flow with Aptos wallet
2. ✅ Add transaction signing for Aptos payments
3. ✅ Deploy to Railway with encryption key
4. ✅ Test end-to-end user flow
5. Monitor for any Aptos wallet issues

## Support

For issues, check:
- Backend logs: `npm run start:dev`
- Frontend console: Browser DevTools
- Database: `npx prisma studio`

