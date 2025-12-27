const axios = require('axios');
const RPC = 'https://testnet.movementnetwork.xyz/v1';
const CLIENT_ADDR = '0x1745a447b0571a69c19d779db9ef05cfeffaa67ca74c8947aca81e0482e10523';

async function check() {
    console.log('--- CHECKING CLIENT WALLET ON BARDOCK ---');
    try {
        const res = await axios.get(`${RPC}/accounts/${CLIENT_ADDR}/resources`);
        const move = res.data.find(r => r.type === '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>');
        console.log('MOVE Balance:', move ? (move.data.coin.value / 100000000) : '0 (No Gas)');
    } catch (e) {
        console.log('❌ Account not found or 0 balance on Bardock.');
    }
}
check();

