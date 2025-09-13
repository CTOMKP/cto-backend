/**
 * Example usage of the batch scan endpoint
 * This file demonstrates how to call the /api/scan-batch endpoint
 */

// Example contract addresses for testing
const exampleAddresses = [
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // Bonk
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'So11111111111111111111111111111111111111112',   // SOL
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', // Example token
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So'   // mSOL
];

/**
 * Example function to call the batch scan endpoint
 */
async function testBatchScan() {
  try {
    const response = await fetch('http://localhost:3001/api/scan-batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contractAddresses: exampleAddresses
      }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error('Batch scan failed:', data.error);
      return;
    }

    console.log('Batch Scan Results:');
    console.log('==================');
    
    // Display batch summary
    console.log('\n📊 Batch Summary:');
    console.log(`Total Requested: ${data.batch_summary.total_requested}`);
    console.log(`Total Scanned: ${data.batch_summary.total_scanned}`);
    console.log(`Successful Scans: ${data.batch_summary.successful_scans}`);
    console.log(`Failed Scans: ${data.batch_summary.failed_scans}`);
    console.log(`Eligible Tokens: ${data.batch_summary.eligible_tokens}`);
    console.log(`Ineligible Tokens: ${data.batch_summary.ineligible_tokens}`);

    // Display statistics
    console.log('\n📈 Statistics:');
    console.log(`Average Risk Score: ${data.statistics.average_risk_score}`);
    console.log(`Total Liquidity: $${data.statistics.total_liquidity.toLocaleString()}`);
    console.log('Tier Distribution:', data.statistics.tier_distribution);

    // Display tokens by tier
    console.log('\n🏆 Tokens by Tier:');
    Object.entries(data.tokens_by_tier).forEach(([tier, tokens]) => {
      console.log(`\n${tier} (${tokens.length} tokens):`);
      tokens.forEach(token => {
        console.log(`  • ${token.metadata.token_symbol} (${token.metadata.token_name})`);
        console.log(`    Risk Score: ${token.risk_score}, Liquidity: $${token.metadata.lp_amount_usd?.toLocaleString() || 'N/A'}`);
      });
    });

    // Display failed scans
    const failedScans = data.all_results.filter(r => !r.success);
    if (failedScans.length > 0) {
      console.log('\n❌ Failed Scans:');
      failedScans.forEach(scan => {
        console.log(`  • ${scan.contractAddress}: ${scan.error}`);
      });
    }

  } catch (error) {
    console.error('Error testing batch scan:', error);
  }
}

/**
 * Example function to call the batch scan endpoint with custom addresses
 */
async function scanCustomAddresses(addresses) {
  try {
    const response = await fetch('http://localhost:3001/api/scan-batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contractAddresses: addresses
      }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error);
    }

    return data;

  } catch (error) {
    console.error('Error scanning custom addresses:', error);
    throw error;
  }
}

// Export for use in other files
export { testBatchScan, scanCustomAddresses, exampleAddresses };

// Run test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testBatchScan();
}


