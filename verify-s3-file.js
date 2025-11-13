// Quick script to verify if file exists in S3
const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'eu-north-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const bucket = process.env.AWS_S3_BUCKET_NAME || 'ctom-bucket-backup';
const key = 'memes/1762261718678_joker.jpg'; // Your test file

async function checkFile() {
  try {
    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    
    const response = await s3.send(command);
    console.log('✅ FILE EXISTS IN S3!');
    console.log('Bucket:', bucket);
    console.log('Key:', key);
    console.log('Size:', response.ContentLength, 'bytes');
    console.log('Last Modified:', response.LastModified);
    console.log('ETag:', response.ETag);
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      console.log('❌ FILE NOT FOUND IN S3');
      console.log('Bucket:', bucket);
      console.log('Key:', key);
    } else {
      console.error('Error checking file:', error);
    }
  }
}

checkFile();


