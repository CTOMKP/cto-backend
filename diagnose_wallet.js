const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const prisma = new PrismaClient();

const TARGET_ADDR = '0xf63549750d7c0669d08420c80ba8eaa2e11293ef1567b14222372eadd05067fe';
const RPC_URL = 'https://testnet.movementnetwork.xyz/v1';
const USDC_FA = '0xb89077cfd2a82a0c1450534d49cfd5f2707643155273069bc23a912bcfefdee7';

async function diagnose() {
    console.log('--- DIAGNOSIS START ---');
    
    // 1. Check Blockchain
    try {
        console.log(`Checking Blockchain for ${TARGET_ADDR}...`);
        const res = await axios.get(`${RPC_URL}/accounts/${TARGET_ADDR}/resources`);
        console.log('✅ Found account on blockchain.');
        
        const move = res.data.find(r => r.type === '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>');
        if (move) {
            console.log(`MOVE Balance: ${move.data.coin.value / 100000000}`);
        } else {
            console.log('❌ No MOVE found.');
        }

        // FA Balance Check via View Function
        try {
            const viewRes = await axios.post(`${RPC_URL}/view`, {
                function: '0x1::primary_fungible_store::balance',
                type_arguments: ['0x1::fungible_asset::Metadata'],
                arguments: [TARGET_ADDR, USDC_FA]
            });
            console.log(`USDC Balance: ${viewRes.data[0] / 1000000}`);
        } catch (faErr) {
            console.log('❌ Could not fetch USDC balance (maybe not initialized).');
        }
    } catch (e) {
        console.log(`❌ Blockchain Error: ${e.message}`);
    }

    // 2. Check Database
    try {
        console.log('Checking Database...');
        const wallet = await prisma.wallet.findFirst({
            where: { address: { contains: TARGET_ADDR.slice(2), mode: 'insensitive' } },
            include: { balances: true, transactions: true, user: true }
        });

        if (wallet) {
            console.log('✅ Wallet found in DB:');
            console.log(`- ID: ${wallet.id}`);
            console.log(`- Blockchain: ${wallet.blockchain}`);
            console.log(`- User Email: ${wallet.user?.email}`);
            console.log(`- Last Synced: ${wallet.updatedAt}`);
            console.log(`- Balances: ${wallet.balances.length} entries`);
            console.log(`- Transactions: ${wallet.transactions.length} entries`);
        } else {
            console.log('❌ Wallet NOT found in DB.');
        }
    } catch (e) {
        console.log(`❌ DB Error: ${e.message}`);
    }

    console.log('--- DIAGNOSIS END ---');
    await prisma.$disconnect();
}

diagnose();

