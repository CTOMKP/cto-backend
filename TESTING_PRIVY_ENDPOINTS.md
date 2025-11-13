# Testing Privy Authentication Endpoints in Swagger

## ⚠️ Important: You Cannot Create a Privy User Directly in Swagger

**Why?** Privy authentication happens on the **frontend**:
1. User connects wallet (MetaMask, WalletConnect, etc.) via Privy's UI
2. Privy SDK generates an access token
3. Frontend sends this token to your backend
4. Backend verifies token and creates/updates user in database

**You cannot bypass Privy's frontend flow** - you need a valid Privy token to test the backend endpoints.

---

## How to Test Privy Endpoints

### Option 1: Get Token from Frontend (Recommended)

1. **Login via Frontend**:
   - Go to your frontend app (e.g., `http://localhost:3000`)
   - Click "Login with Wallet" or "Connect Wallet"
   - Connect MetaMask or another wallet
   - Privy will authenticate and create a token

2. **Get Privy Token from Browser Console**:
   ```javascript
   // In browser console after Privy login:
   const privy = window.privy;
   const token = await privy.getAccessToken();
   console.log('Privy Token:', token);
   ```

3. **Use Token in Swagger**:
   - Open Swagger: `https://api.ctomarketplace.com/api/docs`
   - Go to `POST /api/auth/privy/sync`
   - Click "Try it out"
   - Paste the token in `privyToken` field
   - Click "Execute"

### Option 2: Test with Existing User Token

If you already have a user who logged in via Privy:

1. **Get Token from Database/Logs**:
   - Check backend logs for Privy tokens (first 50 chars logged)
   - Or get from frontend localStorage after login

2. **Use Token in Swagger**:
   - Same as Option 1, step 3

---

## Privy Endpoints Overview

### 1. `POST /api/auth/privy/sync` ⭐ **Main Endpoint**

**Purpose**: Create/update user in database after Privy authentication

**Required**: Valid Privy access token

**Request Body**:
```json
{
  "privyToken": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjEyMzQifQ..."
}
```

**Response**:
```json
{
  "success": true,
  "user": {
    "id": 5,
    "email": "0x1234...@wallet.privy",
    "walletAddress": "0x1234...",
    "role": "USER",
    "privyUserId": "did:privy:cmhx...",
    "walletsCount": 3
  },
  "token": "eyJhbGciOiJIUzI1NiIs...",  // Your backend JWT token
  "wallets": [
    {
      "address": "0x1234...",
      "chainType": "ethereum",
      "walletClient": "metamask",
      "isPrimary": true
    }
  ]
}
```

**What it does**:
- Verifies Privy token
- Gets user details from Privy API
- Creates/updates user in your database
- Syncs all wallets (Ethereum, Solana, Movement, etc.)
- Returns your backend JWT token for future API calls

---

### 2. `POST /api/auth/privy/verify` 🔍 **Token Verification**

**Purpose**: Check if a Privy token is valid (utility endpoint)

**Request Body**:
```json
{
  "token": "eyJhbGciOiJFUzI1NiIs..."
}
```

**Response**:
```json
{
  "valid": true,
  "userId": "did:privy:cmhx...",
  "claims": { ... }
}
```

**Use Case**: Test if a Privy token is still valid before calling sync

---

### 3. `GET /api/auth/privy/me` 🔒 **Get Current User**

**Purpose**: Get Privy user details (requires JWT token from `/sync`)

**Auth Required**: Yes (JWT Bearer token from `/sync` response)

**Response**:
```json
{
  "privyUser": { ... },
  "wallets": [ ... ]
}
```

**How to Test**:
1. First call `/sync` to get JWT token
2. Click "Authorize" in Swagger
3. Paste the JWT token from `/sync` response
4. Call `/me` endpoint

---

### 4. `GET /api/auth/privy/wallets` 🔒 **Get User Wallets**

**Purpose**: Get all wallets for authenticated user

**Auth Required**: Yes (JWT Bearer token)

**Response**:
```json
{
  "success": true,
  "wallets": [
    {
      "id": 1,
      "address": "0x1234...",
      "blockchain": "ETHEREUM",
      "walletClient": "metamask",
      "isPrimary": true
    }
  ]
}
```

---

### 5. `POST /api/auth/privy/sync-wallets` 🔒 **Sync Wallets**

**Purpose**: Manually sync wallets from Privy API

**Auth Required**: Yes (JWT Bearer token)

**Response**:
```json
{
  "success": true,
  "message": "Successfully synced 3 wallets",
  "syncedCount": 3
}
```

**Use Case**: If user adds a new wallet in Privy, call this to sync it to your database

---

### 6. `POST /api/auth/privy/create-aptos-wallet` 🔒 **Create Aptos Wallet**

**Purpose**: Create server-generated Aptos wallet (deprecated - Movement wallets are created via Privy)

**Auth Required**: Yes (JWT Bearer token)

**Note**: This endpoint is deprecated. Movement wallets are now created automatically via Privy's `createWallet` API on the frontend.

---

## Step-by-Step Testing Guide

### Complete Flow Test:

1. **Get Privy Token** (from frontend):
   ```javascript
   // In browser console after Privy login
   const privy = window.privy;
   const token = await privy.getAccessToken();
   console.log(token);
   ```

2. **Test Token Verification**:
   - Swagger → `POST /api/auth/privy/verify`
   - Paste token
   - Should return `{ "valid": true, ... }`

3. **Sync User**:
   - Swagger → `POST /api/auth/privy/sync`
   - Paste token
   - Should return user + JWT token

4. **Authorize in Swagger**:
   - Click "Authorize" button
   - Paste JWT token from step 3
   - Click "Authorize"

5. **Test Protected Endpoints**:
   - `GET /api/auth/privy/me` - Get user info
   - `GET /api/auth/privy/wallets` - Get wallets
   - `POST /api/auth/privy/sync-wallets` - Sync wallets

---

## Common Issues

### ❌ "Invalid Privy token"
- Token expired (Privy tokens expire quickly)
- Token format incorrect
- **Solution**: Get fresh token from frontend

### ❌ "User not found in Privy"
- Token is invalid or expired
- **Solution**: Re-authenticate via frontend

### ❌ "Unauthorized" on protected endpoints
- Missing or invalid JWT token
- **Solution**: Get JWT token from `/sync` endpoint first

---

## Alternative: Test with Mock Token (Development Only)

**⚠️ This won't work in production** - Privy tokens are cryptographically signed.

For development/testing, you could:
1. Create a test user via frontend
2. Save the Privy token temporarily
3. Use it in Swagger for testing

But tokens expire, so you'll need to refresh them regularly.

---

## Summary

**Can you create a Privy user in Swagger?** ❌ No - Privy authentication requires frontend flow.

**Can you test Privy endpoints in Swagger?** ✅ Yes - if you have a valid Privy token from the frontend.

**Best Practice**: 
1. Login via frontend to get Privy token
2. Use that token in Swagger to test backend endpoints
3. Use the returned JWT token for other protected endpoints

