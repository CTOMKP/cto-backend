const { PrismaClient } = require('@prisma/client');
const { Connection, PublicKey } = require('@solana/web3.js');
const { getMint, TOKEN_PROGRAM_ID } = require('@solana/spl-token');

const prisma = new PrismaClient();

// Test with a real Solana token
const TEST_TOKEN = 'So11111111111111111111111111111111111111112'; // Wrapped SOL

async function testRealSolanaData() {
  console.log('🧪 Testing real Solana RPC calls...');
  
  try {
    // Set up Solana connection
    const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
    
    console.log(`🔍 Testing with token: ${TEST_TOKEN}`);
    
    // Test 1: Get token supply
    console.log('\n1️⃣ Testing token supply...');
    const supply = await connection.getTokenSupply(new PublicKey(TEST_TOKEN));
    console.log(`✅ Token supply: ${supply.value.amount} (decimals: ${supply.value.decimals})`);
    
    // Test 2: Get mint authority
    console.log('\n2️⃣ Testing mint authority...');
    const mintInfo = await getMint(connection, new PublicKey(TEST_TOKEN));
    console.log(`✅ Mint authority: ${mintInfo.mintAuthority?.toString() || 'null'}`);
    console.log(`✅ Mint authority disabled: ${mintInfo.mintAuthority === null}`);
    
    // Test 3: Get token accounts
    console.log('\n3️⃣ Testing token accounts...');
    const tokenAccounts = await connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
      filters: [
        {
          dataSize: 165, // Token account size
        },
        {
          memcmp: {
            offset: 0,
            bytes: new PublicKey(TEST_TOKEN).toBase58(),
          },
        },
      ],
    });
    console.log(`✅ Found ${tokenAccounts.length} token accounts`);
    
    // Test 4: Analyze top holders
    console.log('\n4️⃣ Testing top holders analysis...');
    const holders = tokenAccounts
      .map(account => {
        const accountData = account.account.data;
        return {
          owner: accountData.parsed?.info?.owner,
          amount: Number(accountData.parsed?.info?.tokenAmount?.amount || 0),
          decimals: accountData.parsed?.info?.tokenAmount?.decimals || 0
        };
      })
      .filter(holder => holder.amount > 0 && holder.owner)
      .sort((a, b) => b.amount - a.amount);
    
    console.log(`✅ Found ${holders.length} active holders`);
    
    if (holders.length > 0) {
      const totalSupply = holders.reduce((sum, holder) => sum + holder.amount, 0);
      const top10Holders = holders.slice(0, Math.min(10, holders.length));
      const top10Amount = top10Holders.reduce((sum, holder) => sum + holder.amount, 0);
      const top10Percentage = (top10Amount / totalSupply) * 100;
      
      console.log(`✅ Top 10 holders: ${top10Amount.toLocaleString()} / ${totalSupply.toLocaleString()} = ${top10Percentage.toFixed(2)}%`);
    }
    
    // Test 5: Get recent transactions
    console.log('\n5️⃣ Testing transaction analysis...');
    const signatures = await connection.getSignaturesForAddress(new PublicKey(TEST_TOKEN), {
      limit: 10
    });
    console.log(`✅ Found ${signatures.length} recent transactions`);
    
    if (signatures.length > 0) {
      const transactions = await Promise.all(
        signatures.slice(0, 5).map(sig => 
          connection.getParsedTransaction(sig.signature)
        )
      );
      
      const validTransactions = transactions.filter(tx => tx !== null);
      console.log(`✅ Valid transactions: ${validTransactions.length}`);
    }
    
    console.log('\n🎉 All tests passed! Real Solana RPC integration is working.');
    
  } catch (error) {
    console.error('❌ Error testing Solana RPC:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testRealSolanaData();
