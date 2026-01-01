import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const listings = await prisma.listing.findMany({
    select: {
      address: true,
      symbol: true,
      chain: true,
      isPinned: true,
    }
  });
  console.log(JSON.stringify(listings, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


const prisma = new PrismaClient();

async function main() {
  const listings = await prisma.listing.findMany({
    select: {
      address: true,
      symbol: true,
      chain: true,
      isPinned: true,
    }
  });
  console.log(JSON.stringify(listings, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

