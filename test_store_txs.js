const axios = require('axios');
const RPC = 'https://testnet.movementnetwork.xyz/v1';
const STORE_ADDR = '0x775aaf89f45390e2590464dfe0641860b252d2db6633e24fdc1521c78b45512e';

async function testStoreTxs() {
    try {
        const res = await axios.get(`${RPC}/accounts/${STORE_ADDR}/transactions?limit=100`);
        console.log('✅ Found transactions:', res.data.length);
        res.data.forEach(tx => console.log(`- TX: ${tx.hash}`));
    } catch (e) {
        console.log('❌ Error:', e.response?.status, e.response?.data);
    }
}
testStoreTxs();

