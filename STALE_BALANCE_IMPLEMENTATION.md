# Stale Balance Implementation - "Last Known Balance" Strategy

## Overview
This document explains the implementation of the "Last Known Balance" strategy to prevent showing 0.00 balances when the Movement Network RPC/Indexer is unavailable, following professional "Stale-While-Revalidate" patterns.

## Problem
When the Movement Network RPC/Indexer fails or returns zero due to network issues, the previous implementation would overwrite the database with 0, causing users to see their balance disappear even though they had funds.

## Solution: "Don't Overwrite with Zero" Rule

### Database Schema
The `WalletBalance` table has the following relevant columns:
- `balance` (String) - The token balance
- `lastUpdated` (DateTime) - Timestamp of last successful sync
- `walletId` + `tokenAddress` (Unique composite key)

### Implementation Flow

#### 1. `syncWalletBalance()` - Main Entry Point

**Step 1: Get Existing Balance from DB First**
```typescript
const existingBalance = await prisma.walletBalance.findUnique({
  where: { walletId_tokenAddress: { walletId, tokenAddress } }
});
```

**Step 2: Fetch Fresh Balance from Blockchain**
- Calls `getWalletBalance()` which tries RPC → Indexer → DB fallback
- Returns balance with `isStale` and `networkStatus` flags

**Step 3: Decision Logic - Only Update DB on Success**
```typescript
if (balanceData.isStale || (balanceData.balance === '0' && balanceData.networkStatus === 'down')) {
  // Don't update DB - return existing DB value with stale flag
  return { ...existingBalance, isStale: true, networkStatus: 'down' };
}

// Network succeeded - update DB with fresh balance
await prisma.walletBalance.upsert({ ... });
```

**Key Rules:**
- ✅ Update DB only if: Network succeeded (healthy/degraded) AND not stale
- ❌ Don't update DB if: `isStale === true` OR (`balance === '0'` AND `networkStatus === 'down'`)

#### 2. `getWalletBalance()` - Blockchain Query with Fallback

**Flow:**
1. Try RPC endpoints (if successful and non-zero, return immediately)
2. If RPC returns 0, try Indexer
3. If Indexer succeeds, return with `networkStatus: 'degraded'`
4. If both fail, check DB for last known balance (if `walletId` provided)
5. Return with `isStale: true` if from DB fallback

**Return Type:**
```typescript
{
  balance: string;
  tokenAddress: string;
  tokenSymbol: string;
  decimals: number;
  lastUpdated?: Date;
  networkStatus?: 'healthy' | 'degraded' | 'down';
  isStale?: boolean;        // NEW: true if balance came from DB fallback
  lastSyncTime?: Date;      // NEW: timestamp of last known good sync
}
```

## Response to Frontend

### Successful Sync (Network Healthy)
```json
{
  "id": "...",
  "walletId": "...",
  "balance": "1500000",
  "tokenSymbol": "MOVE",
  "lastUpdated": "2026-01-03T08:30:00Z",
  "networkStatus": "healthy",
  "isStale": false,
  "lastSyncTime": "2026-01-03T08:30:00Z"
}
```

### Stale Balance (Network Down, Using DB Fallback)
```json
{
  "id": "...",
  "walletId": "...",
  "balance": "1500000",
  "tokenSymbol": "MOVE",
  "lastUpdated": "2026-01-03T08:25:00Z",  // 5 minutes ago
  "networkStatus": "down",
  "isStale": true,
  "lastSyncTime": "2026-01-03T08:25:00Z"
}
```

## Frontend Implementation Recommendations

Based on Gemini's recommendations:

1. **Visual Feedback for Stale Balances:**
   - Display balance in dimmed/greyed-out color
   - Add warning icon (⚠️) or sync icon (🔄) next to balance
   - Show tooltip: "Network Sync Issue: This is your last recorded balance from [lastSyncTime]. Real-time updates from Movement Network are currently delayed."

2. **Status Banner:**
   - Show yellow banner: "Movement Network is currently syncing. Balances may be temporarily inaccurate."

3. **Activity Link:**
   - Add "View on Explorer" link so users can verify funds on official Movement Explorer

## Benefits

1. **Trust & Safety**: Users never see their balance "vanish" to 0.00 due to network issues
2. **Professional UX**: Matches patterns used by Ledger, MetaMask, Coinbase
3. **Data Integrity**: Database preserves last known good balance even during network outages
4. **Contextual Feedback**: Clear communication about network status reduces user anxiety

## Testing Scenarios

1. **Network Healthy**: Should update DB with fresh balance
2. **RPC Down, Indexer Works**: Should update DB with Indexer balance (degraded status)
3. **RPC & Indexer Down**: Should return DB value with `isStale: true`, NOT update DB
4. **Legitimate Zero Balance**: If network is healthy and returns 0, should update DB (user spent money)
5. **First-Time Wallet**: If no DB record exists, should create record (even if zero)

