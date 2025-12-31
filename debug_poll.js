const axios = require('axios');
const RPC = 'https://testnet.movementnetwork.xyz/v1';
const WALLET_ADDR = '0xf63549750d7c0669d08420c80ba8eaa2e11293ef1567b14222372eadd05067fe';
const USDC_FA = '0xb89077cfd2a82a0c1450534d49cfd5f2707643155273069bc23a912bcfefdee7';

async function debugPoll() {
    console.log('--- DEBUGGING POLL LOGIC ---');
    try {
        const response = await axios.get(`${RPC}/accounts/${WALLET_ADDR}/transactions?limit=10`);
        const blockchainTxs = response.data || [];
        
        console.log(`Found ${blockchainTxs.length} transactions on chain.`);

        for (const tx of blockchainTxs) {
            if (tx.type !== 'user_transaction' || !tx.success) continue;
            
            console.log(`\nProcessing TX: ${tx.hash}`);
            const events = tx.events || [];
            
            for (const event of events) {
                console.log(`  Checking Event: ${event.type}`);
                
                if (event.type.includes('coin::DepositEvent')) {
                    console.log('  ✅ Matches coin::DepositEvent');
                } else if (event.type.includes('coin::WithdrawEvent')) {
                    console.log(`  ✅ Matches coin::WithdrawEvent (Sender: ${tx.sender === WALLET_ADDR})`);
                } else if (event.type.includes('fungible_asset::Deposit')) {
                    console.log('  ✅ Matches fungible_asset::Deposit');
                    console.log('  Data:', JSON.stringify(event.data));
                } else if (event.type.includes('fungible_asset::Withdraw')) {
                    console.log(`  ✅ Matches fungible_asset::Withdraw (Sender: ${tx.sender === WALLET_ADDR})`);
                }
            }
        }
    } catch (e) {
        console.log('Error:', e.message);
    }
}

debugPoll();


