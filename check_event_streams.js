const axios = require('axios');
const RPC = 'https://testnet.movementnetwork.xyz/v1';
const ADDR = '0xf63549750d7c0669d08420c80ba8eaa2e11293ef1567b14222372eadd05067fe';

async function checkEvents() {
    console.log('--- CHECKING EVENT STREAMS ---');
    try {
        // 1. Check FA Deposits (New Standard)
        // In Bardock, we check for event type 0x1::fungible_asset::Deposit
        const faRes = await axios.get(`${RPC}/accounts/${ADDR}/events/0x1::fungible_asset::Deposit?limit=10`);
        console.log(`\nFA Deposits Found: ${faRes.data.length}`);
        faRes.data.forEach(e => console.log(`- Amount: ${e.data.amount}, TX: ${e.version}`));

        // 2. Check Coin Deposits (Legacy Standard)
        // Handle might vary, usually it's under the CoinStore resource
        const res = await axios.get(`${RPC}/accounts/${ADDR}/resources`);
        const coinStore = res.data.find(r => r.type.includes('CoinStore'));
        if (coinStore && coinStore.data.deposit_events) {
            const handle = coinStore.data.deposit_events.guid.id.addr;
            const creation = coinStore.data.deposit_events.guid.id.creation_num;
            const coinRes = await axios.get(`${RPC}/accounts/${ADDR}/events/${handle}/${creation}?limit=10`);
            console.log(`\nCoin Deposits Found: ${coinRes.data.length}`);
        }
    } catch (e) {
        console.log('Error:', e.response?.data || e.message);
    }
}
checkEvents();


