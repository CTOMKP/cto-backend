import axios from 'axios';

const RPC_URL = 'https://testnet.movementnetwork.xyz/v1';
const USDC_ADDRESS = '0xf22bede237a07e121b56d91a491eb7bcdfd1f5907923fbd351543ed24c397811::asset::USDC';

async function verify() {
    try {
        // Check if the account that owns the USDC contract exists
        const owner = USDC_ADDRESS.split('::')[0];
        const res = await axios.get(`${RPC_URL}/accounts/${owner}`);
        console.log(`Owner ${owner} exists on Movement!`);
        
        // Try to get account resources for the owner to see if USDC is registered
        const resources = await axios.get(`${RPC_URL}/accounts/${owner}/resources`);
        const usdcInfo = resources.data.find((r: any) => r.type.includes('CoinInfo') && r.type.includes('USDC'));
        if (usdcInfo) {
            console.log('✅ Found USDC CoinInfo:', JSON.stringify(usdcInfo.data, null, 2));
        } else {
            console.log('❌ USDC CoinInfo not found on owner account.');
        }
    } catch (e: any) {
        console.error('Error:', e.message);
    }
}
verify();



