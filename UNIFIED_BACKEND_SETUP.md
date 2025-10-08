# Unified Backend Setup Guide

## 🎊 What Was Merged

**backend-auth-scan branch now has EVERYTHING:**
- ✅ User authentication (register, login, Google OAuth)
- ✅ Circle Programmable Wallets
- ✅ Token vetting & scanning
- ✅ User listings
- ✅ **Meme management (NEW!)**
- ✅ S3 storage for all uploads
- ✅ **Role-based access control (NEW!)**
- ✅ PostgreSQL database (Prisma)

---

## 🚀 Railway Deployment Steps

### Step 1: Run Database Migration

**In Railway Dashboard:**
1. Go to your `cto-backend` service (backend-auth-scan deployment)
2. Go to **Settings** → **Deploy**
3. Add **Build Command** (if not set):
   ```
   npm install && npx prisma generate && npx prisma migrate deploy
   ```
4. Or run manually in Railway CLI:
   ```bash
   npx prisma migrate deploy
   npx prisma db seed
   ```

### Step 2: Verify Environment Variables

Make sure these are set in Railway:

```bash
# Database
DATABASE_URL=postgresql://...  # Should already exist

# AWS S3 (for memes + user uploads)
AWS_REGION=eu-north-1
AWS_S3_BUCKET_NAME=baze-bucket
AWS_ACCESS_KEY_ID=AKIAST6S7MYDXOXRGGP2
AWS_SECRET_ACCESS_KEY=JYZ/nUGBrv3eDzsk064O+Z1rGygLBxFR6BNgH5Bu

# JWT Secret
JWT_SECRET=your-jwt-secret

# Circle (already set)
CIRCLE_API_KEY=...
CIRCLE_APP_ID=...

# Other existing vars...
```

### Step 3: Create Admin User

After migration deploys, run seed:
```bash
# In Railway dashboard or CLI
npx prisma db seed
```

**Admin credentials:**
- Email: `admin@ctomemes.xyz`
- Password: `PJio7cmV0IDYasFc$$`
- Role: `ADMIN`

---

## 📊 New Features

### 1. Role-Based Access Control

**User Roles:**
- `USER` - Regular users (default)
- `ADMIN` - Can manage memes, full access
- `MODERATOR` - Future use

**Role is included in JWT:**
```json
{
  "sub": 1,
  "email": "user@example.com",
  "role": "ADMIN"
}
```

### 2. Meme Management (Database-Backed)

**New Endpoints:**
- `POST /api/memes/presign` - Get upload URL (admin only)
- `GET /api/memes` - List all memes (public)
- `GET /api/memes/:id` - Get meme details (public)
- `PUT /api/memes/:id` - Update meme (admin only)
- `DELETE /api/memes/:id` - Delete meme (admin only)
- `POST /api/memes/bulk-import` - Import migrated memes (admin only)

**Database Table:**
```sql
Meme {
  id, filename, s3Key, s3Url, size, mimeType,
  description, category, uploadedById, 
  createdAt, updatedAt
}
```

### 3. Unified Image System

All image uploads go through `/api/images/presign`:
- `type: 'meme'` → Memes folder (public)
- `type: 'profile'` → User profiles
- `type: 'banner'` → User banners
- `type: 'generic'` → User listings

---

## 🔗 Frontend Integration

### cto-vineyard-frontend (Memes)

Update env in Vercel:
```
NEXT_PUBLIC_API_URL=https://cto-backend-production-28e3.up.railway.app
```

**Changes needed:**
- Switch from `/api/images/*` to `/api/memes/*` endpoints
- Use new admin auth flow (role-based)

### cto-frontend (Main App)

Already points to backend-auth-scan! Just verify:
```
REACT_APP_BACKEND_URL=https://cto-backend-production-28e3.up.railway.app
```

---

## 🧪 Testing

### Test Admin Login
```bash
curl -X POST https://cto-backend-production-28e3.up.railway.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ctomemes.xyz","password":"PJio7cmV0IDYasFc$$"}'
```

Should return JWT with `"role":"ADMIN"`

### Test Meme Upload (After Login)
```bash
curl -X POST https://cto-backend-production-28e3.up.railway.app/api/memes/presign \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"filename":"test.jpg","mimeType":"image/jpeg"}'
```

---

## 📝 Migration Checklist

- [ ] Railway: Run `npx prisma migrate deploy`
- [ ] Railway: Run `npx prisma db seed` (create admin)
- [ ] Railway: Verify all env vars present
- [ ] Test admin login
- [ ] Import 27 migrated memes via bulk-import endpoint
- [ ] Update cto-vineyard-frontend Vercel env
- [ ] Test meme upload/delete/edit
- [ ] Deploy cto-frontend (if needed)

---

## 🎯 Benefits

✅ **One backend for everything**  
✅ **Role-based access (scalable for future roles)**  
✅ **Database-backed memes (permanent, queryable)**  
✅ **Privy-ready (just swap auth provider)**  
✅ **Professional architecture (DB + cache, S3, modular)**

---

**The unified backend is now on GitHub backend-auth-scan branch!**
Railway will auto-deploy. Just run migrations and seed!

