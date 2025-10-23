const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testPrismaFields() {
  try {
    console.log('🧪 Testing Prisma fields...');
    
    // Try to create a listing with the new fields
    const testListing = await prisma.listing.create({
      data: {
        contractAddress: 'test-address-' + Date.now(),
        chain: 'SOLANA',
        category: 'MEME',
        symbol: 'TEST',
        name: 'Test Token',
        // New filter fields
        lpBurnedPercentage: 50.5,
        top10HoldersPercentage: 25.3,
        mintAuthDisabled: true,
        raidingDetected: false,
      }
    });
    
    console.log('✅ Successfully created listing with new fields:', testListing.id);
    
    // Clean up
    await prisma.listing.delete({
      where: { id: testListing.id }
    });
    
    console.log('✅ Test passed - new fields are working!');
    
  } catch (error) {
    console.error('❌ Error testing Prisma fields:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

testPrismaFields();
