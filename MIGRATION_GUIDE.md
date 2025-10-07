# Image Migration Guide - Move Existing Memes to S3

## Overview
Two migration scripts to transfer existing meme images to your S3 bucket without re-uploading through the dashboard.

---

## 📋 Prerequisites

1. ✅ Backend dependencies installed (`npm install`)
2. ✅ `.env` file configured with AWS credentials
3. ✅ S3 bucket made public for memes (bucket policy applied)
4. ✅ Know where your old images are stored

---

## 🚀 Migration Options

### **Option 1: Images Are Publicly Accessible (URLs)**

If your old images have public URLs (e.g., `https://old-server.com/images/cat.jpg`):

**Use**: `migrate-images-to-s3.js`

#### Steps:

1. **Edit the script**:
```javascript
// Open: migrate-images-to-s3.js
// Find line ~20 and add your image URLs:

const IMAGE_URLS = [
  'https://old-server.com/images/funny_cat.jpg',
  'https://old-server.com/images/doge_meme.png',
  'https://old-server.com/images/pepe_frog.gif',
  // ... add all your image URLs
];
```

2. **Run migration**:
```bash
cd old-cto-backend
node migrate-images-to-s3.js
```

3. **Check results**:
   - Images uploaded to S3 `memes/` folder
   - `migrated-images-metadata.json` created

---

### **Option 2: Images Are on Contabo VPS (SFTP)**

If images are on your Contabo VPS server:

**Use**: `migrate-from-contabo.js`

#### Steps:

1. **First, install SFTP client**:
```bash
cd old-cto-backend
npm install ssh2-sftp-client
```

2. **Configure Contabo credentials in `.env`**:
```bash
# Add to old-cto-backend/.env:
CONTABO_HOST=your-vps-ip-address
CONTABO_PORT=22
CONTABO_USERNAME=your-ssh-username
CONTABO_PASSWORD=your-ssh-password
CONTABO_IMAGE_PATH=/var/www/html/images
```

3. **Run migration**:
```bash
node migrate-from-contabo.js
```

4. **Check results**:
   - Connects to VPS via SFTP
   - Downloads all images from specified directory
   - Uploads to S3 `memes/` folder
   - Creates `migrated-images-metadata.json`

---

## 📊 After Migration

### 1. Verify in S3
- Go to AWS S3 Console → `baze-bucket` → `memes/`
- Check all images are there
- Test a few Object URLs - should open directly

### 2. Check Metadata File
Open `migrated-images-metadata.json` - contains:
```json
[
  {
    "id": "memes/funny_cat_1759859257545.jpg",
    "filename": "funny_cat.jpg",
    "size": 123456,
    "mimeType": "image/jpeg",
    "url": "https://baze-bucket.s3.eu-north-1.amazonaws.com/memes/funny_cat_1759859257545.jpg",
    ...
  }
]
```

### 3. Make Images Appear in Dashboard

The migrated images are now in S3, but won't show in your dashboard yet because there's no metadata in Redis/memory cache.

**Two options:**

#### **Option A: Let them upload naturally**
Next time admin uploads a new meme, the cache refreshes and you can manually add old ones via API if needed.

#### **Option B: Import metadata via API** (Advanced)
Create a script to call your backend's presign endpoint for each image to register metadata.

---

## 🎯 Quick Example

### Example: Migrate from Public URLs

```javascript
// migrate-images-to-s3.js
const IMAGE_URLS = [
  'https://ctomemes.xyz/images/doge.png',
  'https://ctomemes.xyz/images/pepe.jpg',
  'https://ctomemes.xyz/images/wojak.gif',
];
```

Run:
```bash
node migrate-images-to-s3.js
```

Output:
```
🚀 Starting Image Migration to S3...
Found 3 image(s) to migrate

[1/3] Processing: doge.png
  ⬇️  Downloading...
  ✅ Downloaded (245.3 KB)
  ⬆️  Uploading to S3...
  ✅ Uploaded to S3: memes/doge_1759859257545.png
  🔗 Public URL: https://baze-bucket.s3.eu-north-1.amazonaws.com/memes/doge_1759859257545.png
  ✅ Complete!

... (repeats for all images)

📊 Migration Summary
✅ Successful: 3
❌ Failed: 0
📝 Total: 3

💾 Metadata saved to: migrated-images-metadata.json
🎉 Migration complete!
```

---

## ⚠️ Important Notes

1. **Filenames get timestamps**: `cat.jpg` becomes `cat_1759859257545.jpg` to avoid conflicts
2. **Original URLs still work**: Old links will break - use new S3 URLs
3. **No duplicate check**: Running twice uploads images twice with different timestamps
4. **Redis cache**: Migrated images won't show in dashboard until cache refreshes

---

## 🐛 Troubleshooting

### "Failed to download" error
- Check old image URLs are still accessible
- Check VPS/server is running
- Verify network connection

### "Upload failed" error
- Check AWS credentials in `.env`
- Verify bucket name is correct
- Check IAM permissions

### "Connection refused" (Contabo)
- Verify CONTABO_HOST IP address
- Check SSH port (usually 22)
- Test SSH connection manually: `ssh username@ip`

### Images uploaded but not in dashboard
- This is normal - metadata needs to be registered
- Upload one new image through dashboard to refresh cache
- Or wait for next admin login/cache refresh

---

## 📞 Need Help?

Check the migration output:
- Green ✅ = Success
- Red ❌ = Error with reason
- Yellow ⚠️ = Warning

All metadata is saved to `migrated-images-metadata.json` for reference.

---

**Ready to migrate? Choose your option above and follow the steps!** 🚀

