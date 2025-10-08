const axios = require('axios');

// Test configuration
const BASE_URL = process.env.BACKEND_URL || 'http://localhost:3001';
const TEST_USER = {
  email: 'test@example.com',
  password: 'testpassword123'
};

// Test data
const testCCTPTransfer = {
  userId: TEST_USER.email,
  sourceChain: 'ETHEREUM',
  destinationChain: 'BASE',
  amount: 10.0,
  destinationAddress: '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6'
};

const testWormholeAttestation = {
  txHash: '0x1234567890abcdef1234567890abcdef12345678',
  sourceChain: 'ETHEREUM',
  destinationChain: 'BASE'
};

const testPanoraSwap = {
  userId: TEST_USER.email,
  fromToken: '0xA0b86a33E6441b8C4C8C0C8C0C8C0C8C0C8C0C8C',
  toToken: '0xB0b86a33E6441b8C4C8C0C8C0C8C0C8C0C8C0C8C',
  amount: 100.0,
  slippage: 0.5,
  chain: 'ETHEREUM'
};

async function testTransferEndpoints() {
  console.log('🧪 Testing CTO Transfer System...\n');

  try {
    // Test 1: CCTP Transfer
    console.log('1️⃣ Testing CCTP Transfer...');
    try {
      const cctpResponse = await axios.post(`${BASE_URL}/api/transfers/cctp`, testCCTPTransfer);
      console.log('✅ CCTP Transfer:', cctpResponse.data);
    } catch (error) {
      console.log('❌ CCTP Transfer failed:', error.response?.data || error.message);
    }

    // Test 2: Wormhole Attestation
    console.log('\n2️⃣ Testing Wormhole Attestation...');
    try {
      const attestationResponse = await axios.post(`${BASE_URL}/api/transfers/wormhole/attestation`, testWormholeAttestation);
      console.log('✅ Wormhole Attestation:', attestationResponse.data);
    } catch (error) {
      console.log('❌ Wormhole Attestation failed:', error.response?.data || error.message);
    }

    // Test 3: Panora Swap
    console.log('\n3️⃣ Testing Panora Swap...');
    try {
      const swapResponse = await axios.post(`${BASE_URL}/api/transfers/panora/swap`, testPanoraSwap);
      console.log('✅ Panora Swap:', swapResponse.data);
    } catch (error) {
      console.log('❌ Panora Swap failed:', error.response?.data || error.message);
    }

    // Test 4: Transaction Status
    console.log('\n4️⃣ Testing Transaction Status...');
    try {
      const statusResponse = await axios.get(`${BASE_URL}/api/transfers/status/test-tx-123?userId=${TEST_USER.email}`);
      console.log('✅ Transaction Status:', statusResponse.data);
    } catch (error) {
      console.log('❌ Transaction Status failed:', error.response?.data || error.message);
    }

  } catch (error) {
    console.error('❌ Test suite failed:', error.message);
  }
}

async function testCircleAuth() {
  console.log('\n🔐 Testing Circle Authentication...\n');

  try {
    // Test user creation
    console.log('1️⃣ Testing User Creation...');
    const createUserResponse = await axios.post(`${BASE_URL}/api/circle/users`, {
      userId: TEST_USER.email,
      email: TEST_USER.email,
      password: TEST_USER.password
    });
    console.log('✅ User Creation:', createUserResponse.data);

    // Test user login
    console.log('\n2️⃣ Testing User Login...');
    const loginResponse = await axios.post(`${BASE_URL}/api/circle/users/login`, {
      userId: TEST_USER.email,
      password: TEST_USER.password
    });
    console.log('✅ User Login:', loginResponse.data);

    // Test wallet creation
    console.log('\n3️⃣ Testing Wallet Creation...');
    const walletResponse = await axios.post(`${BASE_URL}/api/circle/wallets`, {
      userId: TEST_USER.email,
      blockchain: 'ETHEREUM',
      description: 'Test wallet for transfers'
    });
    console.log('✅ Wallet Creation:', walletResponse.data);

  } catch (error) {
    console.log('❌ Circle Auth failed:', error.response?.data || error.message);
  }
}

async function runAllTests() {
  console.log('🚀 Starting CTO Transfer System Tests\n');
  console.log(`📍 Backend URL: ${BASE_URL}\n`);

  await testCircleAuth();
  await testTransferEndpoints();

  console.log('\n✨ Test suite completed!');
  console.log('\n📝 Next Steps:');
  console.log('1. Set up your Circle API keys in environment variables');
  console.log('2. Configure Wormhole and Panora API keys');
  console.log('3. Test with real transactions on testnet');
  console.log('4. Deploy to production with proper security measures');
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = { testTransferEndpoints, testCircleAuth, runAllTests };
