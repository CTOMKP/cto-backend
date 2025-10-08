const axios = require('axios');

async function testPanoraCorrectAPI() {
  const apiKey = 'a4^KV_EaTf4MW#ZdvgGKX#HUD^3IFEAOV_kzpIE^3BQGA8pDnrkT7JcIy#HNlLGi';
  const baseUrl = 'https://api.panora.exchange';
  
  console.log('Testing Panora API with correct structure...');
  console.log('Base URL:', baseUrl);
  console.log('API Key:', apiKey.substring(0, 10) + '...');
  
  try {
    // Test the correct /swap endpoint with query parameters
    console.log('\nTesting /swap endpoint with correct structure...');
    
    const queryParams = new URLSearchParams({
      fromTokenAddress: '0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b', // USDC
      toTokenAddress: '0xa', // APT
      fromTokenAmount: '100',
      toWalletAddress: '0x1c3206329806286fd2223647c9f9b130e66baeb6d7224a18c1f642ffe48f3b4c', // Example wallet
      slippagePercentage: '0.5'
    });
    
    const response = await axios.post(
      `${baseUrl}/swap?${queryParams.toString()}`,
      {},
      {
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ Success! Response:', JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    console.log('❌ Error:', error.response?.data || error.message);
    console.log('Status:', error.response?.status);
    if (error.response?.data) {
      console.log('Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

testPanoraCorrectAPI().catch(console.error);
