import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const eligible = await prisma.user.findMany({
    where: {
      xpTransactions: {
        none: { reason: 'signup' },
      },
    },
    select: { id: true, xpBalance: true },
  });

  if (eligible.length === 0) {
    console.log('No users need signup XP backfill.');
    return;
  }

  let processed = 0;
  for (const user of eligible) {
    const current = user.xpBalance ?? 0;
    const nextBalance = current + 8;

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { xpBalance: nextBalance },
      }),
      prisma.xpTransaction.create({
        data: {
          userId: user.id,
          type: 'EARN',
          reason: 'signup',
          amount: 8,
          balanceAfter: nextBalance,
          metadata: { source: 'backfill' },
        },
      }),
    ]);

    processed++;
  }

  console.log(`Signup XP backfill complete. Users updated: ${processed}`);
}

main()
  .catch((err) => {
    console.error('Signup XP backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
