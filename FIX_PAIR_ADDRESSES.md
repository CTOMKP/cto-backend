# Fix Pair Addresses in Database

This script cleans up pair addresses (liquidity pool addresses) that were incorrectly saved instead of mint addresses (token addresses) in the database.

## Problem

Some tokens in the database have **pair addresses** (like `5mbK36SZ7J19An8jFochhQS4of8g6BwUjbeCSxBSoWdp`) stored instead of **mint addresses** (like `gh8ers4yzkr3ukdvgvu8cqjfgzu4cu62mteg9bcj7ug6`). This causes holder count APIs to fail because they need mint addresses, not pair addresses.

## Solution

The `scripts/fix-pair-addresses.js` script:
1. Finds all Solana tokens in the database
2. Verifies each address using Jupiter API to check if it's a valid mint
3. If not a mint (likely a pair address), finds the correct mint address using:
   - INITIAL_TOKENS list (for known tokens)
   - DexScreener API (to get baseToken.address)
4. Updates the database with the correct mint address

## How to Run

### Option 1: Run Locally (Recommended)

1. **Get your DATABASE_URL from Coolify:**
   - Go to your Coolify project → Environment Variables
   - Copy the `DATABASE_URL` value
   - Example: `postgresql://postgres:password@host:5432/postgres`

2. **Create/update `.env` file locally:**
   ```bash
   cd cto-backend-old-fresh
   echo "DATABASE_URL=your_database_url_from_coolify" > .env
   echo "JUPITER_API_KEY=91b41fe6-81e7-40f8-8d84-76fdc669838d" >> .env
   ```

3. **Install dependencies (if not already installed):**
   ```bash
   npm install
   ```

4. **Run in DRY-RUN mode first (to see what would change):**
   ```bash
   node scripts/fix-pair-addresses.js --dry-run
   ```

5. **Review the output** - it will show:
   - How many tokens will be fixed
   - The old address → new address changes
   - Any errors

6. **Run for real (removes --dry-run flag):**
   ```bash
   node scripts/fix-pair-addresses.js
   ```

### Option 2: Run Inside Coolify Container

1. **SSH into your Coolify server** (or use Coolify's terminal feature)

2. **Find your container:**
   ```bash
   docker ps | grep cto-backend
   ```

3. **Exec into the container:**
   ```bash
   docker exec -it <container-name> sh
   ```

4. **Navigate to the app directory:**
   ```bash
   cd /app  # or wherever your app is mounted
   ```

5. **Run the script:**
   ```bash
   node scripts/fix-pair-addresses.js --dry-run  # First test
   node scripts/fix-pair-addresses.js            # Then for real
   ```

### Option 3: Use Coolify Terminal Feature

1. Go to your Coolify project
2. Click on "Terminal" or "Exec" tab
3. Run the script:
   ```bash
   cd /app
   node scripts/fix-pair-addresses.js --dry-run
   ```

## What the Script Does

1. **Fetches all Solana tokens** from the database
2. **For each token:**
   - Checks if the address is a valid mint using Jupiter API
   - If valid → skips (no change needed)
   - If invalid (pair address) → finds correct mint address
   - Updates database with correct address

3. **Handles duplicates:**
   - If a listing with the correct address already exists, deletes the old duplicate
   - Otherwise, updates the existing listing

## Expected Output

```
🔧 Fixing Pair Addresses in Database
======================================================================
⚠️  DRY RUN MODE - No changes will be made to the database
======================================================================

Found 18 Solana tokens in database

Checking: Michi (gh8ers4yzkr3ukdv...)
  ✅ Address is a valid mint, skipping

Checking: SIGMA (424kbbjyt6vksn7ge...)
  ✅ Address is a valid mint, skipping

Checking: Michi (5mbK36SZ7J19An8jF...)
  ❌ Address is NOT a valid mint (likely a pair address)
  🔍 Searching DexScreener for mint address...
  ✅ Found mint address from DexScreener: gh8ers4yzkr3ukdvgvu8cqjfgzu4cu62mteg9bcj7ug6
  🔄 Will update: 5mbK36SZ7J19An8jF... → gh8ers4yzkr3ukdv...

======================================================================
📊 SUMMARY
======================================================================
Total listings checked: 18
✅ Valid mints (skipped): 16
🔄 Fixed (would be updated): 2
❌ Errors: 0

📋 FIXES:
  1. Michi (Michi)
     5mbK36SZ7J19An8jFochhQS4of8g6BwUjbeCSxBSoWdp → gh8ers4yzkr3ukdvgvu8cqjfgzu4cu62mteg9bcj7ug6
  ...
```

## Important Notes

- **Always run with `--dry-run` first** to see what will change
- The script has rate limiting built-in to avoid API limits
- If a token can't be fixed automatically, it will be skipped (not deleted)
- The script respects the database constraint (contractAddress is unique)

## Troubleshooting

**Error: "Cannot find module '@prisma/client'"**
- Run `npm install` first

**Error: "Connection refused" or database errors**
- Check that DATABASE_URL is correct
- Ensure your IP is allowed to connect to the database (if running locally)

**Script finds no issues:**
- Great! All addresses are already valid mints
- No changes needed

**Some tokens can't be fixed:**
- These will be listed in the "Errors" section
- You may need to manually check these tokens

