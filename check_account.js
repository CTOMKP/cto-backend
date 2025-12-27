const axios = require('axios');

const RPC_URL = 'https://testnet.movementnetwork.xyz/v1';
const LZ_ACC = '0x275f508601db54316982947c61f5162479f64866f830302ad9372136e0d37e19';

async function run() {
  console.log('Checking LayerZero account on Movement Bardock...');
  try {
    const res = await axios.get(`${RPC_URL}/accounts/${LZ_ACC}/resources`);
    const usdcResource = res.data.find(r => r.type.includes('USDC'));
    if (usdcResource) {
      console.log('✅ FOUND USDC:', usdcResource.type);
    } else {
      console.log('❌ Account exists but no USDC found.');
    }
  } catch (e) {
    console.log('❌ Account not found on this network (404). Trying a broad search...');
    try {
        // Try the other address Gemini mentioned
        const APT_ACC = '0x69091fbab5f7d635ee7ac5098cf0c1efbe31d68fec0f2cd565e8d168daf52832';
        const res2 = await axios.get(`${RPC_URL}/accounts/${APT_ACC}/resources`);
        const usdcResource2 = res2.data.find(r => r.type.includes('USDC'));
        if (usdcResource2) {
            console.log('✅ FOUND USDC (Aptos Mirror):', usdcResource2.type);
        } else {
            console.log('❌ Aptos Mirror account exists but no USDC found.');
        }
    } catch (e2) {
        console.log('❌ No standard USDC found. We might need to use a custom mock USDC.');
    }
  }
}

run();



