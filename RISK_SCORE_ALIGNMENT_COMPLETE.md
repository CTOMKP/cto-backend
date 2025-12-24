# Risk Score Alignment - User Listing Scan

## Summary

The user listing scan now uses the **Pillar1RiskScoringService** formula (which matches the N8N workflow) instead of the old `risk-scoring.service.ts`. This ensures consistency between user listings and public listings vetting systems.

## Changes Made

### 1. Updated ScanService (`src/scan/services/scan.service.ts`)

**Before:**
- Used `calculateRiskScore()` from `risk-scoring.service.ts`
- Used `classifyTier()` from `tier-classifier.service.ts`
- Different formula: Dynamic tier-based weighting

**After:**
- Uses `Pillar1RiskScoringService.calculateRiskScore()` 
- Same formula as N8N workflow: Fixed weighting (Distribution 25%, Liquidity 35%, Dev 20%, Technical 20%)
- Returns `eligibleTier` directly from Pillar1RiskScoringService

### 2. Added Data Transformation Function

Created `transformToVettingData()` method that maps SolanaApiService data format to `TokenVettingData` format required by Pillar1RiskScoringService.

**Key Mappings:**
- `top_holders` → `holders.topHolders` (with address, balance, percentage)
- `lp_burned`/`lp_locked` → `security.lpLockPercentage` (estimated based on lock duration)
- `mint_authority`/`freeze_authority` → `security.isMintable`/`security.isFreezable`
- `holder_count` → `holders.count`
- `lp_amount_usd` → `trading.liquidity`

**Missing GMGN Data (Handled with Defaults):**
- `creatorAddress`: null (not available without GMGN)
- `creatorBalance`: 0 (not available without GMGN)
- `creatorStatus`: 'unknown' (not available without GMGN)
- `twitterCreateTokenCount`: 0 (not available without GMGN)

### 3. Updated Module Imports

**Updated:** `src/scan/scan.module.ts`
- Added import for `TokenVettingModule` to access `Pillar1RiskScoringService`

## Formula Alignment

### Pillar1RiskScoringService Formula (N8N Workflow)

**Components:**
1. **Distribution Score (25%)** - Holder concentration risk
2. **Liquidity Score (35%)** - LP lock/burn security  
3. **Dev Abandonment Score (20%)** - Community takeover verification
4. **Technical Score (20%)** - Smart contract security checks

**Scoring:**
- Higher score = Safer token (0-100 scale)
- 70-100: Low Risk
- 50-69: Medium Risk
- 0-49: High Risk

**Thresholds:**
- Top holder > 20%: -40 points
- Top holder > 15%: -25 points
- Top holder > 10%: -15 points
- LP lock >= 99%: OK
- LP lock >= 90%: -10 points
- LP lock >= 80%: -20 points
- LP lock >= 50%: -40 points
- LP lock < 50%: -60 points
- Mint authority NOT renounced: -50 points
- Freeze authority active: -40 points

## Data Flow

```
User Listing Scan Request
  ↓
ScanService.scanToken()
  ↓
SolanaApiService.fetchTokenData()
  ↓
transformToVettingData() [NEW]
  ↓
Pillar1RiskScoringService.calculateRiskScore()
  ↓
VettingResults (with risk_score, tier, flags)
  ↓
Response to Frontend
```

## Validation

### Risk Score Threshold
- **Minimum qualifying score: 50** (aligned with UserListingsService.MIN_QUALIFYING_SCORE)
- Tokens with score < 50 are rejected
- Tokens with score >= 50 can proceed to listing creation

### Data Sufficiency
- System checks for missing critical data (Distribution, Liquidity, Technical scores)
- If data is insufficient, score calculation is blocked with clear error message

## Backward Compatibility

### Response Format
The response format remains compatible:
- `tier`: lowercase tier name ('stellar', 'bloom', 'sprout', 'seed', 'none')
- `risk_score`: 0-100 (higher = safer)
- `risk_level`: 'LOW', 'MEDIUM', 'HIGH'
- `eligible`: boolean
- `metadata.vetting_results`: Full Pillar1RiskScoringService results

### Frontend Impact
The frontend already expects `risk_score >= 50` to proceed, which aligns with the new scoring system.

## Testing Checklist

- [x] ScanService uses Pillar1RiskScoringService
- [x] Data transformation maps all required fields
- [x] LP lock percentage estimation logic
- [x] Missing GMGN data handled with defaults
- [x] Minimum score threshold (50) enforced
- [x] Batch scan updated to use new scoring
- [x] Error handling for insufficient data
- [x] Module imports updated correctly

## Notes

1. **LP Lock Percentage Estimation**: Since SolanaApiService doesn't provide exact LP lock percentage, we estimate based on lock duration:
   - Burned: 100%
   - Locked 12+ months: 99%
   - Locked 6+ months: 95%
   - Locked 3+ months: 90%
   - Locked but no duration: 90% (conservative)

2. **GMGN Data Missing**: Creator information (creatorAddress, creatorBalance, creatorStatus, twitterCreateTokenCount) is not available from SolanaApiService. These fields use default values, which may slightly affect the Dev Abandonment Score but won't block scoring.

3. **Tier Names**: Pillar1RiskScoringService returns lowercase tier names. This is consistent with the N8N workflow output.

## Files Modified

1. `src/scan/services/scan.service.ts` - Main logic updated
2. `src/scan/scan.module.ts` - Module imports updated

## Related Documentation

- `RISK_SCORE_COMPARISON.md` - Detailed comparison of old vs new scoring systems
- `USER_LISTING_FLOW_SUMMARY.md` - Complete user listing flow documentation
- `others/CTOMarketplace - Pillar 1 Vetting System-UserScan.json.json` - N8N workflow reference

