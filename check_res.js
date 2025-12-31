const axios = require('axios');
const RPC = 'https://testnet.movementnetwork.xyz/v1';
const ADDR = '0xf63549750d7c0669d08420c80ba8eaa2e11293ef1567b14222372eadd05067fe';

async function checkResources() {
    try {
        const res = await axios.get(`${RPC}/accounts/${ADDR}/resources`);
        console.log('--- ACCOUNT RESOURCES ---');
        res.data.forEach(r => {
            if (r.type.includes('CoinStore') || r.type.includes('FungibleStore')) {
                console.log(`\nType: ${r.type}`);
                console.log(`Data: ${JSON.stringify(r.data, null, 2)}`);
            }
        });
    } catch (e) {
        console.log('Error:', e.message);
    }
}
checkResources();


