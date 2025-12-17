# Update N8N Workflow to Use `Listing` Table

## ✅ Current Status

- ✅ N8N workflow is working and saving data
- ✅ Data is saved to `tokens` table
- ✅ Vetting results are calculated correctly
- ❌ Backend uses `Listing` table (capital L), not `tokens`
- ❌ Data is saved but backend can't see it

## 🔧 Solution: Update N8N Workflow SQL Queries

### Step 1: Update "Insert Token Data" Node

**Current SQL (in n8n workflow):**
```sql
INSERT INTO tokens (contract_address, chain, name, symbol, image_url, deployed_at, token_age_days, holder_count, last_scanned) 
VALUES ('{{ $json.tokenInfo.contractAddress }}', '{{ $json.tokenInfo.chain }}', '{{ $json.tokenInfo.name }}', '{{ $json.tokenInfo.symbol }}', '{{ $json.tokenInfo.image }}', NOW() - INTERVAL '{{ $json.tokenAge }} days', {{ $json.tokenAge }}, {{ $json.holders.count }}, NOW()) 
ON CONFLICT (contract_address) DO UPDATE SET name = EXCLUDED.name, symbol = EXCLUDED.symbol, image_url = EXCLUDED.image_url, holder_count = EXCLUDED.holder_count, last_scanned = NOW() 
RETURNING id;
```

**New SQL (for Listing table):**
```sql
INSERT INTO "Listing" ("contractAddress", chain, name, symbol, holders, age, "lastScannedAt", metadata) 
VALUES (
  '{{ $json.tokenInfo.contractAddress }}', 
  '{{ $json.tokenInfo.chain | upper }}', 
  '{{ $json.tokenInfo.name }}', 
  '{{ $json.tokenInfo.symbol }}', 
  {{ $json.holders.count }}, 
  '{{ $json.tokenAge }} days', 
  NOW(),
  jsonb_build_object(
    'imageUrl', '{{ $json.tokenInfo.image }}',
    'tokenAge', {{ $json.tokenAge }},
    'deployedAt', NOW() - INTERVAL '{{ $json.tokenAge }} days'
  )
) 
ON CONFLICT ("contractAddress") DO UPDATE SET 
  name = EXCLUDED.name, 
  symbol = EXCLUDED.symbol, 
  holders = EXCLUDED.holders, 
  age = EXCLUDED.age,
  "lastScannedAt" = NOW(),
  metadata = EXCLUDED.metadata
RETURNING id;
```

### Step 2: Update "Insert Vetting Results" Node

**Current SQL:**
```sql
INSERT INTO vetting_results (token_id, pillar, distribution_score, liquidity_score, dev_abandonment_score, technical_score, overall_score, risk_level, eligible_tier, flags) 
SELECT t.id, 'smart_contract', {{ $("Calculate Risk Scores").first().json.vettingResults.componentScores.distribution.score }}, {{ $("Calculate Risk Scores").first().json.vettingResults.componentScores.liquidity.score }}, {{ $("Calculate Risk Scores").first().json.vettingResults.componentScores.devAbandonment.score }}, {{ $("Calculate Risk Scores").first().json.vettingResults.componentScores.technical.score }}, {{ $("Calculate Risk Scores").first().json.vettingResults.overallScore }}, '{{ $("Calculate Risk Scores").first().json.vettingResults.riskLevel }}', '{{ $("Calculate Risk Scores").first().json.vettingResults.eligibleTier }}', '{{ JSON.stringify($("Calculate Risk Scores").first().json.vettingResults.allFlags) }}'::jsonb 
FROM tokens t 
WHERE t.contract_address = '{{ $("Calculate Risk Scores").first().json.tokenInfo.contractAddress }}' 
RETURNING id;
```

**New SQL (update Listing table directly):**
```sql
UPDATE "Listing" 
SET 
  "riskScore" = {{ $("Calculate Risk Scores").first().json.vettingResults.overallScore }},
  tier = '{{ $("Calculate Risk Scores").first().json.vettingResults.eligibleTier }}',
  summary = 'Risk Level: {{ $("Calculate Risk Scores").first().json.vettingResults.riskLevel }}. {{ $("Calculate Risk Scores").first().json.vettingResults.allFlags[0] }}',
  metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'vettingResults', jsonb_build_object(
      'overallScore', {{ $("Calculate Risk Scores").first().json.vettingResults.overallScore }},
      'riskLevel', '{{ $("Calculate Risk Scores").first().json.vettingResults.riskLevel }}',
      'eligibleTier', '{{ $("Calculate Risk Scores").first().json.vettingResults.eligibleTier }}',
      'componentScores', jsonb_build_object(
        'distribution', {{ $("Calculate Risk Scores").first().json.vettingResults.componentScores.distribution.score }},
        'liquidity', {{ $("Calculate Risk Scores").first().json.vettingResults.componentScores.liquidity.score }},
        'devAbandonment', {{ $("Calculate Risk Scores").first().json.vettingResults.componentScores.devAbandonment.score }},
        'technical', {{ $("Calculate Risk Scores").first().json.vettingResults.componentScores.technical.score }}
      ),
      'flags', '{{ JSON.stringify($("Calculate Risk Scores").first().json.vettingResults.allFlags) }}'::jsonb
    )
  ),
  "lastScannedAt" = NOW()
WHERE "contractAddress" = '{{ $("Calculate Risk Scores").first().json.tokenInfo.contractAddress }}'
RETURNING id;
```

### Step 3: Update "Insert Launch Analysis" Node

**Current SQL:**
```sql
INSERT INTO launch_analysis (token_id, creator_address, creator_balance, creator_status, creator_token_count, top10_holder_rate, analyzed_at) 
SELECT t.id, '{{ $("Calculate Risk Scores").first().json.developer.creatorAddress }}', {{ $("Calculate Risk Scores").first().json.developer.creatorBalance }}, '{{ $("Calculate Risk Scores").first().json.developer.creatorStatus }}', {{ $("Calculate Risk Scores").first().json.developer.twitterCreateTokenCount }}, {{ $("Calculate Risk Scores").first().json.developer.top10HolderRate }}, NOW() 
FROM tokens t 
WHERE t.contract_address = '{{ $("Calculate Risk Scores").first().json.tokenInfo.contractAddress }}' 
ON CONFLICT (token_id) DO UPDATE SET creator_balance = EXCLUDED.creator_balance, creator_status = EXCLUDED.creator_status, creator_token_count = EXCLUDED.creator_token_count, top10_holder_rate = EXCLUDED.top10_holder_rate, analyzed_at = NOW();
```

**New SQL (store in Listing metadata instead):**
```sql
UPDATE "Listing" 
SET 
  metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'launchAnalysis', jsonb_build_object(
      'creatorAddress', '{{ $("Calculate Risk Scores").first().json.developer.creatorAddress }}',
      'creatorBalance', {{ $("Calculate Risk Scores").first().json.developer.creatorBalance }},
      'creatorStatus', '{{ $("Calculate Risk Scores").first().json.developer.creatorStatus }}',
      'creatorTokenCount', {{ $("Calculate Risk Scores").first().json.developer.twitterCreateTokenCount }},
      'top10HolderRate', {{ $("Calculate Risk Scores").first().json.developer.top10HolderRate }},
      'analyzedAt', NOW()
    )
  )
WHERE "contractAddress" = '{{ $("Calculate Risk Scores").first().json.tokenInfo.contractAddress }}';
```

### Step 4: Update "Check Cache (24h)" Node

**Current SQL:**
```sql
SELECT id, last_scanned FROM tokens 
WHERE contract_address = '{{ $json.contractAddress }}' 
AND last_scanned > NOW() - INTERVAL '24 hours'
```

**New SQL:**
```sql
SELECT id, "lastScannedAt" as last_scanned 
FROM "Listing" 
WHERE "contractAddress" = '{{ $json.contractAddress }}' 
AND "lastScannedAt" > NOW() - INTERVAL '24 hours'
```

### Step 5: Update "Return Cached Results" Node

**Current SQL:**
```sql
SELECT t.*, vr.* 
FROM tokens t 
LEFT JOIN vetting_results vr ON t.id = vr.token_id 
WHERE t.contract_address = '{{ $json.contractAddress }}'
```

**New SQL:**
```sql
SELECT 
  l.*,
  (l.metadata->>'vettingResults')::jsonb as vetting_results
FROM "Listing" l
WHERE l."contractAddress" = '{{ $json.contractAddress }}'
```

## Column Name Mapping

| tokens table (n8n) | Listing table (backend) |
|-------------------|------------------------|
| `contract_address` | `"contractAddress"` |
| `chain` | `chain` (same, but needs uppercase) |
| `name` | `name` (same) |
| `symbol` | `symbol` (same) |
| `image_url` | `metadata->>'imageUrl'` |
| `token_age_days` | `age` (as string like "365 days") |
| `holder_count` | `holders` |
| `last_scanned` | `"lastScannedAt"` |
| `vetting_results.overall_score` | `"riskScore"` |
| `vetting_results.eligible_tier` | `tier` |

## Important Notes

1. **Table name is case-sensitive**: Use `"Listing"` with quotes and capital L
2. **Column names are case-sensitive**: Use `"contractAddress"` with quotes for camelCase columns
3. **Chain enum**: Backend uses uppercase enum values (SOLANA, ETHEREUM, etc.)
4. **Metadata field**: Use JSONB to store additional data like imageUrl, vettingResults, etc.

## Testing After Update

1. Test the webhook again with the same PowerShell command
2. Check `Listing` table:
   ```sql
   SELECT * FROM "Listing" 
   WHERE "contractAddress" = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
   ```
3. Verify `riskScore` and `tier` are populated
4. Check backend can see the data

## Alternative: Keep Both Tables

If you want to keep both `tokens` and `Listing` tables, you can:
1. Keep n8n saving to `tokens` table
2. Create a database trigger to sync `tokens` → `Listing`
3. Or create a view that maps `tokens` to `Listing` format

But updating n8n to use `Listing` directly is cleaner and recommended.

