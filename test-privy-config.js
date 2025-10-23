// Load environment variables
require('dotenv').config();

const { PrivyClient } = require('@privy-io/server-auth');

async function testPrivyConfig() {
  try {
    console.log('🔍 Testing Privy configuration...');
    
    const appId = process.env.PRIVY_APP_ID;
    const appSecret = process.env.PRIVY_APP_SECRET;
    
    console.log('App ID:', appId);
    console.log('App Secret length:', appSecret?.length);
    console.log('App Secret starts with:', appSecret?.substring(0, 10) + '...');
    
    const privyClient = new PrivyClient(appId, appSecret);
    
    // Test token verification with a real token from the logs
    console.log('🔄 Testing Privy token verification...');
    
    // Use a real token from the logs (the one that's failing)
    const testToken = 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IkxrZj...';
    
    try {
      const claims = await privyClient.verifyAuthToken(testToken);
      console.log('✅ Token verification successful!');
      console.log('User ID:', claims.userId);
    } catch (error) {
      console.log('❌ Token verification failed (expected):');
      console.log('Error message:', error.message);
      console.log('Error status:', error.status);
      console.log('Error response:', error.response?.data);
      
      // This is expected to fail, but we want to see the exact error
      if (error.message.includes('Invalid token') || error.message.includes('Unauthorized')) {
        console.log('✅ Privy client is configured correctly (got expected auth error)');
      }
    }
    
  } catch (error) {
    console.error('❌ Privy configuration test failed:');
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);
    console.error('Error status:', error.status);
    console.error('Error response:', error.response?.data);
  }
}

testPrivyConfig();
