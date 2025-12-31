const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkDb() {
    const userAddr = '0xf63549750d7c0669d08420c80ba8eaa2e11293ef1567b14222372eadd05067fe';
    const wallet = await prisma.wallet.findFirst({
        where: { address: userAddr }
    });

    if (!wallet) {
        console.log('Wallet not found in DB');
        return;
    }

    console.log(`Wallet ID: ${wallet.id}`);
    
    const balances = await prisma.walletBalance.findMany({
        where: { walletId: wallet.id }
    });
    console.log('Balances:', JSON.stringify(balances, null, 2));

    const txs = await prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' }
    });
    console.log('Transactions:', JSON.stringify(txs, null, 2));
}

checkDb().finally(() => prisma.$disconnect());

