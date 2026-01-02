/**
 * Script to fix pair addresses in the database
 * 
 * This script:
 * 1. Finds all Solana tokens in the database
 * 2. Verifies if each address is a valid mint using Jupiter API
 * 3. If not a mint (likely a pair address), finds the correct mint address
 * 4. Updates the database with the correct mint address
 * 
 * Usage: node scripts/fix-pair-addresses.js [--dry-run]
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const axios = require('axios');

const prisma = new PrismaClient();
const JUPITER_API_KEY = process.env.JUPITER_API_KEY || '91b41fe6-81e7-40f8-8d84-76fdc669838d';
const DRY_RUN = process.argv.includes('--dry-run');

// Known correct mint addresses from INITIAL_TOKENS
// Key is normalized (lowercase, no special chars) for flexible matching
const INITIAL_TOKENS = {
  'michi': { address: 'gh8ers4yzkr3ukdvgvu8cqjfgzu4cu62mteg9bcj7ug6', chain: 'SOLANA', originalSymbol: 'Michi' },
  'sigma': { address: '424kbbjyt6vksn7gekt9vh5yetutr1sbeyoya2nmbjpw', chain: 'SOLANA', originalSymbol: 'SIGMA' },
  'snoofi': { address: '4fp4synbkisczqkwufpkcsxwfdbsvmktsnpbnlplyu9q', chain: 'SOLANA', originalSymbol: 'snoofi' },
  'vibe': { address: 'bduggvl2ylc41bhxmzevh3zjjz69svcx6lhwfy4b71mo', chain: 'SOLANA', originalSymbol: 'VIBE' },
  'jam': { address: '35jzmqqc6ewrw6pefwdlhmtxbkvnc9mxpbes4rbws1ww', chain: 'SOLANA', originalSymbol: 'jam' },
};

// Known tokens not in INITIAL_TOKENS
const KNOWN_TOKENS = {
  'usdc': { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', chain: 'SOLANA', originalSymbol: 'USDC' },
};

/**
 * Verify if an address is a valid Solana mint using Jupiter API
 */
async function verifyMintWithJupiter(address) {
  try {
    const url = `https://api.jup.ag/tokens/v2/mints?ids=${address}`;
    const response = await axios.get(url, {
      headers: {
        'x-api-key': JUPITER_API_KEY,
        'accept': 'application/json',
      },
      timeout: 5000,
    });

    // Jupiter returns an array - if it has data for this mint, it's valid
    return Array.isArray(response.data) && response.data.length > 0 && response.data[0]?.address === address;
  } catch (error) {
    console.error(`  ⚠️ Jupiter verification failed for ${address}: ${error.message}`);
    return false;
  }
}

/**
 * Try to find the correct mint address from DexScreener
 */
async function findMintFromDexScreener(currentAddress) {
  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${currentAddress}`;
    const response = await axios.get(url, { timeout: 10000 });

    if (response.data?.pairs && response.data.pairs.length > 0) {
      // Get the baseToken address from the first pair
      const baseTokenAddress = response.data.pairs[0]?.baseToken?.address;
      if (baseTokenAddress && baseTokenAddress !== currentAddress) {
        // Verify this is a valid mint
        const isValid = await verifyMintWithJupiter(baseTokenAddress);
        if (isValid) {
          return baseTokenAddress;
        }
      }
    }
  } catch (error) {
    console.error(`  ⚠️ DexScreener lookup failed for ${currentAddress}: ${error.message}`);
  }
  return null;
}

/**
 * Normalize symbol for matching (lowercase, remove special chars like $, /, etc.)
 */
function normalizeSymbol(symbol) {
  if (!symbol) return null;
  return symbol.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Find correct mint address for a token
 */
async function findCorrectMintAddress(listing) {
  // First, check INITIAL_TOKENS and KNOWN_TOKENS with flexible symbol matching
  if (listing.symbol) {
    const normalizedSymbol = normalizeSymbol(listing.symbol);
    
    // Check INITIAL_TOKENS
    if (normalizedSymbol && INITIAL_TOKENS[normalizedSymbol]) {
      const correctAddress = INITIAL_TOKENS[normalizedSymbol].address;
      console.log(`  ✅ Found in INITIAL_TOKENS (matched "${listing.symbol}" → "${INITIAL_TOKENS[normalizedSymbol].originalSymbol}"): ${correctAddress}`);
      return correctAddress;
    }
    
    // Check KNOWN_TOKENS
    if (normalizedSymbol && KNOWN_TOKENS[normalizedSymbol]) {
      const correctAddress = KNOWN_TOKENS[normalizedSymbol].address;
      console.log(`  ✅ Found in KNOWN_TOKENS (matched "${listing.symbol}" → "${KNOWN_TOKENS[normalizedSymbol].originalSymbol}"): ${correctAddress}`);
      return correctAddress;
    }
  }

  // Try to find from DexScreener
  console.log(`  🔍 Searching DexScreener for mint address...`);
  const mintAddress = await findMintFromDexScreener(listing.contractAddress);
  if (mintAddress) {
    console.log(`  ✅ Found mint address from DexScreener: ${mintAddress}`);
    return mintAddress;
  }

  return null;
}

async function main() {
  console.log('🔧 Fixing Pair Addresses in Database');
  console.log('='.repeat(70));
  if (DRY_RUN) {
    console.log('⚠️  DRY RUN MODE - No changes will be made to the database');
    console.log('='.repeat(70));
  }
  console.log('');

  try {
    // Get all Solana listings
    const listings = await prisma.listing.findMany({
      where: { chain: 'SOLANA' },
      select: {
        id: true,
        contractAddress: true,
        symbol: true,
        name: true,
        chain: true,
      },
    });

    console.log(`Found ${listings.length} Solana tokens in database\n`);

    const fixes = [];
    const skipped = [];
    const errors = [];

    for (const listing of listings) {
      console.log(`\nChecking: ${listing.symbol || 'Unknown'} (${listing.contractAddress.substring(0, 20)}...)`);

      // Verify if current address is a valid mint
      // Note: Jupiter API sometimes returns 404 even for valid mints, so we also check against known tokens
      const isValidMint = await verifyMintWithJupiter(listing.contractAddress);
      
      // Also check if it's already a known correct address
      const normalizedSymbol = normalizeSymbol(listing.symbol);
      const knownAddress = normalizedSymbol ? (INITIAL_TOKENS[normalizedSymbol] || KNOWN_TOKENS[normalizedSymbol]) : null;
      const isKnownCorrectAddress = knownAddress && knownAddress.address.toLowerCase() === listing.contractAddress.toLowerCase();
      
      if (isValidMint || isKnownCorrectAddress) {
        console.log('  ✅ Address is a valid mint (or known correct address), skipping');
        skipped.push(listing);
        await new Promise(resolve => setTimeout(resolve, 500)); // Rate limit
        continue;
      }

      console.log('  ❌ Address is NOT a valid mint (likely a pair address)');
      
      // Try to find the correct mint address
      const correctAddress = await findCorrectMintAddress(listing);
      
      if (!correctAddress) {
        console.log('  ⚠️  Could not find correct mint address, skipping');
        errors.push({ listing, reason: 'Could not find correct mint address' });
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }

      if (correctAddress.toLowerCase() === listing.contractAddress.toLowerCase()) {
        console.log('  ℹ️  Addresses match, no update needed');
        skipped.push(listing);
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }

      console.log(`  🔄 Will update: ${listing.contractAddress} → ${correctAddress}`);
      fixes.push({
        listing,
        oldAddress: listing.contractAddress,
        newAddress: correctAddress,
      });

      // Update database
      if (!DRY_RUN) {
        try {
          // First, check if a listing with the new address already exists
          const existing = await prisma.listing.findUnique({
            where: { contractAddress: correctAddress },
          });

          if (existing) {
            console.log(`  ⚠️  Listing with address ${correctAddress} already exists, deleting old one instead`);
            await prisma.listing.delete({
              where: { id: listing.id },
            });
            console.log(`  ✅ Deleted duplicate listing`);
          } else {
            // Update the address
            await prisma.listing.update({
              where: { id: listing.id },
              data: { contractAddress: correctAddress },
            });
            console.log(`  ✅ Updated in database`);
          }
        } catch (updateError) {
          console.error(`  ❌ Failed to update: ${updateError.message}`);
          errors.push({ listing, reason: updateError.message });
        }
      }

      await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit between updates
    }

    // Summary
    console.log('\n\n' + '='.repeat(70));
    console.log('📊 SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total listings checked: ${listings.length}`);
    console.log(`✅ Valid mints (skipped): ${skipped.length}`);
    console.log(`🔄 Fixed (${DRY_RUN ? 'would be updated' : 'updated'}): ${fixes.length}`);
    console.log(`❌ Errors: ${errors.length}`);

    if (fixes.length > 0) {
      console.log('\n📋 FIXES:');
      fixes.forEach((fix, idx) => {
        console.log(`  ${idx + 1}. ${fix.listing.symbol || 'Unknown'} (${fix.listing.name || 'N/A'})`);
        console.log(`     ${fix.oldAddress} → ${fix.newAddress}`);
      });
    }

    if (errors.length > 0) {
      console.log('\n❌ ERRORS:');
      errors.forEach((error, idx) => {
        console.log(`  ${idx + 1}. ${error.listing.symbol || 'Unknown'}: ${error.reason}`);
      });
    }

    if (DRY_RUN && fixes.length > 0) {
      console.log('\n💡 Run without --dry-run to apply these changes');
    }

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

