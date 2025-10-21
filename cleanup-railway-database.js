/**
 * Railway Database Cleanup Script
 * 
 * This script connects to the Railway PostgreSQL database
 * and deletes old Listing and ScanResult records,
 * keeping only the latest 100 of each.
 * 
 * Usage: 
 * 1. Set RAILWAY_DATABASE_URL environment variable
 * 2. Run: node cleanup-railway-database.js
 */

const { PrismaClient } = require('@prisma/client');

// Use Railway database URL from environment
const databaseUrl = process.env.RAILWAY_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('❌ Error: DATABASE_URL or RAILWAY_DATABASE_URL environment variable not set!');
  console.log('\nUsage:');
  console.log('  Set RAILWAY_DATABASE_URL="postgresql://user:pass@host:port/db"');
  console.log('  Then run: node cleanup-railway-database.js');
  process.exit(1);
}

console.log('🔗 Connecting to Railway database...');
console.log(`📍 Host: ${new URL(databaseUrl).host}`);

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl
    }
  }
});

async function cleanup() {
  try {
    console.log('\n🧹 Starting Railway database cleanup...\n');

    // Test connection
    await prisma.$connect();
    console.log('✅ Connected to Railway database\n');

    // 1. Get current counts
    const listingCount = await prisma.listing.count();
    const scanCount = await prisma.scanResult.count();
    
    console.log(`📊 Current records:`);
    console.log(`   - Listings: ${listingCount}`);
    console.log(`   - Scan Results: ${scanCount}\n`);

    if (listingCount <= 100 && scanCount <= 100) {
      console.log('✨ Database is already clean! No cleanup needed.');
      return;
    }

    // 2. Clean up Listings - keep only latest 100
    console.log('📊 Cleaning Listing table...');
    const listingsToKeep = await prisma.listing.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: { id: true }
    });

    const listingIds = listingsToKeep.map(l => l.id);
    
    const deletedListings = await prisma.listing.deleteMany({
      where: {
        id: { notIn: listingIds }
      }
    });

    console.log(`✅ Deleted ${deletedListings.count} old listings`);
    console.log(`✅ Kept ${listingsToKeep.length} recent listings\n`);

    // 3. Clean up ScanResults - keep only latest 100
    console.log('🔍 Cleaning ScanResult table...');
    const scansToKeep = await prisma.scanResult.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true }
    });

    const scanIds = scansToKeep.map(s => s.id);
    
    const deletedScans = await prisma.scanResult.deleteMany({
      where: {
        id: { notIn: scanIds }
      }
    });

    console.log(`✅ Deleted ${deletedScans.count} old scan results`);
    console.log(`✅ Kept ${scansToKeep.length} recent scan results\n`);

    // 4. Verify new counts
    const newListingCount = await prisma.listing.count();
    const newScanCount = await prisma.scanResult.count();

    // 5. Summary
    console.log('=' .repeat(60));
    console.log('🎉 Railway Database Cleanup Complete!');
    console.log('=' .repeat(60));
    console.log(`Before: ${listingCount} listings, ${scanCount} scans`);
    console.log(`After:  ${newListingCount} listings, ${newScanCount} scans`);
    console.log(`Total deleted: ${deletedListings.count + deletedScans.count} records`);
    console.log('\n✨ Railway database is now lean and clean!');

  } catch (error) {
    console.error('❌ Cleanup failed:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

cleanup();

