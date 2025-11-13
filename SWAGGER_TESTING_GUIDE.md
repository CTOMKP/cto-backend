# 🧪 Swagger API Testing Guide for Frontend Developers

**A Step-by-Step Guide to Testing CTO Marketplace Backend APIs**

---

## 📋 Table of Contents

1. [What is Swagger?](#what-is-swagger)
2. [How to Access Swagger](#how-to-access-swagger)
3. [Understanding Token Types](#understanding-token-types)
4. [Step-by-Step Testing Guide](#step-by-step-testing-guide)
5. [Testing Public Endpoints](#testing-public-endpoints)
6. [Testing Protected Endpoints](#testing-protected-endpoints)
7. [Common Issues & Solutions](#common-issues--solutions)
8. [Quick Reference](#quick-reference)

---

## 🎯 What is Swagger?

**Swagger** is a tool that shows you all available API endpoints (like buttons on a remote control). Instead of guessing what endpoints exist, Swagger shows you:
- ✅ What endpoints are available
- ✅ What data each endpoint needs
- ✅ What data each endpoint returns
- ✅ How to test endpoints directly in your browser

**Think of it as:** A menu for APIs - you can see everything available and test it right there!

---

## 🌐 How to Access Swagger

### Step 1: Open Swagger in Your Browser

1. Open your web browser (Chrome, Firefox, Edge, etc.)
2. Go to: **`https://api.ctomarketplace.com/api/docs`**
3. You should see a page with lots of colored boxes and text

**What you'll see:**
- A big title: "CTO Marketplace API"
- A description explaining what the API does
- A green button that says **"Authorize"** (we'll use this later!)
- Many sections with different colors (each section = a group of endpoints)

---

## 🔑 Understanding Token Types

**IMPORTANT:** Our API uses TWO different types of tokens. Using the wrong one will cause errors!

### 🟢 Type 1: Privy Token (ES256)

**What it looks like:**
```
eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IkxrZjVwSjNHSVdKUFdXcU16VlN4OG5FeURzVVRhcVg4aGtTLUYtZ3hFVU0ifQ...
```

**How to identify it:**
- Starts with: `eyJhbGciOiJFUzI1NiIs...`
- If you decode it (don't worry about this), it says `{"alg":"ES256"...}`

**Where to get it:**
1. Login to the frontend: `https://www.ctomarketplace.com`
2. Open browser DevTools (Press `F12` or `Right-click → Inspect`)
3. Go to **Application** tab (Chrome) or **Storage** tab (Firefox)
4. Click **Cookies** → `https://www.ctomarketplace.com`
5. Find the cookie named **`privy-token`**
6. Copy its **Value** (it's a long string)

**Used for:**
- ✅ `/api/auth/privy/sync` - To sync your user account
- ✅ `/api/auth/privy/verify` - To verify your Privy token

---

### 🔵 Type 2: JWT Token (HS256)

**What it looks like:**
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6IjB4YjFlMjllZTNBYUUzMTU0NTNmNGY5OGY4MjJGZDcyZTY0N0Q3ZGViZkB3YWxsZXQucHJpdnkiLCJzdWIiOjYsInJvbGUiOiJVU0VSIiwiaWF0IjoxNzYzMDIzMjY5LCJleHAiOjE3NjMxMDk2Njl9.3x4B2llCHM4G3vLjDSSBNpxaVBpcJJu4MweAG3bDqS8
```

**How to identify it:**
- Starts with: `eyJhbGciOiJIUzI1NiIs...`
- If you decode it, it says `{"alg":"HS256"...}`

**Where to get it:**
1. First, get your Privy token (see above)
2. In Swagger, find the endpoint: **`POST /api/auth/privy/sync`**
3. Test it with your Privy token (see instructions below)
4. Look at the response - you'll see a field called **`token`**
5. Copy that token value

**Used for:**
- ✅ `/api/auth/privy/me` - Get your user info
- ✅ `/api/auth/privy/wallets` - Get your wallets
- ✅ `/api/auth/privy/sync-wallets` - Sync wallets
- ✅ All other protected endpoints

---

## 📝 Step-by-Step Testing Guide

### Part 1: Testing Public Endpoints (No Login Required)

These endpoints don't need any tokens - you can test them right away!

#### Example: Get Memecoin Stats

1. **Find the endpoint:**
   - Scroll down in Swagger
   - Look for section: **`stats`** (it has a colored header)
   - Find: **`GET /api/stats/memecoin`**

2. **Click on the endpoint:**
   - Click the gray box that says **`GET /api/stats/memecoin`**
   - It will expand and show you details

3. **Click "Try it out":**
   - You'll see a button that says **"Try it out"** - click it!
   - The form fields will become editable (they turn white)

4. **Execute:**
   - Click the big blue button that says **"Execute"**
   - Wait a few seconds...

5. **See the results:**
   - Scroll down to see the response
   - You'll see:
     - **Code:** `200` (this means success!)
     - **Response body:** A JSON object with stats data

**🎉 Success!** You just tested your first endpoint!

---

### Part 2: Testing Protected Endpoints (Requires Login)

These endpoints need authentication. Follow these steps carefully!

#### Step 1: Get Your Privy Token

1. **Login to Frontend:**
   - Go to: `https://www.ctomarketplace.com`
   - Login with your wallet (MetaMask, WalletConnect, etc.)
   - Make sure you're logged in successfully

2. **Open Browser DevTools:**
   - Press `F12` on your keyboard
   - OR right-click anywhere on the page → **Inspect**

3. **Find the Privy Token:**
   - Click the **Application** tab (Chrome) or **Storage** tab (Firefox)
   - In the left sidebar, expand **Cookies**
   - Click on `https://www.ctomarketplace.com`
   - Look for a cookie named **`privy-token`**
   - Double-click on the **Value** column to select it
   - Copy it (`Ctrl+C` or `Cmd+C`)

**Example of what you're looking for:**
```
Name: privy-token
Value: eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IkxrZjVwSjNHSVdKUFdXcU16VlN4OG5FeURzVVRhcVg4aGtTLUYtZ3hFVU0ifQ...
```

---

#### Step 2: Get Your JWT Token (Using Swagger)

1. **Go to Swagger:**
   - Open: `https://api.ctomarketplace.com/api/docs`

2. **Find the Sync Endpoint:**
   - Look for section: **`PrivyAuth`**
   - Find: **`POST /api/auth/privy/sync`**
   - Click on it to expand

3. **Click "Try it out":**
   - Click the **"Try it out"** button

4. **Enter Your Privy Token:**
   - You'll see a box that says **"Request body"**
   - It should look like this:
     ```json
     {
       "privyToken": ""
     }
     ```
   - Paste your Privy token between the quotes:
     ```json
     {
       "privyToken": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6..."
     }
     ```

5. **Execute:**
   - Click the blue **"Execute"** button
   - Wait for the response...

6. **Copy Your JWT Token:**
   - Look at the **Response body**
   - Find the field called **`token`**
   - Copy that entire token value (it's long!)
   - **Save it somewhere** - you'll need it for other endpoints!

**Example Response:**
```json
{
  "success": true,
  "user": { ... },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6...",  ← COPY THIS!
  "wallets": [ ... ]
}
```

---

#### Step 3: Authorize in Swagger

**This is the MOST IMPORTANT step!** Without this, protected endpoints won't work.

1. **Find the Authorize Button:**
   - Look at the **top right** of the Swagger page
   - You'll see a green button that says **"Authorize"** 🔒
   - Click it!

2. **Enter Your JWT Token:**
   - A popup window will appear
   - You'll see a section called **"JWT-auth"**
   - There's a text box labeled **"Value"**
   - Paste your JWT token here (the one you got from `/sync`)
   - **You can paste just the token** - Swagger will add "Bearer " automatically

3. **Authorize:**
   - Click the **"Authorize"** button in the popup
   - The popup will close
   - You should see a 🔓 icon next to "Authorize" (or it might say "Authorized")

**✅ Success!** Now all protected endpoints will use this token automatically!

---

#### Step 4: Test Protected Endpoints

Now you can test any protected endpoint!

##### Example 1: Get Your User Info

1. **Find the endpoint:**
   - Section: **`PrivyAuth`**
   - Endpoint: **`GET /api/auth/privy/me`**
   - Click to expand

2. **Click "Try it out"**

3. **Execute:**
   - Click **"Execute"**
   - Notice: You don't need to enter anything - Swagger uses your authorized token!

4. **See Results:**
   - You should get a `200` response with your user data!

##### Example 2: Get Your Wallets

1. **Find the endpoint:**
   - Section: **`PrivyAuth`**
   - Endpoint: **`GET /api/auth/privy/wallets`**
   - Click to expand

2. **Click "Try it out"**

3. **Execute:**
   - Click **"Execute"**

4. **See Results:**
   - You should see all your wallets listed!

---

## 🔍 Detailed Endpoint Testing Examples

### Testing `/api/auth/privy/sync`

**Purpose:** Sync your Privy account with our backend and get a JWT token

**Steps:**
1. Get Privy token from browser cookies (see Step 1 above)
2. In Swagger, find: **`POST /api/auth/privy/sync`**
3. Click **"Try it out"**
4. Paste Privy token in request body:
   ```json
   {
     "privyToken": "YOUR_PRIVY_TOKEN_HERE"
   }
   ```
5. Click **"Execute"**
6. Copy the `token` from response (this is your JWT token!)

**Expected Response:**
- **Code:** `201`
- **Response:** JSON with `success: true`, `user` object, `token`, and `wallets` array

---

### Testing `/api/auth/privy/verify`

**Purpose:** Check if your Privy token is still valid

**Steps:**
1. Get Privy token from browser cookies
2. Find: **`POST /api/auth/privy/verify`**
3. Click **"Try it out"**
4. Enter Privy token:
   ```json
   {
     "token": "YOUR_PRIVY_TOKEN_HERE"
   }
   ```
5. Click **"Execute"**

**Expected Response:**
- **Code:** `200`
- **Response:** `{ "valid": true, "userId": "...", "claims": {...} }`

**⚠️ Important:** This endpoint uses **Privy token**, NOT JWT token!

---

### Testing `/api/auth/privy/me`

**Purpose:** Get your user information and wallets

**Steps:**
1. **First, authorize** (see Step 3 above) with your JWT token
2. Find: **`GET /api/auth/privy/me`**
3. Click **"Try it out"**
4. Click **"Execute"** (no need to enter anything)

**Expected Response:**
- **Code:** `200`
- **Response:** User info, Privy user details, and wallets array

**⚠️ Important:** This endpoint uses **JWT token** (from `/sync` response), NOT Privy token!

---

### Testing `/api/auth/privy/wallets`

**Purpose:** Get all wallets for your account

**Steps:**
1. **First, authorize** with your JWT token
2. Find: **`GET /api/auth/privy/wallets`**
3. Click **"Try it out"**
4. Click **"Execute"**

**Expected Response:**
- **Code:** `200`
- **Response:** `{ "success": true, "wallets": [...] }`

---

### Testing `/api/auth/privy/sync-wallets`

**Purpose:** Manually sync wallets from Privy

**Steps:**
1. **First, authorize** with your JWT token
2. Find: **`POST /api/auth/privy/sync-wallets`**
3. Click **"Try it out"**
4. Click **"Execute"** (no body needed)

**Expected Response:**
- **Code:** `200`
- **Response:** `{ "success": true, "message": "...", "syncedCount": 3 }`

---

## ❌ Common Issues & Solutions

### Issue 1: "401 Unauthorized" Error

**What it means:** You're not authorized (missing or wrong token)

**Solutions:**
1. **Did you authorize in Swagger?**
   - Click the **"Authorize"** button at the top
   - Make sure you pasted your **JWT token** (not Privy token)
   - Click **"Authorize"** and **"Close"**

2. **Is your token expired?**
   - JWT tokens expire after 24 hours
   - Get a new one by calling `/api/auth/privy/sync` again

3. **Are you using the right token type?**
   - Protected endpoints need **JWT token** (from `/sync`)
   - Only `/sync` and `/verify` use **Privy token**

---

### Issue 2: "Invalid Privy authentication token"

**What it means:** You're using a JWT token where a Privy token is needed (or vice versa)

**Solutions:**
1. **For `/sync` and `/verify` endpoints:**
   - Use **Privy token** from browser cookies
   - NOT the JWT token!

2. **For all other endpoints:**
   - Use **JWT token** from `/sync` response
   - Authorize in Swagger first!

---

### Issue 3: "No parameters" or Empty Request Body

**What it means:** Some endpoints don't need any input

**Solutions:**
1. **GET endpoints** usually don't need a body
   - Just click **"Execute"** after clicking **"Try it out"**

2. **POST endpoints** might not need a body
   - Check the endpoint description
   - If it says "No parameters", just click **"Execute"**

---

### Issue 4: Can't Find Privy Token in Cookies

**Solutions:**
1. **Make sure you're logged in:**
   - Go to `https://www.ctomarketplace.com`
   - Login with your wallet
   - Wait for login to complete

2. **Check the right domain:**
   - Cookies are domain-specific
   - Make sure you're looking at cookies for `www.ctomarketplace.com`
   - NOT `api.ctomarketplace.com`

3. **Try a different browser:**
   - Sometimes browser extensions block cookies
   - Try incognito/private mode

4. **Alternative method:**
   - Open browser console (F12 → Console tab)
   - Type: `await window.privy.getAccessToken()`
   - Press Enter
   - Copy the returned token

---

### Issue 5: Swagger Page Won't Load

**Solutions:**
1. **Check the URL:**
   - Should be: `https://api.ctomarketplace.com/api/docs`
   - Make sure it's `https://` not `http://`

2. **Check if backend is running:**
   - Try: `https://api.ctomarketplace.com/api/health/health`
   - Should return `{ "status": "ok" }`

3. **Clear browser cache:**
   - Press `Ctrl+Shift+Delete` (or `Cmd+Shift+Delete` on Mac)
   - Clear cached images and files
   - Reload the page

---

## 📚 Quick Reference

### Token Types Cheat Sheet

| Token Type | Algorithm | Starts With | Used For |
|------------|-----------|-------------|----------|
| **Privy Token** | ES256 | `eyJhbGciOiJFUzI1NiIs...` | `/sync`, `/verify` |
| **JWT Token** | HS256 | `eyJhbGciOiJIUzI1NiIs...` | All other endpoints |

### Endpoint Authentication Requirements

| Endpoint | Method | Token Type | Authorization Required? |
|----------|--------|------------|-------------------------|
| `/api/auth/privy/sync` | POST | Privy | ❌ No |
| `/api/auth/privy/verify` | POST | Privy | ❌ No |
| `/api/auth/privy/me` | GET | JWT | ✅ Yes |
| `/api/auth/privy/wallets` | GET | JWT | ✅ Yes |
| `/api/auth/privy/sync-wallets` | POST | JWT | ✅ Yes |
| `/api/stats/memecoin` | GET | None | ❌ No (Public) |

### Step-by-Step Testing Checklist

- [ ] ✅ Opened Swagger: `https://api.ctomarketplace.com/api/docs`
- [ ] ✅ Logged into frontend: `https://www.ctomarketplace.com`
- [ ] ✅ Got Privy token from browser cookies
- [ ] ✅ Tested `/api/auth/privy/sync` with Privy token
- [ ] ✅ Copied JWT token from `/sync` response
- [ ] ✅ Clicked "Authorize" button in Swagger
- [ ] ✅ Pasted JWT token and clicked "Authorize"
- [ ] ✅ Tested `/api/auth/privy/me` endpoint
- [ ] ✅ Tested `/api/auth/privy/wallets` endpoint
- [ ] ✅ Successfully got responses!

---

## 🎓 Tips for Success

1. **Always authorize first:** Before testing protected endpoints, make sure you've clicked "Authorize" and entered your JWT token

2. **Keep tokens organized:** 
   - Privy token = for `/sync` and `/verify`
   - JWT token = for everything else

3. **Check response codes:**
   - `200` or `201` = Success ✅
   - `401` = Unauthorized (need to authorize) ❌
   - `400` = Bad Request (wrong data format) ❌
   - `500` = Server Error (backend issue) ❌

4. **Read endpoint descriptions:** Each endpoint in Swagger has a description that tells you what it does and what it needs

5. **Use "Try it out":** Always click "Try it out" before executing - this makes the form editable

---

## 🆘 Need Help?

If you're still stuck:

1. **Check the endpoint description** in Swagger - it often has helpful notes
2. **Look at the example responses** - they show what you should expect
3. **Check the console** - Open browser DevTools (F12) → Console tab to see errors
4. **Ask the backend team** - Share the error message and which endpoint you're testing

---

## 📝 Summary

**The Golden Rules:**

1. 🔑 **Public endpoints** = No authorization needed
2. 🔐 **Protected endpoints** = Need JWT token (authorize first!)
3. 🟢 **Privy token** = For `/sync` and `/verify` only
4. 🔵 **JWT token** = For all other protected endpoints
5. ✅ **Always authorize** before testing protected endpoints

**Happy Testing! 🚀**

---

*Last Updated: November 2025*
*API Version: 2.0*

