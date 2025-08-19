import dotenv from 'dotenv';
import { fetchTokenData } from '../services/solanaApi.js';
import { formatTokenAge } from '../utils/ageFormatter.js';
import axios from 'axios';

// Load environment variables
dotenv.config();

// API Integration Testing for Solana Mainnet Token Analysis
// Tests real mainnet tokens for comprehensive data validation

// Test contract addresses (mainnet tokens)
const testAddresses = [
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // Bonk
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'So11111111111111111111111111111111111111112',   // SOL
];

async function testApiIntegration() {
  console.log('🧪 Testing Solana API Integration');
  console.log('=====================================');
  
  for (const address of testAddresses) {
    console.log(`\n📍 Testing address: ${address}`);
    console.log('-'.repeat(50));
    
    try {
      const tokenData = await fetchTokenData(address);
      
      console.log('✅ Success! Token data received:');
      console.log(`   Name: ${tokenData.name}`);
      console.log(`   Symbol: ${tokenData.symbol}`);
      console.log(`   Mint Authority: ${tokenData.mint_authority || 'None'}`);
      console.log(`   Freeze Authority: ${tokenData.freeze_authority || 'None'}`);
      console.log(`   Total Supply: ${tokenData.total_supply}`);
      console.log(`   Decimals: ${tokenData.decimals}`);
      console.log(`   Project Age: ${formatTokenAge(tokenData.project_age_days)} (${tokenData.project_age_days.toFixed(2)} days)`);
      console.log(`   Creation Date: ${tokenData.creation_date}`);
      console.log(`   Creation Transaction: ${tokenData.creation_transaction || 'N/A'}`);
      console.log(`   Verified: ${tokenData.verified}`);
      console.log(`   LP Amount (USD): $${tokenData.lp_amount_usd?.toLocaleString()}`);
      console.log(`   Token Price: $${tokenData.token_price?.toFixed(6) || 'N/A'}`);
      console.log(`   24h Volume: $${tokenData.volume_24h?.toLocaleString() || 'N/A'}`);
      console.log(`   Market Cap: $${tokenData.market_cap?.toLocaleString() || 'N/A'}`);
      console.log(`   Pool Count: ${tokenData.pool_count || 0}`);
      console.log(`   LP Lock Period: ${tokenData.lp_lock_months} months`);
      console.log(`   LP Burned: ${tokenData.lp_burned ? 'Yes' : 'No'}`);
      console.log(`   LP Locked: ${tokenData.lp_locked ? 'Yes' : 'No'}`);
      if (tokenData.lock_contract) {
        console.log(`   Lock Contract: ${tokenData.lock_contract}`);
      }
      if (tokenData.lock_analysis) {
        console.log(`   Lock Analysis: ${tokenData.lock_analysis}`);
      }
      if (tokenData.largest_lp_holder) {
        console.log(`   Largest LP Holder: ${tokenData.largest_lp_holder.slice(0, 8)}...${tokenData.largest_lp_holder.slice(-6)}`);
      }
      
      // Holder distribution metrics
      console.log(`   Total Holders: ${tokenData.total_holders}`);
      console.log(`   Active Wallets: ${tokenData.active_wallets}`);
      if (tokenData.distribution_metrics) {
        console.log(`   Top Holder: ${tokenData.distribution_metrics.top_holder_percentage?.toFixed(2)}%`);
        console.log(`   Top 5 Holders: ${tokenData.distribution_metrics.top_5_holders_percentage?.toFixed(2)}%`);
      }
      if (tokenData.whale_analysis) {
        console.log(`   Whale Count: ${tokenData.whale_analysis.whale_count}`);
        console.log(`   Whale Risk: ${tokenData.whale_analysis.risk_level}`);
        console.log(`   Whale Concentration: ${tokenData.whale_analysis.whale_concentration?.toFixed(2)}%`);
      }
      if (tokenData.suspicious_activity) {
        console.log(`   Suspicious Activity: ${tokenData.suspicious_activity.concentration_risk || 'low'} risk`);
        console.log(`   Large Holder Concentration: ${tokenData.suspicious_activity.large_holder_concentration?.toFixed(2)}%`);
      }
      
      // Wallet activity metrics
      if (tokenData.activity_summary) {
        console.log(`   Wallets Analyzed: ${tokenData.activity_summary.total_analyzed}`);
        console.log(`   Suspicious Wallets: ${tokenData.activity_summary.suspicious_wallets}`);
        console.log(`   Recent Sell Pressure: ${tokenData.activity_summary.recent_sell_pressure}%`);
        console.log(`   Activity Score: ${tokenData.activity_summary.activity_score}/100`);
        console.log(`   Activity Level: ${tokenData.activity_summary.avg_activity_level}`);
        
        if (tokenData.suspicious_activity.coordinated_selling) {
          console.log(`   ⚠️  ALERT: Coordinated selling detected`);
        }
        if (tokenData.suspicious_activity.high_sell_pressure) {
          console.log(`   ⚠️  ALERT: High sell pressure detected`);
        }
      }
      
      // Smart contract security
      if (tokenData.smart_contract_risks) {
        console.log(`   Security Score: ${tokenData.smart_contract_risks.security_score}/100`);
        console.log(`   Risk Level: ${tokenData.smart_contract_risks.overall_risk_level}`);
        console.log(`   Critical Issues: ${tokenData.smart_contract_risks.critical_vulnerabilities}`);
        console.log(`   High Issues: ${tokenData.smart_contract_risks.high_vulnerabilities}`);
        console.log(`   Medium Issues: ${tokenData.smart_contract_risks.medium_vulnerabilities}`);
        console.log(`   Mint Authority: ${tokenData.smart_contract_risks.mint_authority_active ? 'Active ⚠️' : 'Disabled ✅'}`);
        console.log(`   Freeze Authority: ${tokenData.smart_contract_risks.freeze_authority_active ? 'Active ⚠️' : 'Disabled ✅'}`);
        console.log(`   Full Audit: ${tokenData.smart_contract_risks.full_audit ? 'Yes ✅' : 'No ❌'}`);
        console.log(`   Bug Bounty: ${tokenData.smart_contract_risks.bug_bounty ? 'Yes ✅' : 'No ❌'}`);
        
        if (tokenData.smart_contract_risks.rugcheck_available) {
          console.log(`   RugCheck Score: ${tokenData.smart_contract_risks.rugcheck_score}`);
          console.log(`   RugCheck Risk: ${tokenData.smart_contract_risks.rugcheck_risk_level}`);
        }
        
        if (tokenData.smart_contract_risks.risk_summary) {
          console.log(`   Summary: ${tokenData.smart_contract_risks.risk_summary}`);
        }
      }
      
      console.log(`   Data Sources: ${JSON.stringify(tokenData.data_sources, null, 2)}`);
      
    } catch (error) {
      console.log('❌ Failed:');
      console.log(`   Error: ${error.message}`);
    }
  }
  
  console.log('\n🎯 API Integration Test Complete');
}

async function testProjectAgeOnly() {
  console.log('📅 Testing Project Age API');
  console.log('==========================');
  
  const testAddress = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'; // Bonk
  
  try {
    console.log(`\n📍 Testing project age for: ${testAddress}`);
    
    const response = await axios.get('https://public-api.solscan.io/account/transactions', {
      params: {
        account: testAddress,
        limit: 1
      },
      timeout: 10000,
      headers: {
        'User-Agent': 'CTO-Vetting-System/1.0'
      }
    });
    
    if (response.data && response.data.length > 0) {
      const transaction = response.data[0];
      const creationDate = new Date(transaction.blockTime * 1000);
      const ageDays = Math.floor((Date.now() - creationDate.getTime()) / (1000 * 60 * 60 * 24));
      
      console.log('✅ Project age data received:');
      console.log(`   Creation Date: ${creationDate.toISOString()}`);
      console.log(`   Age in Days: ${ageDays}`);
      console.log(`   Transaction Hash: ${transaction.txHash}`);
      console.log(`   Block Time: ${transaction.blockTime}`);
    } else {
      console.log('❌ No transactions found');
    }
    
  } catch (error) {
    console.log('❌ Project age test failed:');
    console.log(`   Error: ${error.message}`);
  }
}

async function testRaydiumLiquidityOnly() {
  console.log('💧 Testing Raydium Liquidity API');
  console.log('================================');
  
  const testTokens = [
    { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', name: 'BONK' },
    { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', name: 'USDC' },
    { address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', name: 'RAY' }
  ];
  
  try {
    console.log('\n📍 Fetching Raydium liquidity data...');
    
    const response = await axios.get('https://api.raydium.io/v2/sdk/liquidity/mainnet.json', {
      timeout: 15000,
      headers: {
        'User-Agent': 'CTO-Vetting-System/1.0',
        'Accept': 'application/json'
      }
    });
    
    if (!response.data || !response.data.official || !response.data.unOfficial) {
      throw new Error('Invalid response structure from Raydium API');
    }
    
    const allPools = [...response.data.official, ...response.data.unOfficial];
    console.log(`✅ Loaded ${allPools.length} total pools from Raydium`);
    console.log(`   Official pools: ${response.data.official.length}`);
    console.log(`   Unofficial pools: ${response.data.unOfficial.length}`);
    
    for (const token of testTokens) {
      console.log(`\n🔍 Searching for ${token.name} (${token.address}):`);
      
      const tokenPools = allPools.filter(pool => 
        pool.baseMint === token.address || pool.quoteMint === token.address
      );
      
      if (tokenPools.length > 0) {
        console.log(`   Found ${tokenPools.length} pool(s)`);
        
        const largestPool = tokenPools.reduce((largest, current) => {
          const currentLiquidity = parseFloat(current.liquidity || 0);
          const largestLiquidity = parseFloat(largest.liquidity || 0);
          return currentLiquidity > largestLiquidity ? current : largest;
        });
        
        console.log(`   Largest pool ID: ${largestPool.id}`);
        console.log(`   Base/Quote: ${largestPool.baseMint === token.address ? token.name : 'Other'}/${largestPool.quoteMint === token.address ? token.name : 'Other'}`);
        console.log(`   Liquidity: ${largestPool.liquidity || 'N/A'}`);
        console.log(`   24h Volume: ${largestPool.volume24h || 'N/A'}`);
      } else {
        console.log(`   ❌ No pools found for ${token.name}`);
      }
    }
    
  } catch (error) {
    console.log('❌ Raydium liquidity test failed:');
    console.log(`   Error: ${error.message}`);
  }
}

async function testLPLockBurnOnly() {
  console.log('🔒 Testing LP Lock/Burn Status API');
  console.log('=================================');
  
  // Test LP token addresses (these are example addresses)
  const testLPTokens = [
    { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', name: 'BONK LP Token' },
    { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', name: 'USDC LP Token' },
    { address: '11111111111111111111111111111111', name: 'Burn Address Test' }
  ];
  
  for (const lpToken of testLPTokens) {
    console.log(`\n🔍 Testing LP holders for ${lpToken.name}:`);
    console.log(`   Address: ${lpToken.address}`);
    
    try {
      const response = await axios.get('https://public-api.solscan.io/token/holders', {
        params: {
          tokenAddress: lpToken.address,
          limit: 10
        },
        timeout: 10000,
        headers: {
          'User-Agent': 'CTO-Vetting-System/1.0'
        }
      });
      
      if (response.data && Array.isArray(response.data) && response.data.length > 0) {
        const holders = response.data;
        console.log(`   ✅ Found ${holders.length} holders`);
        
        // Sort by amount
        const sortedHolders = holders.sort((a, b) => 
          parseFloat(b.amount || 0) - parseFloat(a.amount || 0)
        );
        
        const largestHolder = sortedHolders[0];
        const largestHolderAddress = largestHolder.address;
        
        console.log(`   Largest Holder: ${largestHolderAddress.slice(0, 8)}...${largestHolderAddress.slice(-6)}`);
        console.log(`   Amount: ${largestHolder.amount}`);
        
        // Check for burn address
        if (largestHolderAddress === '11111111111111111111111111111111') {
          console.log(`   🔥 BURNED: LP tokens sent to burn address`);
        } 
        // Check for known lock contracts
        else if (largestHolderAddress.includes('TeamFi') || 
                 largestHolderAddress.includes('Goki') || 
                 largestHolderAddress.includes('Strm') ||
                 largestHolderAddress.includes('Lock') ||
                 largestHolderAddress.includes('Vest')) {
          console.log(`   🔒 LOCKED: LP tokens in lock contract`);
        }
        // Check concentration
        else {
          const totalSupply = holders.reduce((sum, h) => sum + parseFloat(h.amount || 0), 0);
          const percentage = (parseFloat(largestHolder.amount || 0) / totalSupply) * 100;
          console.log(`   📊 Concentration: ${percentage.toFixed(1)}% held by largest holder`);
          
          if (percentage > 90) {
            console.log(`   ⚠️  LIKELY LOCKED: High concentration suggests lock contract`);
          } else {
            console.log(`   ✅ DISTRIBUTED: LP tokens spread across holders`);
          }
        }
        
        // Show top 3 holders
        console.log(`   Top holders:`);
        sortedHolders.slice(0, 3).forEach((holder, i) => {
          const addr = holder.address.slice(0, 8) + '...' + holder.address.slice(-6);
          console.log(`     ${i+1}. ${addr}: ${holder.amount}`);
        });
        
      } else {
        console.log(`   ❌ No holders found or invalid response`);
      }
      
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }
}

async function testHolderDistributionOnly() {
  console.log('👥 Testing Holder Distribution API');
  console.log('=================================');
  
  const testTokens = [
    { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', name: 'BONK' },
    { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', name: 'USDC' },
    { address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', name: 'RAY' }
  ];
  
  for (const token of testTokens) {
    console.log(`\n🔍 Testing holder distribution for ${token.name}:`);
    console.log(`   Address: ${token.address}`);
    
    try {
      const response = await axios.get('https://public-api.solscan.io/token/holders', {
        params: {
          tokenAddress: token.address,
          limit: 10
        },
        timeout: 10000,
        headers: {
          'User-Agent': 'CTO-Vetting-System/1.0'
        }
      });
      
      if (response.data && Array.isArray(response.data) && response.data.length > 0) {
        const holders = response.data;
        console.log(`   ✅ Found ${holders.length} top holders`);
        
        // Calculate total supply and percentages
        const totalSupply = holders.reduce((sum, h) => sum + parseFloat(h.amount || 0), 0);
        
        // Sort by amount
        const sortedHolders = holders.sort((a, b) => 
          parseFloat(b.amount || 0) - parseFloat(a.amount || 0)
        );
        
        // Calculate key metrics
        const topHolderPercentage = totalSupply > 0 ? 
          (parseFloat(sortedHolders[0].amount || 0) / totalSupply) * 100 : 0;
        
        const top5Amount = sortedHolders.slice(0, 5).reduce((sum, h) => 
          sum + parseFloat(h.amount || 0), 0
        );
        const top5Percentage = totalSupply > 0 ? (top5Amount / totalSupply) * 100 : 0;
        
        // Whale analysis (>5% holders)
        const whaleThreshold = totalSupply * 0.05;
        const whales = sortedHolders.filter(h => parseFloat(h.amount || 0) > whaleThreshold);
        
        console.log(`   📊 Distribution Metrics:`);
        console.log(`     Total Supply (top 10): ${totalSupply.toLocaleString()}`);
        console.log(`     Top Holder: ${topHolderPercentage.toFixed(2)}%`);
        console.log(`     Top 5 Holders: ${top5Percentage.toFixed(2)}%`);
        console.log(`     Whales (>5%): ${whales.length}`);
        
        // Risk assessment
        let riskLevel = 'LOW';
        if (topHolderPercentage > 50) riskLevel = 'VERY HIGH';
        else if (topHolderPercentage > 25) riskLevel = 'HIGH';
        else if (topHolderPercentage > 10) riskLevel = 'MEDIUM';
        
        console.log(`   ⚠️  Concentration Risk: ${riskLevel}`);
        
        // Show top 5 holders
        console.log(`   🐋 Top 5 Holders:`);
        sortedHolders.slice(0, 5).forEach((holder, i) => {
          const addr = holder.address.slice(0, 8) + '...' + holder.address.slice(-6);
          const amount = parseFloat(holder.amount || 0);
          const percentage = totalSupply > 0 ? (amount / totalSupply) * 100 : 0;
          
          // Check for special addresses
          let typeLabel = '';
          if (holder.address === '11111111111111111111111111111111') {
            typeLabel = ' [BURN]';
          } else if (holder.address.includes('Program') || holder.address.includes('Token')) {
            typeLabel = ' [SYSTEM]';
          } else if (percentage > 25) {
            typeLabel = ' [WHALE]';
          } else if (percentage > 10) {
            typeLabel = ' [LARGE]';
          }
          
          console.log(`     ${i+1}. ${addr}: ${percentage.toFixed(2)}%${typeLabel}`);
        });
        
      } else {
        console.log(`   ❌ No holders found or invalid response`);
      }
      
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }
}

async function testWalletActivityOnly() {
  console.log('📊 Testing Wallet Activity API');
  console.log('==============================');
  
  // Test wallet addresses (example addresses for testing)
  const testWallets = [
    { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', name: 'BONK Large Holder' },
    { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', name: 'USDC Holder' },
    { address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', name: 'RAY Holder' }
  ];
  
  for (const wallet of testWallets) {
    console.log(`\n🔍 Testing wallet activity for ${wallet.name}:`);
    console.log(`   Address: ${wallet.address}`);
    
    try {
      const response = await axios.get('https://public-api.solscan.io/account/transactions', {
        params: {
          account: wallet.address,
          limit: 50
        },
        timeout: 15000,
        headers: {
          'User-Agent': 'CTO-Vetting-System/1.0'
        }
      });
      
      if (response.data && Array.isArray(response.data) && response.data.length > 0) {
        const transactions = response.data;
        console.log(`   ✅ Found ${transactions.length} recent transactions`);
        
        // Filter recent transactions (last 30 days)
        const cutoffTime = Date.now() / 1000 - (30 * 24 * 60 * 60);
        const recentTxs = transactions.filter(tx => 
          tx.blockTime && tx.blockTime > cutoffTime
        );
        
        console.log(`   📅 Recent (30 days): ${recentTxs.length} transactions`);
        
        // Analyze transaction patterns
        let sellCount = 0;
        let buyCount = 0;
        let totalVolume = 0;
        let recentSells = 0;
        
        const recentCutoff = Date.now() / 1000 - (7 * 24 * 60 * 60); // Last 7 days
        
        transactions.forEach(tx => {
          if (tx.tokenBalanceChanges && tx.tokenBalanceChanges.length > 0) {
            tx.tokenBalanceChanges.forEach(change => {
              const amount = Math.abs(parseFloat(change.amount || 0));
              totalVolume += amount;
              
              if (parseFloat(change.amount || 0) < 0) {
                sellCount++;
                if (tx.blockTime > recentCutoff) {
                  recentSells++;
                }
              } else if (parseFloat(change.amount || 0) > 0) {
                buyCount++;
              }
            });
          }
        });
        
        const sellRatio = (sellCount + buyCount) > 0 ? 
          sellCount / (sellCount + buyCount) : 0;
        
        console.log(`   📊 Activity Analysis:`);
        console.log(`     Total Sells: ${sellCount}`);
        console.log(`     Total Buys: ${buyCount}`);
        console.log(`     Sell Ratio: ${(sellRatio * 100).toFixed(1)}%`);
        console.log(`     Recent Sells (7d): ${recentSells}`);
        console.log(`     Total Volume: ${totalVolume.toLocaleString()}`);
        
        // Risk assessment
        let riskLevel = 'LOW';
        let riskReasons = [];
        
        if (sellRatio > 0.8) {
          riskLevel = 'VERY HIGH';
          riskReasons.push('High sell ratio (>80%)');
        } else if (sellRatio > 0.6) {
          riskLevel = 'HIGH';
          riskReasons.push('Moderate sell ratio (>60%)');
        } else if (sellRatio > 0.4) {
          riskLevel = 'MEDIUM';
          riskReasons.push('Elevated sell ratio (>40%)');
        }
        
        if (recentSells > 5) {
          riskLevel = riskLevel === 'LOW' ? 'MEDIUM' : 'HIGH';
          riskReasons.push('High recent selling activity');
        }
        
        if (totalVolume > 10000000) {
          riskReasons.push('Large trading volume');
        }
        
        console.log(`   ⚠️  Risk Level: ${riskLevel}`);
        if (riskReasons.length > 0) {
          console.log(`   📝 Risk Factors: ${riskReasons.join(', ')}`);
        }
        
        // Show recent activity summary
        if (recentTxs.length > 0) {
          console.log(`   🕒 Recent Activity:`);
          recentTxs.slice(0, 5).forEach((tx, i) => {
            const date = new Date(tx.blockTime * 1000).toLocaleDateString();
            const txType = tx.tokenBalanceChanges?.some(c => 
              parseFloat(c.amount || 0) < 0) ? 'SELL' : 'BUY';
            console.log(`     ${i+1}. ${date}: ${txType} - ${tx.txHash?.slice(0, 8)}...`);
          });
        }
        
      } else {
        console.log(`   ❌ No transactions found or invalid response`);
      }
      
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }
}

async function testSmartContractRisksOnly() {
  console.log('🔒 Testing Smart Contract Risk Analysis');
  console.log('======================================');
  
  const testTokens = [
    { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', name: 'BONK' },
    { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', name: 'USDC' },
    { address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', name: 'RAY' }
  ];
  
  for (const token of testTokens) {
    console.log(`\n🔍 Testing smart contract risks for ${token.name}:`);
    console.log(`   Address: ${token.address}`);
    
    try {
      // Test Helius getAccountInfo
      console.log(`   📡 Testing Helius getAccountInfo...`);
      const heliusResponse = await axios.post('https://mainnet.helius-rpc.com/?api-key=1a00b566-9c85-4b19-b219-d3875fbcb8d3', {
        jsonrpc: '2.0',
        id: 'test-token-info',
        method: 'getAccountInfo',
        params: [
          token.address,
          { encoding: 'jsonParsed' }
        ]
      }, {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (heliusResponse.data.result?.value) {
        const accountInfo = heliusResponse.data.result.value;
        const parsedData = accountInfo.data?.parsed;
        
        if (parsedData?.info) {
          const mintInfo = parsedData.info;
          
          console.log(`   ✅ Helius Data Retrieved:`);
          console.log(`     Mint Authority: ${mintInfo.mintAuthority || 'None'}`);
          console.log(`     Freeze Authority: ${mintInfo.freezeAuthority || 'None'}`);
          console.log(`     Supply: ${mintInfo.supply}`);
          console.log(`     Decimals: ${mintInfo.decimals}`);
          console.log(`     Initialized: ${mintInfo.isInitialized}`);
          
          // Authority risk assessment
          const authorities = [];
          if (mintInfo.mintAuthority) authorities.push('MINT');
          if (mintInfo.freezeAuthority) authorities.push('FREEZE');
          
          if (authorities.length === 0) {
            console.log(`     🟢 SECURITY: No authorities active - good decentralization`);
          } else {
            console.log(`     🔴 RISK: Active authorities detected: ${authorities.join(', ')}`);
            
            if (mintInfo.mintAuthority) {
              console.log(`       ⚠️  CRITICAL: Mint authority can inflate token supply`);
            }
            if (mintInfo.freezeAuthority) {
              console.log(`       ⚠️  HIGH: Freeze authority can freeze accounts`);
            }
          }
        } else {
          console.log(`   ❌ Unable to parse mint info from Helius response`);
        }
      } else {
        console.log(`   ❌ No account info found on Helius`);
      }
      
      // Test RugCheck API
      console.log(`   📡 Testing RugCheck API...`);
      try {
        const rugCheckResponse = await axios.get(`https://api.rugcheck.xyz/v1/tokens/${token.address}`, {
          timeout: 10000,
          headers: {
            'User-Agent': 'CTO-Vetting-System/1.0',
            'Accept': 'application/json'
          }
        });
        
        if (rugCheckResponse.data) {
          const rugData = rugCheckResponse.data;
          
          console.log(`   ✅ RugCheck Data Retrieved:`);
          console.log(`     Score: ${rugData.score || 'N/A'}`);
          console.log(`     Risk Level: ${rugData.riskLevel || 'Unknown'}`);
          console.log(`     Issues: ${rugData.issues?.length || 0}`);
          console.log(`     Warnings: ${rugData.warnings?.length || 0}`);
          
          if (rugData.issues && rugData.issues.length > 0) {
            console.log(`     🔴 Security Issues:`);
            rugData.issues.slice(0, 3).forEach((issue, i) => {
              console.log(`       ${i+1}. [${issue.severity?.toUpperCase()}] ${issue.title || issue.description}`);
            });
          }
          
          if (rugData.warnings && rugData.warnings.length > 0) {
            console.log(`     🟡 Warnings:`);
            rugData.warnings.slice(0, 2).forEach((warning, i) => {
              console.log(`       ${i+1}. ${warning.title || warning.description}`);
            });
          }
          
          if (rugData.summary) {
            console.log(`     📝 Summary: ${rugData.summary}`);
          }
        } else {
          console.log(`   ❌ No data received from RugCheck`);
        }
        
      } catch (rugError) {
        console.log(`   ⚠️  RugCheck API unavailable: ${rugError.message}`);
      }
      
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }
}

// Run test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  
  if (args.includes('--age-only')) {
    testProjectAgeOnly().catch(console.error);
  } else if (args.includes('--liquidity-only')) {
    testRaydiumLiquidityOnly().catch(console.error);
  } else if (args.includes('--lock-burn-only')) {
    testLPLockBurnOnly().catch(console.error);
  } else if (args.includes('--holders-only')) {
    testHolderDistributionOnly().catch(console.error);
  } else if (args.includes('--activity-only')) {
    testWalletActivityOnly().catch(console.error);
  } else if (args.includes('--security-only')) {
    testSmartContractRisksOnly().catch(console.error);
  } else {
    testApiIntegration().catch(console.error);
  }
}

export { testApiIntegration, testProjectAgeOnly, testRaydiumLiquidityOnly, testLPLockBurnOnly, testHolderDistributionOnly, testWalletActivityOnly, testSmartContractRisksOnly };
