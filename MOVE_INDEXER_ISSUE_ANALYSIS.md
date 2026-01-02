# MOVE Indexer Fallback Issue - Analysis for Gemini

## Current Status

✅ **USDC.e**: Working perfectly - Indexer fallback is functioning
- Logs show: `✅ [INDEXER-SYNC] Using indexer balance (510000 USDC.e) because RPC returned 0`
- User 1: 0.51 USDC showing correctly
- User 2: 3.19 USDC showing correctly

❌ **MOVE**: Not working - Indexer fallback is triggered but returns no balance
- Logs show: `🔍 RPC returned zero balance, checking Indexer as secondary source...` (fallback IS triggered)
- BUT: No `✅ [INDEXER-SYNC] Using indexer balance...` log appears for MOVE
- User 1: 0.00 MOVE (should have balance based on deposits)
- User 2: 0.00 MOVE (should have balance based on deposits)

## Key Observation from Logs

The fallback code IS executing for MOVE (we see the debug log at line 363: `🔍 RPC returned zero balance, checking Indexer as secondary source...`), but `getBalanceFromIndexer` is returning `null`, meaning the Indexer query is not finding the balance.

## Code Implementation

### Constants Used
```typescript
// Native token for gas payments
private readonly NATIVE_TOKEN_ADDRESS = '0x1::aptos_coin::AptosCoin';

// Movement test token (default to official USDC FA)
private readonly TEST_TOKEN_ADDRESS = this.configService.get(
  'MOVEMENT_TEST_TOKEN_ADDRESS',
  '0xb89077cfd2a82a0c1450534d49cfd5f2707643155273069bc23a912bcfefdee7' // Official USDC.e on Bardock
);

private readonly MOVEMENT_INDEXER_URL = 'https://indexer.testnet.movementnetwork.xyz/v1/graphql';
```

### getBalanceFromIndexer Method (lines 88-190)

```typescript
private async getBalanceFromIndexer(
  walletAddress: string, 
  tokenAddress: string,
  isTestnet: boolean = true
): Promise<{ balance: string; tokenSymbol: string; decimals: number } | null> {
  if (!isTestnet) {
    // Indexer fallback only available for testnet
    return null;
  }

  try {
    const tokenAddr = tokenAddress.toLowerCase();
    const isMOVE = tokenAddr === this.NATIVE_TOKEN_ADDRESS.toLowerCase();
    const isUSDC = tokenAddr === this.TEST_TOKEN_ADDRESS.toLowerCase();

    if (isMOVE) {
      // Query coin balances for MOVE
      const query = {
        query: `
          query GetCoinBalances($owner: String!) {
            current_coin_balances(
              where: { 
                owner_address: { _eq: $owner }
                coin_type: { _eq: "0x1::aptos_coin::AptosCoin" }
              }
            ) {
              amount
              coin_type
            }
          }
        `,
        variables: {
          owner: walletAddress.toLowerCase(),
        }
      };

      const response = await axios.post(this.MOVEMENT_INDEXER_URL, query, { timeout: 10000 });
      
      if (response.data?.errors) {
        this.logger.debug(`⚠️ [INDEXER] GraphQL Errors for coin balances: ${JSON.stringify(response.data.errors)}`);
        return null;
      }

      const balances = response.data?.data?.current_coin_balances || [];
      if (balances.length > 0) {
        return {
          balance: balances[0].amount || '0',
          tokenSymbol: 'MOVE',
          decimals: 8,
        };
      }
    } else if (isUSDC) {
      // Query fungible asset balances for USDC
      const query = {
        query: `
          query GetFungibleAssetBalances($owner: String!, $assetType: String!) {
            current_fungible_asset_balances(
              where: { 
                owner_address: { _eq: $owner }
                asset_type: { _eq: $assetType }
              }
            ) {
              amount
              asset_type
              metadata {
                symbol
                name
                decimals
              }
            }
          }
        `,
        variables: {
          owner: walletAddress.toLowerCase(),
          assetType: this.TEST_TOKEN_ADDRESS.toLowerCase(),
        }
      };

      const response = await axios.post(this.MOVEMENT_INDEXER_URL, query, { timeout: 10000 });
      
      if (response.data?.errors) {
        this.logger.debug(`⚠️ [INDEXER] GraphQL Errors for fungible asset balances: ${JSON.stringify(response.data.errors)}`);
        return null;
      }

      const balances = response.data?.data?.current_fungible_asset_balances || [];
      if (balances.length > 0) {
        const balance = balances[0];
        const metadata = balance.metadata || {};
        return {
          balance: balance.amount || '0',
          tokenSymbol: metadata.symbol || 'USDC.e',
          decimals: metadata.decimals || 6,
        };
      }
    }

    return null;
  } catch (error: any) {
    this.logger.debug(`⚠️ [INDEXER] Failed to fetch balance from indexer: ${error.message}`);
    return null;
  }
}
```

### getWalletBalance Method - Fallback Logic (lines 303-318)

```typescript
// If RPC returned 0 (or all RPCs failed), check Indexer as fallback/secondary source
if (!rpcBalance || rpcBalance.balance === '0') {
  this.logger.debug(`🔍 RPC returned zero balance, checking Indexer as secondary source...`);
  const indexerBalance = await this.getBalanceFromIndexer(walletAddress, tokenAddr, isTestnet);
  
  if (indexerBalance && indexerBalance.balance !== '0' && parseInt(indexerBalance.balance) > 0) {
    this.logger.log(`✅ [INDEXER-SYNC] Using indexer balance (${indexerBalance.balance} ${indexerBalance.tokenSymbol}) because RPC returned 0`);
    return {
      balance: indexerBalance.balance,
      tokenAddress: tokenAddr,
      tokenSymbol: indexerBalance.tokenSymbol,
      decimals: indexerBalance.decimals,
      lastUpdated: new Date(),
    };
  }
}
```

## Hypothesis

Based on Gemini's analysis and the logs, the issue is likely:

**MOVE on Movement Bardock testnet is stored as a Fungible Asset (FA), not as a Coin.**

The current implementation:
- ✅ Queries `current_coin_balances` for MOVE (looking for `0x1::aptos_coin::AptosCoin`)
- ❌ Does NOT query `current_fungible_asset_balances` for MOVE

If Movement Bardock has migrated MOVE to the FA standard, the balance would be in `current_fungible_asset_balances` with an asset_type like `0x1` (or similar), not in `current_coin_balances`.

## What We Need from Gemini

1. **Verification**: Should we query `current_fungible_asset_balances` for MOVE on Bardock testnet?
2. **Asset Type**: What would be the correct `asset_type` for MOVE as a Fungible Asset? (Is it `0x1`?)
3. **Implementation**: Should we query BOTH `current_coin_balances` AND `current_fungible_asset_balances` for MOVE, or just FA?
4. **Logging**: Should we add more detailed logging to see what the Indexer actually returns for the MOVE query?

## Test Wallet Addresses

For manual testing in GraphQL explorer:
- User 1: `0x1078fc5141ee806e4959fe1eebbaa6a77f7dc2497bb30ee129b3b55dc9a26cdd`
- User 2: `0xf63549750d7c0669d08420c80ba8eaa2e11293ef1567b14222372eadd05067fe`

GraphQL Endpoint: `https://indexer.testnet.movementnetwork.xyz/v1/graphql`

