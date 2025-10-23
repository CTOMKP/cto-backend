const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function populateMockData() {
  console.log('🔄 Populating mock filter data...');
  
  try {
    // Get some existing listings
    const listings = await prisma.listing.findMany({
      take: 50, // Update first 50 listings
      select: { id: true, contractAddress: true }
    });
    
    console.log(`📊 Found ${listings.length} listings to update`);
    
    for (const listing of listings) {
      // Generate realistic mock data
      const lpBurned = Math.random() > 0.7 
        ? Math.random() * 30 + 50  // 50-80% for some tokens
        : Math.random() * 50;      // 0-50% for others
        
      const top10Holders = Math.random() > 0.6
        ? Math.random() * 20       // 0-20% for decentralized
        : Math.random() * 30 + 20; // 20-50% for concentrated
        
      const mintAuthDisabled = Math.random() > 0.3; // 70% disabled
      const raidingDetected = Math.random() > 0.85;  // 15% raiding
      
      await prisma.listing.update({
        where: { id: listing.id },
        data: {
          lpBurnedPercentage: Math.round(lpBurned * 10) / 10,
          top10HoldersPercentage: Math.round(top10Holders * 10) / 10,
          mintAuthDisabled,
          raidingDetected,
        }
      });
      
      console.log(`✅ Updated ${listing.contractAddress}: LP=${lpBurned.toFixed(1)}%, Top10=${top10Holders.toFixed(1)}%, Mint=${mintAuthDisabled}, Raiding=${raidingDetected}`);
    }
    
    console.log('🎉 Mock data population complete!');
    
  } catch (error) {
    console.error('❌ Error populating mock data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

populateMockData();
