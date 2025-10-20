const axios = require('axios');

// Test the transaction endpoint fix
async function testTransactionEndpoint() {
  const BASE_URL = process.env.BACKEND_URL || 'http://localhost:3001';
  const TEST_USER = 'ctomarketplace2025@gmail.com';
  const TEST_WALLET_ID = '5e31fe4d-8778-58fe-92c2-d6a1fec6c649';

  console.log('🧪 Testing Transaction Endpoint Fix...\n');

  try {
    console.log('1️⃣ Testing wallet transactions endpoint...');
    const response = await axios.get(
      `${BASE_URL}/api/circle/wallets/${TEST_WALLET_ID}/transactions?userId=${TEST_USER}`
    );
    
    console.log('✅ Transaction endpoint working:', response.data);
    
  } catch (error) {
    console.log('❌ Transaction endpoint still failing:', error.response?.data || error.message);
    
    // Check if it's returning empty array (which is expected for new wallets)
    if (error.response?.data?.message?.includes('No transactions found')) {
      console.log('✅ This is expected - new wallet has no transactions yet');
    }
  }
}

// Run the test
if (require.main === module) {
  testTransactionEndpoint().catch(console.error);
}

module.exports = { testTransactionEndpoint };
