const axios = require('axios');
const RPC = 'https://testnet.movementnetwork.xyz/v1';
const CLIENT = '0x1745a447b0571a69c19d779db9ef05cfeffaa67ca74c8947aca81e0482e10523';

async function check() {
    console.log('--- SCANNING CLIENT TRANSACTIONS ---');
    try {
        const res = await axios.get(`${RPC}/accounts/${CLIENT}/transactions?limit=10`);
        const txs = res.data;
        console.log(`Found ${txs.length} transactions.`);
        
        txs.forEach(tx => {
            if (tx.success) {
                console.log(`\nHash: ${tx.hash}`);
                console.log(`Type: ${tx.type}`);
                if (tx.payload) {
                    console.log(`Function: ${tx.payload.function}`);
                    console.log(`Args: ${JSON.stringify(tx.payload.arguments)}`);
                }
            }
        });
    } catch (e) {
        console.log('Error:', e.message);
    }
}
check();

