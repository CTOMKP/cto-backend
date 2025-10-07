/**
 * Register migrated images with backend
 * This calls the bulk-import endpoint to populate the cache
 * 
 * Usage: node register-migrated-images.js
 */

const axios = require('axios');
const fs = require('fs');

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || 'https://cto-backend-production.up.railway.app';
const METADATA_FILE = './migrated-images-metadata.json';

// Get JWT token from environment or command line
const JWT_TOKEN = process.env.JWT_TOKEN || process.argv[2];

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function registerImages() {
  log('\n📥 Registering Migrated Images with Backend...\n', 'cyan');

  // Check metadata file
  if (!fs.existsSync(METADATA_FILE)) {
    log('❌ Error: migrated-images-metadata.json not found', 'red');
    log('Make sure you run this from old-cto-backend directory', 'yellow');
    process.exit(1);
  }

  // Load metadata
  log('📂 Loading metadata...', 'blue');
  const images = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
  log(`✅ Found ${images.length} images to register\n`, 'green');

  // Check JWT token
  if (!JWT_TOKEN) {
    log('❌ JWT token required!', 'red');
    log('\n📝 How to get your JWT token:', 'cyan');
    log('1. Open: https://cto-vineyard-frontend.vercel.app/auth/signin', 'reset');
    log('2. Login as admin (email: admin@ctomemes.xyz)', 'reset');
    log('3. Open browser console (F12)', 'reset');
    log('4. Type: localStorage.getItem("cto_auth_token")', 'reset');
    log('5. Copy the token value\n', 'reset');
    log('Then run:', 'cyan');
    log('  node register-migrated-images.js YOUR_TOKEN_HERE', 'yellow');
    log('Or:', 'cyan');
    log('  JWT_TOKEN="your-token" node register-migrated-images.js\n', 'yellow');
    process.exit(1);
  }

  // Test backend connection
  log('🔌 Testing backend connection...', 'blue');
  try {
    await axios.get(`${BACKEND_URL}/api/health`);
    log('✅ Backend is reachable\n', 'green');
  } catch (error) {
    log(`❌ Cannot reach backend: ${BACKEND_URL}`, 'red');
    log(`Error: ${error.message}\n`, 'red');
    process.exit(1);
  }

  // Call bulk-import endpoint
  log('📤 Sending bulk import request...', 'blue');
  try {
    const response = await axios.post(
      `${BACKEND_URL}/api/images/bulk-import`,
      { images },
      {
        headers: {
          'Authorization': `Bearer ${JWT_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    log('✅ Import successful!\n', 'green');
    log('='.repeat(60), 'cyan');
    log('📊 Results:', 'cyan');
    log('='.repeat(60), 'cyan');
    log(`✅ Imported: ${response.data.imported} images`, 'green');
    log(`⏭️  Skipped: ${response.data.skipped} images`, 'yellow');
    log(`📝 Message: ${response.data.message}\n`, 'blue');

    log('🎉 All migrated images are now registered!', 'green');
    log('   They should appear in your meme dashboard now.\n', 'green');

  } catch (error) {
    if (error.response) {
      log(`❌ Import failed: ${error.response.status} ${error.response.statusText}`, 'red');
      log(`Message: ${error.response.data?.message || 'Unknown error'}`, 'red');
      
      if (error.response.status === 401) {
        log('\n⚠️  JWT token expired or invalid. Get a new one and try again.', 'yellow');
      }
    } else {
      log(`❌ Request failed: ${error.message}`, 'red');
    }
    process.exit(1);
  }
}

registerImages().catch(error => {
  log('\n❌ Unexpected error:', 'red');
  console.error(error);
  process.exit(1);
});

