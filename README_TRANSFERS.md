# CTO Cross-Chain Transfer System

This document describes the implementation of cross-chain USDC transfers and token swaps in the CTO marketplace backend.

## Overview

The system integrates three key components:
1. **Circle Programmable Wallets** - For wallet management and authentication
2. **CCTP (Cross-Chain Transfer Protocol) + Wormhole** - For cross-chain USDC transfers
3. **Panora** - For token swaps (buy/sell memecoins)

## Architecture

### User Flow
1. User signs up/logs in using Circle Authentication
2. Backend creates and attaches developer-controlled wallets to users
3. Wallet info (walletId, address, blockchain) is stored in the database
4. Users can:
   - List memecoins (stored in database, fetched from public APIs)
   - Buy/sell memecoins via Panora API
   - Transfer USDC across chains via Circle CCTP + Wormhole integration

## API Endpoints

### CCTP Cross-Chain USDC Transfer

#### POST /api/transfers/cctp
Initiates a cross-chain USDC transfer using Circle's CCTP.

**Request Body:**
```json
{
  "userId": "user@example.com",
  "sourceChain": "ETHEREUM",
  "destinationChain": "BASE",
  "amount": 100.0,
  "destinationAddress": "0x...",
  "walletId": "optional-wallet-id"
}
```

**Response:**
```json
{
  "success": true,
  "transferId": "transfer-123",
  "status": "pending",
  "sourceChain": "ETHEREUM",
  "destinationChain": "BASE",
  "amount": 100.0,
  "message": "CCTP transfer initiated successfully",
  "nextStep": "Wait for attestation and redeem on destination chain"
}
```

### Wormhole Integration

#### POST /api/transfers/wormhole/attestation
Gets Wormhole attestation for cross-chain transfer.

**Request Body:**
```json
{
  "txHash": "0x...",
  "sourceChain": "ETHEREUM",
  "destinationChain": "BASE"
}
```

#### POST /api/transfers/wormhole/redeem
Redeems USDC on destination chain using Wormhole.

**Request Body:**
```json
{
  "txHash": "0x...",
  "sourceChain": "ETHEREUM",
  "destinationChain": "BASE",
  "attestation": "wormhole-attestation-data"
}
```

### Panora Token Swaps

#### POST /api/transfers/panora/swap
Executes token swap via Panora.

**Request Body:**
```json
{
  "userId": "user@example.com",
  "fromToken": "0x...",
  "toToken": "0x...",
  "amount": 100.0,
  "slippage": 0.5,
  "chain": "ETHEREUM",
  "walletId": "optional-wallet-id"
}
```

**Response:**
```json
{
  "success": true,
  "transactionId": "tx-123",
  "status": "pending",
  "expectedOutput": "95.5",
  "minOutput": "95.0",
  "priceImpact": "0.1",
  "message": "Token swap executed successfully"
}
```

## Environment Variables

Add these to your `.env` file:

```bash
# Circle Configuration (already configured)
CIRCLE_API_KEY=your_circle_api_key
CIRCLE_APP_ID=your_circle_app_id
CIRCLE_API_BASE=https://api.circle.com/v1/w3s

# Wormhole Configuration
WORMHOLE_API_KEY=your_wormhole_api_key

# Panora Configuration
PANORA_API_KEY=your_panora_api_key
```

## Supported Chains

The system supports the following chains for cross-chain transfers:
- Ethereum
- Base
- Arbitrum
- Optimism
- Polygon
- Avalanche
- Solana

## Implementation Details

### Circle Integration
- Uses Circle's Programmable Wallets API for wallet management
- Handles user authentication and wallet creation
- Manages user tokens for API access

### CCTP Integration
- Leverages Circle's Cross-Chain Transfer Protocol
- Handles USDC transfers across supported chains
- Uses Circle's transfer API with proper idempotency keys

### Wormhole Integration
- Fetches attestations from Wormhole API
- Handles cross-chain message passing
- Manages redemption on destination chains

### Panora Integration
- Gets swap quotes from Panora API
- Executes token swaps via smart contracts
- Handles slippage and price impact calculations

## Error Handling

All endpoints include comprehensive error handling:
- Invalid user credentials
- Insufficient wallet balances
- Network failures
- Invalid chain configurations
- API rate limiting

## Security Considerations

- All API keys are stored as environment variables
- User authentication is required for all operations
- Idempotency keys prevent duplicate transactions
- Input validation on all endpoints

## Testing

To test the implementation:

1. Set up your environment variables
2. Ensure you have Circle API access
3. Test with small amounts first
4. Monitor transaction status via the status endpoint

## Dependencies

The implementation requires these additional dependencies:
- `axios` for HTTP requests
- `uuid` for idempotency keys
- `@nestjs/common` for decorators and exceptions

## Future Enhancements

- Real-time transaction status updates
- Batch transfer operations
- Advanced slippage protection
- Multi-signature wallet support
- Gas optimization strategies
