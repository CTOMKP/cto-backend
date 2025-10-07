/**
 * Test script to verify S3 configuration and presigned URL generation
 * Run with: node test-s3-setup.js
 */

const { S3Client, PutObjectCommand, ListBucketsCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
require('dotenv').config();

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

async function testS3Configuration() {
  log('\n🔍 Testing S3 Configuration...\n', 'cyan');
  
  // Step 1: Check environment variables
  log('Step 1: Checking environment variables...', 'blue');
  const required = ['AWS_REGION', 'AWS_S3_BUCKET_NAME', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    log(`❌ Missing environment variables: ${missing.join(', ')}`, 'red');
    log('Please check your .env file', 'yellow');
    process.exit(1);
  }
  
  log('✅ All required environment variables present', 'green');
  log(`   Region: ${process.env.AWS_REGION}`, 'reset');
  log(`   Bucket: ${process.env.AWS_S3_BUCKET_NAME}`, 'reset');
  log(`   Access Key: ${process.env.AWS_ACCESS_KEY_ID.substring(0, 8)}...`, 'reset');
  
  // Step 2: Create S3 client
  log('\nStep 2: Creating S3 client...', 'blue');
  const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  log('✅ S3 client created', 'green');
  
  // Step 3: Test AWS credentials by listing buckets
  log('\nStep 3: Testing AWS credentials...', 'blue');
  try {
    const listCommand = new ListBucketsCommand({});
    const response = await s3Client.send(listCommand);
    log('✅ AWS credentials valid', 'green');
    log(`   Found ${response.Buckets.length} bucket(s) in your account`, 'reset');
    
    // Check if our bucket exists
    const bucketExists = response.Buckets.some(b => b.Name === process.env.AWS_S3_BUCKET_NAME);
    if (bucketExists) {
      log(`   ✅ Target bucket '${process.env.AWS_S3_BUCKET_NAME}' exists`, 'green');
    } else {
      log(`   ⚠️  Target bucket '${process.env.AWS_S3_BUCKET_NAME}' not found`, 'yellow');
      log('   Available buckets:', 'yellow');
      response.Buckets.forEach(b => log(`      - ${b.Name}`, 'yellow'));
    }
  } catch (error) {
    log('❌ Failed to authenticate with AWS', 'red');
    log(`   Error: ${error.message}`, 'red');
    process.exit(1);
  }
  
  // Step 4: Test presigned URL generation
  log('\nStep 4: Testing presigned URL generation...', 'blue');
  try {
    const testKey = 'memes/test_image_' + Date.now() + '.jpg';
    const command = new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: testKey,
      ContentType: 'image/jpeg',
    });
    
    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });
    log('✅ Presigned URL generated successfully', 'green');
    log(`   Key: ${testKey}`, 'reset');
    log(`   URL length: ${presignedUrl.length} characters`, 'reset');
    log(`   URL preview: ${presignedUrl.substring(0, 80)}...`, 'reset');
  } catch (error) {
    log('❌ Failed to generate presigned URL', 'red');
    log(`   Error: ${error.message}`, 'red');
    process.exit(1);
  }
  
  // Step 5: Verify backend configuration
  log('\nStep 5: Checking backend configuration...', 'blue');
  const backendUrl = process.env.BACKEND_BASE_URL || 'http://localhost:3001';
  log(`   Backend URL: ${backendUrl}`, 'reset');
  
  if (process.env.ASSETS_CDN_BASE) {
    log(`   CDN configured: ${process.env.ASSETS_CDN_BASE}`, 'reset');
  } else {
    log('   CDN not configured (optional)', 'yellow');
  }
  
  // Summary
  log('\n' + '='.repeat(60), 'cyan');
  log('✅ ALL TESTS PASSED!', 'green');
  log('='.repeat(60), 'cyan');
  log('\nYour S3 configuration is working correctly!', 'green');
  log('\nNext steps:', 'cyan');
  log('1. Start backend: npm run dev', 'reset');
  log('2. Start frontend: cd ../old-cto-frontend && npm run dev', 'reset');
  log('3. Test meme upload in the dashboard', 'reset');
  log('4. If everything works, push to git\n', 'reset');
}

// Run the tests
testS3Configuration().catch(error => {
  log('\n❌ Test failed with error:', 'red');
  console.error(error);
  process.exit(1);
});


