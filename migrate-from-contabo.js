/**
 * Migrate meme images from Contabo VPS (via SFTP) to S3
 * 
 * This script:
 * 1. Connects to Contabo VPS via SFTP
 * 2. Lists all images in the old directory
 * 3. Downloads and uploads each to S3
 * 4. Creates metadata entries
 * 
 * Usage: node migrate-from-contabo.js
 */

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const Client = require('ssh2-sftp-client');
const path = require('path');
require('dotenv').config();

// ============================================
// CONFIGURE CONTABO CONNECTION
// ============================================
const CONTABO_CONFIG = {
  host: process.env.CONTABO_HOST || 'your-vps-ip',
  port: parseInt(process.env.CONTABO_PORT) || 22,
  username: process.env.CONTABO_USERNAME || 'your-username',
  password: process.env.CONTABO_PASSWORD || 'your-password',
  remoteDir: process.env.CONTABO_IMAGE_PATH || '/var/www/html/images',
};

// ============================================
// S3 Configuration
// ============================================
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;

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

function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

async function uploadToS3(buffer, filename) {
  const timestamp = Date.now();
  const ext = path.extname(filename);
  const basename = path.basename(filename, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
  const s3Key = `memes/${basename}_${timestamp}${ext}`;
  
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
    Body: buffer,
    ContentType: getMimeType(filename),
  });

  await s3Client.send(command);
  return s3Key;
}

function getPublicUrl(s3Key) {
  const region = process.env.AWS_REGION;
  return `https://${BUCKET_NAME}.s3.${region}.amazonaws.com/${s3Key}`;
}

// ============================================
// Main Migration Function
// ============================================

async function migrateFromContabo() {
  log('\n🚀 Starting Contabo → S3 Migration...\n', 'cyan');
  
  // Validate AWS configuration
  if (!BUCKET_NAME || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    log('❌ Error: AWS credentials not configured in .env file', 'red');
    process.exit(1);
  }
  
  // Validate Contabo configuration
  if (!CONTABO_CONFIG.host || CONTABO_CONFIG.host === 'your-vps-ip') {
    log('❌ Error: Contabo VPS credentials not configured', 'red');
    log('Please add to .env file:', 'yellow');
    log('CONTABO_HOST=your-vps-ip', 'yellow');
    log('CONTABO_USERNAME=your-username', 'yellow');
    log('CONTABO_PASSWORD=your-password', 'yellow');
    log('CONTABO_IMAGE_PATH=/var/www/html/images', 'yellow');
    process.exit(1);
  }

  const sftp = new Client();
  const results = {
    success: [],
    failed: [],
    metadata: [],
  };

  try {
    // Connect to Contabo VPS
    log('🔌 Connecting to Contabo VPS...', 'blue');
    await sftp.connect(CONTABO_CONFIG);
    log('✅ Connected to Contabo VPS\n', 'green');

    // List all images
    log(`📂 Scanning directory: ${CONTABO_CONFIG.remoteDir}`, 'blue');
    const files = await sftp.list(CONTABO_CONFIG.remoteDir);
    const imageFiles = files.filter(file => 
      file.type === '-' && 
      /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(file.name)
    );

    if (imageFiles.length === 0) {
      log('❌ No images found in directory', 'red');
      await sftp.end();
      process.exit(0);
    }

    log(`✅ Found ${imageFiles.length} image(s) to migrate\n`, 'green');

    // Migrate each image
    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      const remotePath = `${CONTABO_CONFIG.remoteDir}/${file.name}`;
      
      log(`[${i + 1}/${imageFiles.length}] Processing: ${file.name}`, 'blue');
      
      try {
        // Download from Contabo
        log('  ⬇️  Downloading from VPS...', 'yellow');
        const buffer = await sftp.get(remotePath);
        log(`  ✅ Downloaded (${(file.size / 1024).toFixed(1)} KB)`, 'green');
        
        // Upload to S3
        log('  ⬆️  Uploading to S3...', 'yellow');
        const s3Key = await uploadToS3(buffer, file.name);
        log(`  ✅ Uploaded to S3: ${s3Key}`, 'green');
        
        // Create metadata
        const metadata = {
          id: s3Key,
          filename: file.name,
          originalName: s3Key,
          size: file.size,
          mimeType: getMimeType(file.name),
          uploadDate: new Date().toISOString(),
          path: s3Key,
          url: getPublicUrl(s3Key),
          storageProvider: 's3',
          storageKey: s3Key,
        };
        results.metadata.push(metadata);
        
        log(`  🔗 Public URL: ${metadata.url}`, 'cyan');
        log('  ✅ Complete!\n', 'green');
        
        results.success.push({ 
          original: file.name, 
          s3Key, 
          publicUrl: metadata.url 
        });
        
      } catch (error) {
        log(`  ❌ Failed: ${error.message}\n`, 'red');
        results.failed.push({ filename: file.name, error: error.message });
      }
    }

    // Disconnect
    await sftp.end();
    log('🔌 Disconnected from Contabo VPS\n', 'blue');

  } catch (error) {
    log(`❌ Connection error: ${error.message}`, 'red');
    try {
      await sftp.end();
    } catch {}
    process.exit(1);
  }

  // Summary
  log('='.repeat(60), 'cyan');
  log('📊 Migration Summary', 'cyan');
  log('='.repeat(60), 'cyan');
  log(`✅ Successful: ${results.success.length}`, 'green');
  log(`❌ Failed: ${results.failed.length}`, 'red');
  log(`📝 Total: ${results.success.length + results.failed.length}\n`, 'blue');

  if (results.success.length > 0) {
    log('✅ Successfully Migrated Images:', 'green');
    results.success.forEach(img => {
      log(`   ${img.original} → ${img.s3Key}`, 'reset');
    });
  }

  if (results.failed.length > 0) {
    log('\n❌ Failed Migrations:', 'red');
    results.failed.forEach(img => {
      log(`   ${img.filename}: ${img.error}`, 'reset');
    });
  }

  // Save metadata to file
  if (results.metadata.length > 0) {
    const fs = require('fs');
    fs.writeFileSync(
      'migrated-images-metadata.json',
      JSON.stringify(results.metadata, null, 2)
    );
    log('\n💾 Metadata saved to: migrated-images-metadata.json', 'green');
  }

  log('\n🎉 Migration complete!\n', 'green');
}

// Run migration
migrateFromContabo().catch(error => {
  log('\n❌ Migration failed:', 'red');
  console.error(error);
  process.exit(1);
});

