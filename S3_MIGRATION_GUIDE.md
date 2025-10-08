# S3 Migration Guide - Meme Image Upload Fix

## Overview
This migration updates the meme image upload system from SFTP/Contabo VPS storage to AWS S3 with presigned URLs. This fixes the upload errors admins were experiencing.

## What Changed

### Backend Changes
1. **Removed**: SFTP-based image storage (`ssh2-sftp-client`)
2. **Added**: AWS S3 storage with presigned URLs
3. **New Files**:
   - `src/storage/storage.provider.ts` - Storage abstraction interface
   - `src/storage/s3-storage.service.ts` - S3 implementation
4. **Updated Files**:
   - `src/image/image.service.ts` - Now uses S3 presigned uploads
   - `src/image/image.controller.ts` - Added `/presign` endpoint for upload URLs
   - `src/image/image.module.ts` - Configured S3 storage provider
   - `src/image/types.ts` - Added S3-specific metadata fields

### Frontend Changes
1. **Updated**: `src/hooks/useApi.ts`
   - `uploadImage` function now uses 3-step presigned S3 upload:
     1. Request presigned URL from backend
     2. Upload directly to S3
     3. Use backend `/api/images/view/*` endpoint for viewing

## Setup Instructions

### 1. Install Dependencies

```bash
cd old-cto-backend
npm install
```

This will install the new AWS SDK packages:
- `@aws-sdk/client-s3`
- `@aws-sdk/s3-request-presigner`

### 2. Configure AWS S3

#### Create S3 Bucket
1. Go to AWS S3 Console
2. Create a new bucket (or use existing)
3. **Important**: Configure bucket CORS policy:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": ["ETag"]
  }
]
```

#### Create IAM User
1. Go to AWS IAM Console
2. Create a new user with programmatic access
3. Attach policy with S3 permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::your-bucket-name/*",
        "arn:aws:s3:::your-bucket-name"
      ]
    }
  ]
}
```

4. Save the Access Key ID and Secret Access Key

### 3. Update Environment Variables

Update your `.env` file with AWS credentials:

```bash
# Remove old Contabo variables (no longer needed)
# CONTABO_HOST=...
# CONTABO_PORT=...
# CONTABO_USERNAME=...
# CONTABO_PASSWORD=...

# Add AWS S3 Configuration
AWS_REGION=eu-north-1
AWS_S3_BUCKET_NAME=your-bucket-name
AWS_ACCESS_KEY_ID=your-aws-access-key-id
AWS_SECRET_ACCESS_KEY=your-aws-secret-access-key

# Optional: CDN for faster delivery
ASSETS_CDN_BASE=https://your-cloudfront-domain.com

# Backend URL (used for view URLs)
BACKEND_BASE_URL=http://localhost:3001
```

### 4. Frontend Environment

Update frontend `.env`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
```

For production:
```bash
NEXT_PUBLIC_API_URL=https://your-backend-domain.com
```

## How It Works

### Upload Flow

```
1. Admin selects meme image in dashboard
   ↓
2. Frontend calls POST /api/images/presign
   - Includes: type='meme', filename, mimeType
   - Requires: JWT authentication
   ↓
3. Backend generates presigned S3 URLs
   - Upload URL (PUT, 15min expiry)
   - View URL (GET, 1hr expiry)
   - Returns: { key, uploadUrl, viewUrl, metadata }
   ↓
4. Frontend uploads directly to S3
   - PUT request to uploadUrl
   - Body: raw image file
   - No backend involved in actual upload
   ↓
5. Frontend stores view URL
   - Format: /api/images/view/memes/{filename}
   - Backend redirects to fresh presigned S3 URL
```

### Benefits

1. **Faster Uploads**: Direct S3 upload, no proxy through backend
2. **Scalable**: S3 handles all storage, no VPS disk limits
3. **Reliable**: No SFTP connection issues
4. **Secure**: Presigned URLs with expiry, no exposed credentials
5. **Cost-Effective**: Pay only for storage used

## Storage Structure

Images are organized in S3 by type:

```
s3://your-bucket-name/
├── memes/
│   ├── funny_cat_1234567890.jpg
│   └── doge_meme_1234567891.png
└── user-uploads/
    └── {userId}/
        ├── profile/
        ├── banner/
        └── generic/
```

## Deployment

### Railway/Heroku/Render
Add environment variables in dashboard:
- `AWS_REGION`
- `AWS_S3_BUCKET_NAME`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `BACKEND_BASE_URL`

### Vercel
Add in Vercel dashboard or use `vercel env`:
```bash
vercel env add AWS_REGION
vercel env add AWS_S3_BUCKET_NAME
vercel env add AWS_ACCESS_KEY_ID
vercel env add AWS_SECRET_ACCESS_KEY
```

## Troubleshooting

### Upload fails with "Failed to get upload URL"
- Check JWT token is valid
- Verify AWS credentials in backend `.env`
- Check backend logs for S3 connection errors

### Upload fails with "S3 upload failed with status 403"
- Verify bucket CORS policy is configured
- Check IAM user has `s3:PutObject` permission
- Ensure bucket name in `.env` matches actual bucket

### Images don't display after upload
- Check `BACKEND_BASE_URL` is correct
- Verify image view endpoint: `GET /api/images/view/{key}`
- Check browser console for CORS errors

### "Image not found" when viewing
- Image metadata not cached - may happen on first deployment
- Check Redis connection (metadata is cached there)
- Try uploading a new image

## Testing

### Local Testing
1. Start backend: `cd old-cto-backend && npm run dev`
2. Start frontend: `cd old-cto-frontend && npm run dev`
3. Login as admin
4. Go to meme dashboard
5. Upload test image
6. Verify it appears in list
7. Click "View" to test image display

### Production Testing
1. Deploy backend with S3 env vars
2. Deploy frontend with backend URL
3. Test upload in production dashboard
4. Check S3 bucket to verify file uploaded
5. Test view/delete functionality

## Rollback (if needed)

If you need to rollback to SFTP:
1. Restore old files from `.old.ts` backups
2. Run `npm install ssh2-sftp-client`
3. Restore Contabo env variables
4. Restart backend

## Support

For issues, check:
1. Backend logs for S3 errors
2. Frontend console for network errors
3. AWS CloudWatch for S3 access logs
4. Redis for cached metadata

## Migration Complete! 🎉

The meme upload system now uses S3 and should work without errors.






