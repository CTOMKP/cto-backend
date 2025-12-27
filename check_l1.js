const axios = require('axios');
const RPC = 'https://testnet.movementnetwork.xyz/v1';
const ADDR = '0xf63549750d7c0669d08420c80ba8eaa2e11293ef1567b14222372eadd05067fe';

async function check() {
    console.log('--- MOVEMENT FULL RESOURCE CHECK ---');
    console.log('Wallet:', ADDR);
    
    try {
        const res = await axios.get(`${RPC}/accounts/${ADDR}/resources`);
        console.log('✅ Found', res.data.length, 'resources.');
        
        console.log('\n--- Tokens Found ---');
        res.data.forEach(r => {
            // Check for Coins (Legacy)
            if (r.type.includes('0x1::coin::CoinStore')) {
                const coinType = r.type.match(/<(.*)>/)[1];
                const balance = r.data.coin.value;
                console.log(`Coin: ${coinType}`);
                console.log(`Balance: ${balance}`);
            }
            
            // Check for Fungible Assets (Modern)
            if (r.type.includes('fungible_asset::FungibleStore')) {
                console.log(`FA Store Found: ${r.type}`);
                console.log(`Metadata: ${r.data.metadata.handle}`);
                console.log(`Balance: ${r.data.balance}`);
            }
        });

    } catch (e) {
        console.log('❌ Error:', e.message);
    }
    console.log('---------------------------------');
}

check();
