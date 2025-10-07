/**
 * Migrate existing meme images from old storage to S3
 * 
 * This script:
 * 1. Takes a list of image URLs from the old storage
 * 2. Downloads each image
 * 3. Uploads to S3 in memes/ folder
 * 4. Creates metadata entries
 * 
 * Usage:
 * 1. Edit the IMAGE_URLS array below with your old image URLs
 * 2. Run: node migrate-images-to-s3.js
 */

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

// ============================================
// CONFIGURE YOUR OLD IMAGE URLS HERE
// ============================================
const IMAGE_URLS = [
  // Option 1: Direct URLs from old storage
  // 'https://ctomemes.xyz/images/funny_cat_123.jpg',
  // 'https://ctomemes.xyz/images/doge_meme_456.png',
  
  // Option 2: Or just filenames if you have SSH access to Contabo
  // We'll need to modify the script for SSH download
];

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

async function downloadImage(url) {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000, // 30 seconds
    });
    return Buffer.from(response.data);
  } catch (error) {
    throw new Error(`Failed to download ${url}: ${error.message}`);
  }
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

async function createMetadataEntry(s3Key, originalFilename, fileSize) {
  // This creates the metadata structure that matches your app
  return {
    id: s3Key,
    filename: originalFilename,
    originalName: s3Key,
    size: fileSize,
    mimeType: getMimeType(originalFilename),
    uploadDate: new Date().toISOString(),
    path: s3Key,
    url: getPublicUrl(s3Key),
    storageProvider: 's3',
    storageKey: s3Key,
  };
}

// ============================================
// Main Migration Function
// ============================================

async function migrateImages() {
  log('\n🚀 Starting Image Migration to S3...\n', 'cyan');
  
  // Validate configuration
  if (!BUCKET_NAME || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    log('❌ Error: AWS credentials not configured in .env file', 'red');
    process.exit(1);
  }
  
  if (IMAGE_URLS.length === 0) {
    log('❌ Error: No images configured for migration', 'red');
    log('Please edit IMAGE_URLS array in this script', 'yellow');
    log('\nExample:', 'yellow');
    log('const IMAGE_URLS = [', 'yellow');
    log('  "https://old-server.com/images/cat.jpg",', 'yellow');
    log('  "https://old-server.com/images/dog.png",', 'yellow');
    log('];', 'yellow');
    process.exit(1);
  }

  log(`Found ${IMAGE_URLS.length} image(s) to migrate\n`, 'blue');

  const results = {
    success: [],
    failed: [],
    metadata: [],
  };

  // Migrate each image
  for (let i = 0; i < IMAGE_URLS.length; i++) {
    const url = IMAGE_URLS[i];
    const filename = path.basename(url);
    
    log(`[${i + 1}/${IMAGE_URLS.length}] Processing: ${filename}`, 'blue');
    
    try {
      // Download image
      log('  ⬇️  Downloading...', 'yellow');
      const buffer = await downloadImage(url);
      log(`  ✅ Downloaded (${(buffer.length / 1024).toFixed(1)} KB)`, 'green');
      
      // Upload to S3
      log('  ⬆️  Uploading to S3...', 'yellow');
      const s3Key = await uploadToS3(buffer, filename);
      log(`  ✅ Uploaded to S3: ${s3Key}`, 'green');
      
      // Create metadata
      const metadata = await createMetadataEntry(s3Key, filename, buffer.length);
      results.metadata.push(metadata);
      
      log(`  🔗 Public URL: ${metadata.url}`, 'cyan');
      log('  ✅ Complete!\n', 'green');
      
      results.success.push({ original: url, s3Key, publicUrl: metadata.url });
      
    } catch (error) {
      log(`  ❌ Failed: ${error.message}\n`, 'red');
      results.failed.push({ url, error: error.message });
    }
  }

  // Summary
  log('='.repeat(60), 'cyan');
  log('📊 Migration Summary', 'cyan');
  log('='.repeat(60), 'cyan');
  log(`✅ Successful: ${results.success.length}`, 'green');
  log(`❌ Failed: ${results.failed.length}`, 'red');
  log(`📝 Total: ${IMAGE_URLS.length}\n`, 'blue');

  if (results.success.length > 0) {
    log('✅ Successfully Migrated Images:', 'green');
    results.success.forEach(img => {
      log(`   ${img.s3Key}`, 'reset');
      log(`   → ${img.publicUrl}\n`, 'cyan');
    });
  }

  if (results.failed.length > 0) {
    log('❌ Failed Migrations:', 'red');
    results.failed.forEach(img => {
      log(`   ${img.url}`, 'reset');
      log(`   Error: ${img.error}\n`, 'yellow');
    });
  }

  // Save metadata to file for import
  if (results.metadata.length > 0) {
    const fs = require('fs');
    fs.writeFileSync(
      'migrated-images-metadata.json',
      JSON.stringify(results.metadata, null, 2)
    );
    log('💾 Metadata saved to: migrated-images-metadata.json', 'green');
    log('   You can use this to import metadata into your dashboard\n', 'yellow');
  }

  log('🎉 Migration complete!\n', 'green');
}

// ============================================
// Run Migration
// ============================================

if (IMAGE_URLS.length === 0) {
  log('\n⚠️  Quick Start Guide:\n', 'yellow');
  log('1. Edit this file and add your old image URLs to IMAGE_URLS array', 'reset');
  log('2. Example:', 'reset');
  log('   const IMAGE_URLS = [', 'cyan');
  log('     "https://ctomemes.xyz/images/cat.jpg",', 'cyan');
  log('     "https://ctomemes.xyz/images/dog.png",', 'cyan');
  log('   ];', 'cyan');
  log('\n3. Run: node migrate-images-to-s3.js\n', 'reset');
} else {
  migrateImages().catch(error => {
    log('\n❌ Migration failed:', 'red');
    console.error(error);
    process.exit(1);
  });
}

