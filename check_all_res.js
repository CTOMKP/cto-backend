const axios = require('axios');
const RPC = 'https://testnet.movementnetwork.xyz/v1';
const ADDR = '0xf63549750d7c0669d08420c80ba8eaa2e11293ef1567b14222372eadd05067fe';

async function checkResources() {
    try {
        const res = await axios.get(`${RPC}/accounts/${ADDR}/resources`);
        console.log('--- ALL ACCOUNT RESOURCES ---');
        res.data.forEach(r => {
            console.log(`Type: ${r.type}`);
        });
    } catch (e) {
        console.log('Error:', e.message);
    }
}
checkResources();


