# Testing Checklist - Before Git Push

## ✅ Pre-Push Testing Steps

### 1. Test S3 Configuration
```bash
cd old-cto-backend
node test-s3-setup.js
```

**Expected result**: All tests pass ✅
- Environment variables present
- S3 client created
- AWS credentials valid
- Presigned URLs generated

---

### 2. Compile TypeScript (Check for errors)
```bash
cd old-cto-backend
npm run build
```

**Expected result**: Build succeeds with no errors

---

### 3. Start Backend Locally
```bash
cd old-cto-backend
npm run dev
```

**Expected result**: Server starts on port 3001
- Check console for S3 storage service initialization
- No connection errors

---

### 4. Test Backend Endpoints

#### A. Health Check
```bash
curl http://localhost:3001/api/health
```
**Expected**: `200 OK`

#### B. Test Presign Endpoint (requires JWT token)

First, get a JWT token by logging in through the frontend, then:

```bash
curl -X POST http://localhost:3001/api/images/presign \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "type": "meme",
    "filename": "test.jpg",
    "mimeType": "image/jpeg"
  }'
```

**Expected response**:
```json
{
  "key": "memes/test_1234567890.jpg",
  "uploadUrl": "https://baze-bucket.s3.eu-north-1.amazonaws.com/...",
  "viewUrl": "https://baze-bucket.s3.eu-north-1.amazonaws.com/...",
  "metadata": {...}
}
```

---

### 5. Test Frontend Upload Flow

#### A. Start Frontend
```bash
cd old-cto-frontend
npm run dev
```

#### B. Test in Browser
1. Navigate to `http://localhost:3000` (or whatever port)
2. Login as admin
3. Go to meme dashboard
4. Upload a test image
5. Verify:
   - ✅ No errors in browser console
   - ✅ Image appears in the list
   - ✅ Can view the image
   - ✅ Can delete the image
   - ✅ Check S3 bucket - file should be in `memes/` folder

---

### 6. Verify S3 Bucket

Check your S3 bucket in AWS Console:
- Images should be in `memes/` folder
- Files should have correct names (e.g., `funny_cat_1234567890.jpg`)
- Check file properties - Content-Type should be `image/jpeg` or `image/png`

---

### 7. Code Quality Checks

#### A. No TypeScript Errors
- Open project in VS Code
- Check "Problems" tab - should be 0 errors

#### B. Check Git Status
```bash
cd old-cto-backend
git status
```

**Files that should be staged**:
- `src/storage/storage.provider.ts` ✅
- `src/storage/s3-storage.service.ts` ✅
- `src/image/image.service.ts` ✅
- `src/image/image.controller.ts` ✅
- `src/image/image.module.ts` ✅
- `src/image/types.ts` ✅
- `package.json` ✅
- `env.example` ✅
- `S3_MIGRATION_GUIDE.md` ✅

**Files that should NOT be staged** (in .gitignore):
- `.env` ❌ (contains real credentials)
- `node_modules/` ❌
- `dist/` ❌
- `*.old.ts` ❌ (backup files)

---

## 🚨 Important Security Checks

### Before Committing:

1. **Check .env is NOT staged**:
```bash
git status | grep ".env"
```
Should return nothing! If `.env` appears, unstage it:
```bash
git reset .env
```

2. **Check env.example has NO real credentials**:
```bash
cat env.example | grep "AKIAST6S7MYDXOXRGGP2"
```
Should return nothing! (No real AWS keys)

3. **Verify .gitignore**:
```bash
grep ".env" .gitignore
```
Should show `.env` is ignored ✅

---

## ✅ Final Checklist

Before running `git push`:

- [ ] `test-s3-setup.js` passes all tests
- [ ] `npm run build` succeeds
- [ ] Backend starts without errors
- [ ] Can generate presigned URLs
- [ ] Frontend can upload images
- [ ] Images appear in S3 bucket
- [ ] Images can be viewed/deleted
- [ ] No TypeScript errors in VS Code
- [ ] `.env` is NOT in git staging
- [ ] `env.example` has placeholder values only
- [ ] All new files are staged

---

## 🎉 If All Tests Pass

You're ready to commit and push!

```bash
cd old-cto-backend
git add .
git commit -m "feat: migrate meme uploads from SFTP to S3 with presigned URLs"
git push origin main

cd ../old-cto-frontend
git add .
git commit -m "feat: update meme upload to use S3 presigned URLs"
git push origin main
```

---

## 🐛 If Tests Fail

Check the error messages and refer to:
- `S3_MIGRATION_GUIDE.md` - Troubleshooting section
- Backend logs for specific errors
- Browser console for frontend errors

Common issues:
- AWS credentials incorrect → Check `.env` file
- Bucket doesn't exist → Verify bucket name in AWS Console
- CORS errors → Check bucket CORS policy
- JWT errors → Make sure you're logged in with valid token


