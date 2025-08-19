/**
 * Test script to verify holder count fetching
 */

import { fetchTokenData } from '../services/solanaApi.js';

// Test addresses
const testAddresses = [
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'So11111111111111111111111111111111111111112',   // SOL
];

async function testHolderCount() {
  console.log('🧪 Testing Holder Count Fetching...\n');
  
  for (const address of testAddresses) {
    try {
      console.log(`📊 Testing: ${address}`);
      
      const tokenData = await fetchTokenData(address);
      
      console.log(`  Token: ${tokenData.name} (${tokenData.symbol})`);
      console.log(`  Total Holders: ${tokenData.total_holders}`);
      console.log(`  Holder Count: ${tokenData.holder_count}`);
      console.log(`  Active Wallets: ${tokenData.active_wallets}`);
      console.log(`  Data Source: ${tokenData.data_sources?.solscan || 'unknown'}`);
      console.log('');
      
    } catch (error) {
      console.error(`❌ Error testing ${address}:`, error.message);
      console.log('');
    }
  }
  
  console.log('✅ Holder count test completed!');
}

// Run the test
testHolderCount().catch(console.error);


