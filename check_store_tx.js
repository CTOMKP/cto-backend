const axios = require('axios');
const RPC = 'https://testnet.movementnetwork.xyz/v1';
const STORE_ADDR = '0x775aaf89f45390e2590464dfe0641860b252d2db6633e24fdc1521c78b45512e';

async function checkStore() {
    try {
        const res = await axios.get(`${RPC}/accounts/${STORE_ADDR}/transactions?limit=10`);
        console.log(`Found ${res.data.length} transactions for Store Object.`);
    } catch (e) {
        console.log('Store Object has no transactions list.');
    }
}
checkStore();


