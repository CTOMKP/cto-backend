const axios = require('axios');
const RPC = 'https://testnet.movementnetwork.xyz/v1';
const STORE_ADDR = '0x775aaf89f45390e2590464dfe0641860b252d2db6633e24fdc1521c78b45512e';

async function testEvents() {
    try {
        const res = await axios.get(`${RPC}/accounts/${STORE_ADDR}/events/0x1::fungible_asset::Deposit`);
        console.log('✅ Found events:', res.data.length);
        res.data.forEach(ev => {
            console.log(`- Version: ${ev.version}, Amount: ${ev.data.amount}`);
        });
    } catch (e) {
        console.log('❌ Error:', e.response?.status, e.response?.data);
    }
}
testEvents();
