# Environment Variables Setup for Testing

## 🧪 Current Admin Wallet Configuration

The default admin wallet (where payments are received) is:
```
0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1
```

This is a **FALLBACK** value. You can override it with environment variables.

---

## 📝 How to Set Your Own Wallet for Testing

### Option 1: Use `.env` file (Recommended for Local Testing)

Create a `.env` file in `cto-backend/` with your wallet addresses:

```bash
# Admin wallet addresses (where payments are received)
ADMIN_WALLET_ETHEREUM=YOUR_ETHEREUM_ADDRESS_HERE
ADMIN_WALLET_POLYGON=YOUR_POLYGON_ADDRESS_HERE
ADMIN_WALLET_BASE=YOUR_BASE_ADDRESS_HERE
ADMIN_WALLET_ARBITRUM=YOUR_ARBITRUM_ADDRESS_HERE
ADMIN_WALLET_OPTIMISM=YOUR_OPTIMISM_ADDRESS_HERE
ADMIN_WALLET_SOLANA=YOUR_SOLANA_ADDRESS_HERE
ADMIN_WALLET_APTOS=YOUR_APTOS_ADDRESS_HERE

# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/cto_db

# Privy
PRIVY_APP_ID=cmgv7721s00s3l70cpci2e2sa
PRIVY_APP_SECRET=your_privy_app_secret_here

# JWT
JWT_SECRET=your_jwt_secret_here

# Aptos Wallet Encryption (32 characters)
APTOS_WALLET_ENCRYPTION_KEY=12345678901234567890123456789012

# Solana RPC Configuration (for real blockchain data)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

### Option 2: Use the Same Wallet for All Chains

If you want to use ONE wallet address for testing all EVM chains (Ethereum, Polygon, Base, Arbitrum, Optimism):

```bash
ADMIN_WALLET_ETHEREUM=0xYourWalletAddress
ADMIN_WALLET_POLYGON=0xYourWalletAddress
ADMIN_WALLET_BASE=0xYourWalletAddress
ADMIN_WALLET_ARBITRUM=0xYourWalletAddress
ADMIN_WALLET_OPTIMISM=0xYourWalletAddress
```

**Note:** The same EVM wallet address works on ALL EVM chains (Ethereum, Polygon, Base, Arbitrum, Optimism).

---

## 🔍 Where Is This Used?

File: `src/payment/privy-payment.service.ts` (lines 27-35)

```typescript
private readonly ADMIN_WALLETS = {
  ethereum: process.env.ADMIN_WALLET_ETHEREUM || '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
  polygon: process.env.ADMIN_WALLET_POLYGON || '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
  base: process.env.ADMIN_WALLET_BASE || '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
  arbitrum: process.env.ADMIN_WALLET_ARBITRUM || '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
  optimism: process.env.ADMIN_WALLET_OPTIMISM || '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
  solana: process.env.ADMIN_WALLET_SOLANA || 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH',
  aptos: process.env.ADMIN_WALLET_APTOS || '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
};
```

---

## 🚀 For Railway (Production)

Set these environment variables in your Railway dashboard:
1. Go to Railway project
2. Click on your backend service
3. Go to "Variables" tab
4. Add each `ADMIN_WALLET_*` variable

---

## 💡 Testing Recommendations

### For Quick Testing:
- Use **Base** chain (lowest gas fees)
- Use **0.15 USDC** (already configured)
- Use your own wallet address in `.env`

### To Test:
1. Login with Privy
2. Create a listing
3. Click "Pay for Listing"
4. Select "Base" chain
5. Pay 0.15 USDC
6. Check your admin wallet to see the payment arrive! 🎉

---

## 📋 Current Pricing (For Testing):
- **Listing Fee**: 0.15 USDC (was 50 USDC)
- **Ad Boosts**: Not changed (still 50-200 USDC)

To change pricing, edit:
- `src/payment/privy-payment.service.ts` line 13
- `src/payment/payment.service.ts` line 9

