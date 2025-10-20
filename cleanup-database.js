/**
 * Database Cleanup Script
 * 
 * This script deletes old Listing and ScanResult records,
 * keeping only the latest 100 of each.
 * 
 * Usage: node cleanup-database.js
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function cleanup() {
  try {
    console.log('🧹 Starting database cleanup...\n');

    // 1. Clean up Listings - keep only latest 100
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

    // 2. Clean up ScanResults - keep only latest 100
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

    // 3. Summary
    console.log('=' .repeat(50));
    console.log('🎉 Cleanup Complete!');
    console.log('=' .repeat(50));
    console.log(`Total deleted: ${deletedListings.count + deletedScans.count} records`);
    console.log(`Total kept: ${listingsToKeep.length + scansToKeep.length} records`);
    console.log('\n✨ Database is now lean and clean!');

  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

cleanup();

