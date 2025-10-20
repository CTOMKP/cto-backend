/**
 * Import ALL memes from S3 bucket into database
 * Run: npx ts-node scripts/import-all-s3-memes.ts
 */

import { PrismaClient } from '@prisma/client';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

const prisma = new PrismaClient();

async function importFromS3() {
  console.log('📥 Fetching all memes from S3...\n');

  // Get admin user
  const admin = await prisma.user.findUnique({
    where: { email: 'admin@ctomemes.xyz' },
  });

  if (!admin) {
    console.error('❌ Admin user not found! Run seed first.');
    process.exit(1);
  }

  console.log(`✅ Admin user: ${admin.email} (ID: ${admin.id})\n`);

  // Setup S3 client
  const region = process.env.AWS_REGION || 'eu-north-1';
  const bucket = process.env.AWS_S3_BUCKET_NAME || 'baze-bucket';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    console.error('❌ AWS credentials not found in environment!');
    process.exit(1);
  }

  const s3 = new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });

  // List all objects in memes/ folder
  console.log(`🔍 Listing objects in s3://${bucket}/memes/...\n`);

  const listCommand = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: 'memes/',
  });

  const response = await s3.send(listCommand);
  const objects = response.Contents || [];

  console.log(`📦 Found ${objects.length} objects in S3\n`);

  let imported = 0;
  let skipped = 0;

  for (const obj of objects) {
    if (!obj.Key || obj.Key === 'memes/' || obj.Size === 0) {
      continue; // Skip folder itself and empty files
    }

    try {
      // Check if already in database
      const existing = await prisma.meme.findUnique({
        where: { s3Key: obj.Key },
      });

      if (existing) {
        console.log(`⏭️  Skipped: ${obj.Key} (already exists)`);
        skipped++;
        continue;
      }

      // Extract filename from key (remove memes/ prefix and timestamp)
      const keyParts = obj.Key.split('/');
      const fullFilename = keyParts[keyParts.length - 1];
      
      // Try to extract original filename (before timestamp)
      let filename = fullFilename;
      const match = fullFilename.match(/(.+)_\d+(\.\w+)$/);
      if (match) {
        filename = match[1] + match[2]; // Original name + extension
      }

      // Determine mime type from extension
      const ext = fullFilename.split('.').pop()?.toLowerCase() || '';
      let mimeType = 'image/jpeg';
      if (ext === 'png') mimeType = 'image/png';
      if (ext === 'gif') mimeType = 'image/gif';
      if (ext === 'webp') mimeType = 'image/webp';

      const s3Url = `https://${bucket}.s3.${region}.amazonaws.com/${obj.Key}`;

      // Create database record
      await prisma.meme.create({
        data: {
          filename,
          s3Key: obj.Key,
          s3Url,
          size: obj.Size || 0,
          mimeType,
          uploadedById: admin.id,
        },
      });

      console.log(`✅ Imported: ${filename}`);
      imported++;
    } catch (error) {
      console.error(`❌ Failed to import ${obj.Key}:`, error instanceof Error ? error.message : 'Unknown error');
      skipped++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 Import Summary:');
  console.log('='.repeat(60));
  console.log(`✅ Imported: ${imported}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`📦 Total in S3: ${objects.length}`);
  console.log('\n🎉 Import complete!\n');
}

importFromS3()
  .catch((e) => {
    console.error('❌ Import failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

