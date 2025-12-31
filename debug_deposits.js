const axios = require('axios');
const RPC = 'https://testnet.movementnetwork.xyz/v1';
const USER_ADDR = '0xf63549750d7c0669d08420c80ba8eaa2e11293ef1567b14222372eadd05067fe';
const USDC_METADATA = '0xb89077cfd2a82a0c1450534d49cfd5f2707643155273069bc23a912bcfefdee7';
const NIGHTLY_ADDR = '0x1745a447b0571a69c19d779db9ef05cfeffaa67ca74c8947aca81e0482e10523';

async function findStoreAndEvents() {
    try {
        const viewRes = await axios.post(`${RPC}/view`, {
            function: '0x1::primary_fungible_store::primary_store_address',
            type_arguments: ['0x1::fungible_asset::Metadata'],
            arguments: [USER_ADDR, USDC_METADATA]
        });
        const storeAddr = viewRes.data[0];
        console.log(`✅ User Store Address: ${storeAddr}`);

        console.log(`🔍 Checking transactions for Sender (Nightly): ${NIGHTLY_ADDR}...`);
        const txRes = await axios.get(`${RPC}/accounts/${NIGHTLY_ADDR}/transactions?limit=100`);
        console.log(`Found ${txRes.data.length} transactions for Sender.`);

        for (const tx of txRes.data) {
            const events = tx.events || [];
            for (const event of events) {
                if (event.type.includes('fungible_asset::Deposit')) {
                    if (event.data.store.toLowerCase() === storeAddr.toLowerCase()) {
                        console.log(`\n✨ MATCH! Found deposit to user's store in TX: ${tx.hash}`);
                        console.log(`   Amount: ${event.data.amount}`);
                        console.log(`   Time: ${new Date(parseInt(tx.timestamp)/1000)}`);
                    }
                }
            }
        }
    } catch (e) {
        console.error('Error:', e.response?.data || e.message);
    }
}
findStoreAndEvents();
