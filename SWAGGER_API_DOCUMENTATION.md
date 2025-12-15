# Swagger API Documentation

## Access Swagger UI

**Production**: https://api.ctomarketplace.com/api/docs

**Local Development**: http://localhost:3001/api/docs

## Configuration

Swagger is enabled when:
- `ENABLE_SWAGGER=true` is set in environment variables, OR
- `NODE_ENV !== 'production'`

## Server URLs

Swagger UI includes two server options:
1. **Production API**: `https://api.ctomarketplace.com`
2. **Local Development**: `http://localhost:3001`

You can switch between servers using the dropdown in Swagger UI.

## Authentication

Most endpoints require JWT Bearer token authentication:

1. Click the **"Authorize"** button at the top of Swagger UI
2. Enter your JWT token (obtained from `/api/auth/login` or `/api/auth/privy/sync`)
3. Click **"Authorize"** and **"Close"**
4. The token will persist across page refreshes

## Available API Endpoints

### Authentication
- **Authentication** - Traditional email/password authentication
- **PrivyAuth** - Privy wallet-based authentication (MetaMask, WalletConnect, etc.)

### Circle Programmable Wallets
- **circle** - User management, wallet creation, balances
- **transfers** - Cross-Chain Transfers (CCTP/Wormhole for USDC movement)
- **funding** - Wallet Funding (Deposit instructions and balance management)

### Token & Project Management
- **Token Scanning** - Analyze Solana tokens for safety
- **Listing** - Project Listings & Management (Public project listings)
- **UserListings** - User-specific listings management

### Content & Media
- **Memes** - Meme Management (Upload, download, and manage memes)
- **images** - Image Management (Upload, view, and manage images)
- **assets** - Static Assets (Serve static assets from S3/CDN)

### Utilities
- **waitlist** - Waitlist Management (Join and manage waitlist)
- **stats** - Statistics (Memecoin stats from Dune Analytics)
- **payment** - Payment Processing (Payment management)
- **admin** - Admin Operations (Administrative endpoints)
- **Health** - Health Check (API health and status)

## Testing Endpoints

### 1. Get Authentication Token

**Option A: Traditional Login**
```
POST /api/auth/login
Body: {
  "email": "user@example.com",
  "password": "password123"
}
Response: {
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { ... }
}
```

**Option B: Privy Wallet Login**
```
POST /api/auth/privy/sync
Body: {
  "privyToken": "eyJhbGciOiJFUzI1NiIs..."
}
Response: {
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { ... },
  "wallets": [ ... ]
}
```

### 2. Use Token in Swagger

1. Copy the `access_token` or `token` from the response
2. Click **"Authorize"** in Swagger UI
3. Paste the token (without "Bearer " prefix)
4. Click **"Authorize"**

### 3. Test Protected Endpoints

All endpoints marked with 🔒 require authentication. After authorizing, you can:
- Click **"Try it out"** on any endpoint
- Fill in the required parameters
- Click **"Execute"**
- View the response

## Common Endpoints

### Public Endpoints (No Auth Required)
- `GET /api/stats/memecoin` - Get memecoin statistics
- `POST /api/waitlist` - Join waitlist
- `GET /api/listing` - Get public listings
- `GET /api/memes` - Get all memes
- `GET /api/memes/:id/download` - Download meme
- `GET /health` - Health check

### Protected Endpoints (Auth Required)
- `POST /api/images/presign` - Get presigned URL for image upload
- `POST /api/memes/presign` - Get presigned URL for meme upload
- `GET /api/auth/me` - Get current user
- `GET /api/auth/privy/wallets` - Get user wallets
- `POST /api/listing` - Create listing
- `GET /api/user-listings` - Get user's listings

## Notes for Frontend Developers

1. **Base URL**: Always use `https://api.ctomarketplace.com` in production
2. **CORS**: CORS is enabled for all origins
3. **Token Expiry**: JWT tokens expire after 24 hours. Refresh by calling login/sync again
4. **Error Handling**: All errors follow standard HTTP status codes:
   - `200` - Success
   - `201` - Created
   - `400` - Bad Request
   - `401` - Unauthorized (invalid/missing token)
   - `403` - Forbidden (insufficient permissions)
   - `404` - Not Found
   - `500` - Internal Server Error

5. **Request Format**: 
   - Use `Content-Type: application/json` for POST/PUT requests
   - Include `Authorization: Bearer <token>` header for protected endpoints

6. **Response Format**: All responses are JSON objects

## Swagger Features

- **Persistent Authorization**: Token persists after page refresh
- **Alphabetical Sorting**: Tags and operations are sorted alphabetically
- **Try It Out**: Test endpoints directly from Swagger UI
- **Schema Validation**: Request/response schemas are documented
- **Examples**: Example values provided for all parameters

## Support

If you encounter any issues:
1. Check the Swagger UI for endpoint documentation
2. Verify your token is valid (not expired)
3. Check the response error message for details
4. Ensure you're using the correct server URL (Production vs Local)

