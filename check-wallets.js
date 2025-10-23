const { PrismaClient } = require('@prisma/client');

async function checkWallets() {
  const prisma = new PrismaClient();
  
  try {
    console.log('🔍 Checking wallets in database...\n');
    
    // Get all users
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        privyUserId: true,
        wallets: {
          select: {
            id: true,
            address: true,
            blockchain: true,
            walletClient: true,
            isPrimary: true,
            type: true
          }
        }
      }
    });
    
    console.log(`Found ${users.length} users:\n`);
    
    users.forEach(user => {
      console.log(`👤 User ${user.id}: ${user.email}`);
      console.log(`   Privy ID: ${user.privyUserId}`);
      console.log(`   Wallets (${user.wallets.length}):`);
      
      if (user.wallets.length === 0) {
        console.log('   ❌ No wallets found!');
      } else {
        user.wallets.forEach(wallet => {
          console.log(`   💼 ${wallet.address} (${wallet.blockchain}, ${wallet.walletClient}, ${wallet.type}, Primary: ${wallet.isPrimary})`);
        });
      }
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkWallets();
