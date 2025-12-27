const axios = require('axios');
const RPC = 'https://testnet.movementnetwork.xyz/v1';
const CLIENT_ADDR = '0x1745a447b0571a69c19d779db9ef05cfeffaa67ca74c8947aca81e0482e10523';
const USDC_FA = '0xb89077cfd2a82a0c1450534d49cfd5f2707643155273069bc23a912bcfefdee7';

async function check() {
    console.log('--- CHECKING CLIENT USDC ON BARDOCK ---');
    try {
        const viewRes = await axios.post(`${RPC}/view`, {
            function: '0x1::primary_fungible_store::balance',
            type_arguments: ['0x1::fungible_asset::Metadata'],
            arguments: [CLIENT_ADDR, USDC_FA]
        });
        console.log('USDC Balance:', viewRes.data[0] / 1000000);
    } catch (e) {
        console.log('❌ No USDC found or not initialized.');
    }
}
check();

