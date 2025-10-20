const axios = require('axios');

async function testPanoraAPI() {
  const apiKey = 'a4^KV_EaTf4MW#ZdvgGKX#HUD^3IFEAOV_kzpIE^3BQGA8pDnrkT7JcIy#HNlLGi';
  const baseUrl = 'https://api.panora.exchange';
  
  console.log('Testing Panora API...');
  console.log('Base URL:', baseUrl);
  console.log('API Key:', apiKey.substring(0, 10) + '...');
  
  try {
    // Test 1: Try to get API info
    console.log('\n1. Testing API info endpoint...');
    const infoResp = await axios.get(`${baseUrl}/`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('API Info Response:', infoResp.data);
  } catch (error) {
    console.log('API Info Error:', error.response?.data || error.message);
  }
  
  try {
    // Test 2: Try quote endpoint
    console.log('\n2. Testing quote endpoint...');
    const quoteResp = await axios.post(`${baseUrl}/quote`, {
      fromToken: 'USDC',
      toToken: 'PEPE',
      amount: 1,
      chain: 'ETHEREUM',
      slippage: 0.5
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('Quote Response:', quoteResp.data);
  } catch (error) {
    console.log('Quote Error:', error.response?.data || error.message);
    console.log('Status:', error.response?.status);
    console.log('Headers:', error.response?.headers);
  }
  
  try {
    // Test 3: Try different endpoint structure
    console.log('\n3. Testing /api/v1/quote endpoint...');
    const quoteResp2 = await axios.post(`${baseUrl}/api/v1/quote`, {
      fromToken: 'USDC',
      toToken: 'PEPE',
      amount: 1,
      chain: 'ETHEREUM',
      slippage: 0.5
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('Quote Response 2:', quoteResp2.data);
  } catch (error) {
    console.log('Quote Error 2:', error.response?.data || error.message);
  }
}

testPanoraAPI().catch(console.error);
