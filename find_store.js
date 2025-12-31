const axios = require('axios');
const RPC = 'https://testnet.movementnetwork.xyz/v1';
const ADDR = '0xf63549750d7c0669d08420c80ba8eaa2e11293ef1567b14222372eadd05067fe';
const USDC_FA = '0xb89077cfd2a82a0c1450534d49cfd5f2707643155273069bc23a912bcfefdee7';

async function findStore() {
    try {
        const res = await axios.post(`${RPC}/view`, {
            function: '0x1::primary_fungible_store::primary_store_address',
            type_arguments: ['0x1::fungible_asset::Metadata'],
            arguments: [ADDR, USDC_FA]
        });
        const storeAddr = res.data[0];
        console.log('--- PRIMARY STORE ADDRESS ---');
        console.log(`Store: ${storeAddr}`);

        // Now check resources of that STORE object
        const storeRes = await axios.get(`${RPC}/accounts/${storeAddr}/resources`);
        console.log('\n--- STORE RESOURCES ---');
        storeRes.data.forEach(r => {
            console.log(`Type: ${r.type}`);
            if (r.type.includes('FungibleStore')) {
                console.log('Data:', JSON.stringify(r.data, null, 2));
            }
        });
    } catch (e) {
        console.log('Error:', e.response?.data || e.message);
    }
}
findStore();
