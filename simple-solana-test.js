const { Connection, PublicKey } = require('@solana/web3.js');
const { getMint } = require('@solana/spl-token');

async function simpleSolanaTest() {
  console.log('🧪 Simple Solana RPC test...');
  
  try {
    const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
    
    // Test with a well-known token
    const tokenMint = new PublicKey('So11111111111111111111111111111111111111112'); // Wrapped SOL
    
    console.log('1️⃣ Testing basic connection...');
    const version = await connection.getVersion();
    console.log(`✅ Solana version: ${version['solana-core']}`);
    
    console.log('\n2️⃣ Testing token supply...');
    const supply = await connection.getTokenSupply(tokenMint);
    console.log(`✅ Token supply: ${supply.value.amount}`);
    
    console.log('\n3️⃣ Testing mint authority...');
    const mintInfo = await getMint(connection, tokenMint);
    console.log(`✅ Mint authority: ${mintInfo.mintAuthority?.toString() || 'null'}`);
    console.log(`✅ Mint authority disabled: ${mintInfo.mintAuthority === null}`);
    
    console.log('\n4️⃣ Testing account info...');
    const accountInfo = await connection.getAccountInfo(tokenMint);
    console.log(`✅ Account exists: ${accountInfo !== null}`);
    
    console.log('\n🎉 Basic Solana RPC integration is working!');
    console.log('\n📝 Note: Full token analysis requires more complex queries');
    console.log('   - Token accounts analysis needs specialized RPC methods');
    console.log('   - Transaction analysis requires historical data queries');
    console.log('   - Consider using Helius or other enhanced RPC providers');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

simpleSolanaTest();
