const { PrismaClient } = require('@prisma/client');

async function checkRiskScores() {
  const prisma = new PrismaClient();
  
  try {
    // Check recent scan results
    const recentScans = await prisma.scanResult.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        contractAddress: true,
        riskScore: true,
        tier: true,
        createdAt: true,
        summary: true
      }
    });
    
    console.log('🔍 Recent Scan Results:');
    console.log('========================');
    recentScans.forEach(scan => {
      console.log(`Address: ${scan.contractAddress}`);
      console.log(`Risk Score: ${scan.riskScore}`);
      console.log(`Tier: ${scan.tier}`);
      console.log(`Created: ${scan.createdAt}`);
      console.log(`Summary: ${scan.summary?.substring(0, 100)}...`);
      console.log('---');
    });
    
    // Check listings with risk scores
    const listingsWithRisk = await prisma.listing.findMany({
      where: {
        riskScore: { not: null }
      },
      select: {
        contractAddress: true,
        riskScore: true,
        tier: true,
        lastScannedAt: true
      },
      take: 10
    });
    
    console.log('\n📊 Listings with Risk Scores:');
    console.log('=============================');
    listingsWithRisk.forEach(listing => {
      console.log(`Address: ${listing.contractAddress}`);
      console.log(`Risk Score: ${listing.riskScore}`);
      console.log(`Tier: ${listing.tier}`);
      console.log(`Last Scanned: ${listing.lastScannedAt}`);
      console.log('---');
    });
    
    // Count total listings vs scanned
    const totalListings = await prisma.listing.count();
    const scannedListings = await prisma.listing.count({
      where: { riskScore: { not: null } }
    });
    
    console.log('\n📈 Summary:');
    console.log('===========');
    console.log(`Total Listings: ${totalListings}`);
    console.log(`Scanned Listings: ${scannedListings}`);
    console.log(`Unscanned: ${totalListings - scannedListings}`);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkRiskScores();
