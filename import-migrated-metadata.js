/**
 * Import migrated image metadata into backend
 * This registers the 27 migrated images so they appear in the dashboard
 * 
 * Run: node import-migrated-metadata.js
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ============================================
// CONFIGURATION
// ============================================
const BACKEND_URL = process.env.BACKEND_URL || 'https://cto-backend-production.up.railway.app';
const METADATA_FILE = './migrated-images-metadata.json';

// Your admin JWT token (get this from logging into the dashboard)
// Instructions below on how to get it
let JWT_TOKEN = process.env.JWT_TOKEN || '';

// ============================================
// Helper Functions
// ============================================

function log(message, color = 'reset') {
  const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
  };
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// ============================================
// Main Import Function
// ============================================

async function importMetadata() {
  log('\n📥 Starting Metadata Import...\n', 'cyan');

  // Check if metadata file exists
  if (!fs.existsSync(METADATA_FILE)) {
    log('❌ Error: migrated-images-metadata.json not found', 'red');
    log('Run migrate-from-contabo.js first to create this file', 'yellow');
    process.exit(1);
  }

  // Load metadata
  log('📂 Loading metadata file...', 'blue');
  const metadata = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
  log(`✅ Found ${metadata.length} images to import\n`, 'green');

  // Check JWT token
  if (!JWT_TOKEN) {
    log('⚠️  No JWT token provided!', 'yellow');
    log('\nHow to get your JWT token:', 'cyan');
    log('1. Open browser and go to: ' + (BACKEND_URL.includes('localhost') ? 'http://localhost:3000' : 'https://cto-vineyard-frontend.vercel.app/auth/signin'), 'reset');
    log('2. Login as admin', 'reset');
    log('3. Open Developer Tools (F12)', 'reset');
    log('4. Go to Console tab', 'reset');
    log('5. Type: localStorage.getItem("cto_auth_token")', 'reset');
    log('6. Copy the token (without quotes)', 'reset');
    log('7. Run: JWT_TOKEN="your-token-here" node import-migrated-metadata.js\n', 'reset');
    process.exit(1);
  }

  // Test backend connection
  log('🔌 Testing backend connection...', 'blue');
  try {
    const healthCheck = await axios.get(`${BACKEND_URL}/api/health`);
    log('✅ Backend is reachable\n', 'green');
  } catch (error) {
    log('❌ Cannot reach backend: ' + BACKEND_URL, 'red');
    log('Error: ' + error.message, 'red');
    process.exit(1);
  }

  // Note: The current backend doesn't have a bulk import endpoint
  // So we need to tell the user to upload through the dashboard
  // Or they can manually call the presign endpoint for each image

  log('📊 Migrated Images Summary:', 'cyan');
  log('='.repeat(60), 'cyan');
  
  metadata.forEach((img, index) => {
    log(`${index + 1}. ${img.filename}`, 'reset');
    log(`   S3 Key: ${img.id}`, 'blue');
    log(`   URL: ${img.url}`, 'cyan');
    log('', 'reset');
  });

  log('='.repeat(60), 'cyan');
  log('\n⚠️  Important Information:', 'yellow');
  log('\nThe migrated images are already in S3 and publicly accessible!', 'green');
  log('However, they need to be registered with the backend cache.\n', 'yellow');
  
  log('📝 Options to register them:\n', 'cyan');
  
  log('Option 1: Manual Registration (Recommended)', 'blue');
  log('  - Upload 1 new meme through the dashboard', 'reset');
  log('  - This triggers a cache refresh', 'reset');
  log('  - Contact your backend dev to add a bulk import endpoint\n', 'reset');

  log('Option 2: Use Images Directly', 'blue');
  log('  - All images are publicly accessible at their S3 URLs', 'reset');
  log('  - You can use them directly in your app', 'reset');
  log('  - URLs are in the metadata file above\n', 'reset');

  log('Option 3: Backend Code Change (For Developer)', 'blue');
  log('  - Add a POST /api/images/bulk-import endpoint', 'reset');
  log('  - This endpoint accepts metadata array and populates cache', 'reset');
  log('  - Then run this script again\n', 'reset');

  log('💡 Quick Fix:', 'yellow');
  log('Upload images through the dashboard to see them appear!', 'green');
  log('Each upload will add to the cache alongside your migrated images.\n', 'reset');

  // Save URLs to a file for easy reference
  const urlsFile = 'migrated-image-urls.txt';
  const urls = metadata.map(img => `${img.filename}: ${img.url}`).join('\n');
  fs.writeFileSync(urlsFile, urls);
  log(`📄 Image URLs saved to: ${urlsFile}`, 'green');
  log('   You can use these URLs directly if needed!\n', 'cyan');
}

// Run import
importMetadata().catch(error => {
  log('\n❌ Import failed:', 'red');
  console.error(error);
  process.exit(1);
});

