# Quick Guide: Testing Privy Endpoints with Cookie Token

## Extract Token from Cookie

Your cookie string:
```
privy-session=t; privy-token=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IkxrZjVwSjNHSVdKUFdXcU16VlN4OG5FeURzVVRhcVg4aGtTLUYtZ3hFVU0ifQ.eyJzaWQiOiJjbWh4NTZrem0wMGlpa3cwYzltYjdiYmprIiwiaXNzIjoicHJpdnkuaW8iLCJpYXQiOjE3NjMwMjA5OTksImF1ZCI6ImNtZ3Y3NzIxczAwczNsNzBjcGNpMmUyc2EiLCJzdWIiOiJkaWQ6cHJpdnk6Y21oeDU2bDExMDBpa2t3MGN5ZGF4NzdrMiIsImV4cCI6MTc2MzAyNDU5OX0.elROJXEBYLqy8Ch5buysWjQcOlOgt2aJP4qIqSrI-z16GSSf9mCyd2HGbavvsq2-ix9XUV6edgKepSXCtktTeg
```

**Extract just the token part** (everything after `privy-token=`):
```
eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IkxrZjVwSjNHSVdKUFdXcU16VlN4OG5FeURzVVRhcVg4aGtTLUYtZ3hFVU0ifQ.eyJzaWQiOiJjbWh4NTZrem0wMGlpa3cwYzltYjdiYmprIiwiaXNzIjoicHJpdnkuaW8iLCJpYXQiOjE3NjMwMjA5OTksImF1ZCI6ImNtZ3Y3NzIxczAwczNsNzBjcGNpMmUyc2EiLCJzdWIiOiJkaWQ6cHJpdnk6Y21oeDU2bDExMDBpa2t3MGN5ZGF4NzdrMiIsImV4cCI6MTc2MzAyNDU5OX0.elROJXEBYLqy8Ch5buysWjQcOlOgt2aJP4qIqSrI-z16GSSf9mCyd2HGbavvsq2-ix9XUV6edgKepSXCtktTeg
```

## Steps to Test in Swagger

### 1. Open Swagger UI
Go to: `https://api.ctomarketplace.com/api/docs`

### 2. Test Token Verification (Optional)
- Find `POST /api/auth/privy/verify`
- Click "Try it out"
- Paste the token (the full token string above)
- Click "Execute"
- Should return `{ "valid": true, ... }`

### 3. Sync User (Main Test)
- Find `POST /api/auth/privy/sync`
- Click "Try it out"
- In the request body, paste:
```json
{
  "privyToken": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IkxrZjVwSjNHSVdKUFdXcU16VlN4OG5FeURzVVRhcVg4aGtTLUYtZ3hFVU0ifQ.eyJzaWQiOiJjbWh4NTZrem0wMGlpa3cwYzltYjdiYmprIiwiaXNzIjoicHJpdnkuaW8iLCJpYXQiOjE3NjMwMjA5OTksImF1ZCI6ImNtZ3Y3NzIxczAwczNsNzBjcGNpMmUyc2EiLCJzdWIiOiJkaWQ6cHJpdnk6Y21oeDU2bDExMDBpa2t3MGN5ZGF4NzdrMiIsImV4cCI6MTc2MzAyNDU5OX0.elROJXEBYLqy8Ch5buysWjQcOlOgt2aJP4qIqSrI-z16GSSf9mCyd2HGbavvsq2-ix9XUV6edgKepSXCtktTeg"
}
```
- Click "Execute"
- You should get a response with:
  - `success: true`
  - `user` object (with id, email, etc.)
  - `token` (JWT token for your backend - **save this!**)
  - `wallets` array

### 4. Use JWT Token for Protected Endpoints
After `/sync` succeeds, you'll get a `token` field in the response. Use that for other endpoints:

1. Click "Authorize" button at the top of Swagger
2. Paste the JWT token (from `/sync` response)
3. Click "Authorize" and "Close"
4. Now test protected endpoints:
   - `GET /api/auth/privy/me` - Get user info
   - `GET /api/auth/privy/wallets` - Get all wallets
   - `POST /api/auth/privy/sync-wallets` - Sync wallets

## Token Expiration

⚠️ **Note**: Privy tokens expire! Your token shows `exp: 1763024599` which is a Unix timestamp.

If you get an error like "Invalid token" or "Token expired", you need to:
1. Login again via frontend
2. Get a fresh token from cookies
3. Use the new token

## Quick Copy-Paste Token

Here's your token ready to use (copy everything below):

```
eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IkxrZjVwSjNHSVdKUFdXcU16VlN4OG5FeURzVVRhcVg4aGtTLUYtZ3hFVU0ifQ.eyJzaWQiOiJjbWh4NTZrem0wMGlpa3cwYzltYjdiYmprIiwiaXNzIjoicHJpdnkuaW8iLCJpYXQiOjE3NjMwMjA5OTksImF1ZCI6ImNtZ3Y3NzIxczAwczNsNzBjcGNpMmUyc2EiLCJzdWIiOiJkaWQ6cHJpdnk6Y21oeDU2bDExMDBpa2t3MGN5ZGF4NzdrMiIsImV4cCI6MTc2MzAyNDU5OX0.elROJXEBYLqy8Ch5buysWjQcOlOgt2aJP4qIqSrI-z16GSSf9mCyd2HGbavvsq2-ix9XUV6edgKepSXCtktTeg
```

## Expected Response from /sync

```json
{
  "success": true,
  "user": {
    "id": 6,
    "email": "0xb1e29ee3AaE315453f4f98f822Fd72e647D7debf@wallet.privy",
    "walletAddress": "0xb1e29ee3AaE315453f4f98f822Fd72e647D7debf",
    "role": "USER",
    "privyUserId": "did:privy:cmhx56l1100ikkw0cydax77k2",
    "walletsCount": 2
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",  // Use this for other endpoints
  "wallets": [
    {
      "address": "0xb1e29ee3AaE315453f4f98f822Fd72e647D7debf",
      "chainType": "ethereum",
      "walletClient": "metamask",
      "isPrimary": true
    }
  ]
}
```

