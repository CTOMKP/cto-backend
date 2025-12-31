const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const WALLET_ID = 'cmjldk9qh00cw13dowvw6rz5s';
const USDC_ADDR = '0xb89077cfd2a82a0c1450534d49cfd5f2707643155273069bc23a912bcfefdee7';

async function fixHistory() {
    console.log('--- MANUALLY RECORDING USDC DEPOSITS ---');
    
    const deposits = [
        {
            hash: '0xf65b6b508e760bbd85801e4ef28ddd9ccad3c3477ef05f4317d1c90d3a662644',
            amount: '2700000',
            desc: 'USDC deposit detected (2.7 USDC)'
        },
        {
            hash: '0x3979176640ce4c7770ac1860a55fec5d17387baf7157a991e1e1e7a1f039fafc',
            amount: '3500000',
            desc: 'USDC deposit detected (3.5 USDC)'
        }
    ];

    for (const d of deposits) {
        try {
            await prisma.walletTransaction.upsert({
                where: { txHash: d.hash },
                create: {
                    walletId: WALLET_ID,
                    txHash: d.hash,
                    txType: 'CREDIT',
                    amount: d.amount,
                    tokenAddress: USDC_ADDR,
                    tokenSymbol: 'USDC.e',
                    status: 'COMPLETED',
                    description: d.desc
                },
                update: {} // No update needed if exists
            });
            console.log(`✅ Recorded ${d.hash}`);
        } catch (e) {
            console.log(`❌ Failed to record ${d.hash}: ${e.message}`);
        }
    }
    await prisma.$disconnect();
}

fixHistory();


