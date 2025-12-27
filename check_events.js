const axios = require('axios');
const RPC = 'https://testnet.movementnetwork.xyz/v1';
const HASH = '0xf65b6b508e760bbd85801e4ef28ddd9ccad3c3477ef05f4317d1c90d3a662644';

async function check() {
    try {
        const res = await axios.get(`${RPC}/transactions/by_hash/${HASH}`);
        console.log('--- TRANSACTION EVENTS ---');
        res.data.events.forEach((e, i) => {
            console.log(`Event ${i}: ${e.type}`);
            console.log(`Data: ${JSON.stringify(e.data)}`);
            if (e.guid) console.log(`GUID: ${JSON.stringify(e.guid)}`);
        });
    } catch (e) {
        console.log('Error:', e.message);
    }
}
check();

