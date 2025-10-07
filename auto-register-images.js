/**
 * AUTO REGISTER - Logs in and registers images automatically
 * No manual JWT token needed!
 * 
 * Run: node auto-register-images.js
 */

const axios = require('axios');
const fs = require('fs');

const BACKEND_URL = 'https://cto-backend-production.up.railway.app';
const ADMIN_EMAIL = 'admin@ctomemes.xyz';
const ADMIN_PASSWORD = 'admin123';

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

async function autoRegister() {
  log('\n🤖 Auto-Registration Script\n', 'cyan');

  // Step 1: Login to get JWT token
  log('Step 1: Logging in as admin...', 'blue');
  let jwtToken;
  
  try {
    const loginResponse = await axios.post(`${BACKEND_URL}/api/auth/login`, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });

    jwtToken = loginResponse.data.access_token;
    log('✅ Login successful!\n', 'green');
  } catch (error) {
    log('❌ Login failed!', 'red');
    if (error.response) {
      log(`   Status: ${error.response.status}`, 'red');
      log(`   Message: ${error.response.data?.message || 'Unknown error'}`, 'red');
    } else {
      log(`   Error: ${error.message}`, 'red');
    }
    process.exit(1);
  }

  // Step 2: Load metadata
  log('Step 2: Loading migrated images metadata...', 'blue');
  
  if (!fs.existsSync('./migrated-images-metadata.json')) {
    log('❌ migrated-images-metadata.json not found', 'red');
    process.exit(1);
  }

  const images = JSON.parse(fs.readFileSync('./migrated-images-metadata.json', 'utf8'));
  log(`✅ Found ${images.length} images to register\n`, 'green');

  // Step 3: Call bulk-import endpoint
  log('Step 3: Registering images with backend...', 'blue');
  
  try {
    const response = await axios.post(
      `${BACKEND_URL}/api/images/bulk-import`,
      { images },
      {
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    log('✅ Registration successful!\n', 'green');
    log('='.repeat(60), 'cyan');
    log('📊 Results:', 'cyan');
    log('='.repeat(60), 'cyan');
    log(`✅ Imported: ${response.data.imported} images`, 'green');
    log(`⏭️  Skipped: ${response.data.skipped} images`, 'yellow');
    log(`📝 Message: ${response.data.message}\n`, 'blue');

    log('🎉 SUCCESS!', 'green');
    log('All migrated images are now registered with the backend.', 'green');
    log('They should appear in your meme dashboard immediately!\n', 'green');

    log('✨ Next steps:', 'cyan');
    log('1. Go to: https://ctomemes.xyz/meme-dashboard', 'reset');
    log('2. Login if needed', 'reset');
    log('3. All 28 images should now be visible!\n', 'reset');

  } catch (error) {
    log('❌ Registration failed!', 'red');
    if (error.response) {
      log(`   Status: ${error.response.status}`, 'red');
      log(`   Message: ${error.response.data?.message || 'Unknown error'}`, 'red');
      
      if (error.response.status === 404) {
        log('\n⚠️  The bulk-import endpoint might not be deployed yet.', 'yellow');
        log('   Check Railway to ensure latest deployment is live.', 'yellow');
      }
    } else {
      log(`   Error: ${error.message}`, 'red');
    }
    process.exit(1);
  }
}

log('🚀 Starting auto-registration...', 'cyan');
log(`   Backend: ${BACKEND_URL}`, 'reset');
log(`   Admin: ${ADMIN_EMAIL}\n`, 'reset');

autoRegister().catch(error => {
  log('\n❌ Unexpected error:', 'red');
  console.error(error);
  process.exit(1);
});

