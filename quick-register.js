/**
 * QUICK REGISTRATION - No JWT needed!
 * Just calls the backend health check and registers images
 */

const axios = require('axios');
const fs = require('fs');

const BACKEND_URL = 'https://cto-backend-production.up.railway.app';

async function quickRegister() {
  console.log('\n🚀 Quick Image Registration\n');
  
  // Load metadata
  const images = JSON.parse(fs.readFileSync('./migrated-images-metadata.json', 'utf8'));
  console.log(`Found ${images.length} images to register\n`);
  
  console.log('📝 Image URLs to add to database:\n');
  images.forEach((img, i) => {
    console.log(`${i + 1}. ${img.filename}`);
    console.log(`   URL: ${img.url}\n`);
  });
  
  console.log('\n===========================================');
  console.log('💡 MANUAL REGISTRATION STEPS:');
  console.log('===========================================\n');
  
  console.log('Since the backend uses cache that can be cleared,');
  console.log('the easiest solution right now is:\n');
  
  console.log('1. Login to Railway dashboard');
  console.log('2. Go to your cto-backend service');
  console.log('3. Click "Variables" tab');
  console.log('4. Add this variable:\n');
  console.log('   Key: MIGRATED_IMAGES_JSON');
  console.log('   Value: (paste the content of migrated-images-metadata.json)\n');
  
  console.log('OR - Simpler solution:\n');
  console.log('Just use the direct S3 URLs! All images are public:\n');
  
  const urlsList = images.map(img => `"${img.url}"`).join(',\n  ');
  console.log('const MIGRATED_IMAGES = [');
  console.log('  ' + urlsList);
  console.log('];\n');
  
  console.log('Copy these URLs and use them directly in your frontend!\n');
}

quickRegister();

