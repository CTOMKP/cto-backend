# Backend Risk Score Calculation Implementation

## Overview

This implementation adds **backend-based risk score calculation** as a fallback for n8n automation. The backend now implements the **exact same algorithm** as the n8n workflow, allowing the system to function independently while n8n connectivity issues are resolved.

## Features

1. **Pillar1RiskScoringService**: Implements the exact n8n risk scoring algorithm
2. **Feature Flag**: `USE_BACKEND_RISK_SCORING` to switch between n8n and backend calculation
3. **Automatic Recalculation**: Method to recalculate risk scores for existing tokens
4. **Database Compatibility**: Saves results in the same format as n8n workflow

## Configuration

### Environment Variable

Set `USE_BACKEND_RISK_SCORING=true` in Coolify to enable backend risk scoring:

```bash
USE_BACKEND_RISK_SCORING=true
```

- `true`: Use backend calculation (default, recommended while n8n is being fixed)
- `false`: Use n8n webhook (original flow)

## Risk Score Algorithm

The algorithm calculates 4 component scores:

1. **Distribution Score (25% weight)**: Holder concentration analysis
2. **Liquidity Score (35% weight)**: LP lock/burn security
3. **Dev Abandonment Score (20% weight)**: Community takeover verification
4. **Technical Score (20% weight)**: Smart contract security checks

**Overall Score**: Weighted average of component scores (0-100)
- **70-100**: Low Risk
- **50-69**: Medium Risk
- **0-49**: High Risk

## Recalculating Existing Tokens

### Automatic Recalculation (Default)

**The recalculation runs automatically on application startup** when:
- `USE_BACKEND_RISK_SCORING=true` (backend risk scoring enabled)
- `AUTO_RECALCULATE_RISK_SCORES=true` (default, can be disabled)

This ensures all existing tokens are recalculated immediately after deployment.

**To disable automatic recalculation**, set:
```bash
AUTO_RECALCULATE_RISK_SCORES=false
```

### Manual Trigger (Optional)

If you need to manually trigger recalculation, you can add a controller endpoint:

```typescript
@Post('/admin/recalculate-risk-scores')
async recalculateRiskScores(
  @Body() body: { batchSize?: number; limit?: number }
) {
  return await this.cronService.recalculateRiskScoresForExistingTokens(
    body.batchSize || 10,
    body.limit || 0
  );
}
```

Or call directly:
```typescript
await cronService.recalculateRiskScoresForExistingTokens(
  batchSize: 10,  // Process 10 tokens per batch
  limit: 0        // 0 = process all tokens
);
```

## How It Works

### For New Tokens

1. `RefreshWorker` discovers new tokens
2. Fetches comprehensive data from multiple APIs (DexScreener, Helius, Alchemy, GMGN, etc.)
3. Checks token age (minimum 2 days for testing, normally 14 days)
4. If `USE_BACKEND_RISK_SCORING=true`:
   - Calculates risk score using `Pillar1RiskScoringService`
   - Saves to database via `ListingRepository.saveVettingResults()`
5. If `USE_BACKEND_RISK_SCORING=false`:
   - Sends data to n8n webhook (original flow)

### For Existing Tokens

1. `CronService.recalculateRiskScoresForExistingTokens()` fetches all tokens with risk scores
2. For each token:
   - Extracts data from metadata (if complete)
   - OR fetches fresh data from external APIs (if metadata incomplete)
   - Recalculates risk score using new algorithm
   - Updates database with new score

## Database Format

Results are saved in the same format as n8n workflow:

```typescript
{
  contractAddress: string;
  chain: Chain;
  name: string;
  symbol: string;
  holders: number;
  age: string; // e.g., "14 days"
  riskScore: number | null; // Overall score (0-100)
  tier: string; // 'stellar' | 'bloom' | 'sprout' | 'seed' | 'none'
  summary: string; // e.g., "Risk Level: low. Top holder owns 5.2% (excellent distribution)"
  metadata: {
    imageUrl: string;
    tokenAge: number;
    vettingResults: {
      overallScore: number;
      riskLevel: 'low' | 'medium' | 'high' | 'insufficient_data';
      eligibleTier: string;
      componentScores: {
        distribution: number;
        liquidity: number;
        devAbandonment: number;
        technical: number;
      };
      flags: string[];
    };
    launchAnalysis: { ... };
    lpData: { ... };
    topHolders: Array<{ ... }>;
  };
  lastScannedAt: Date;
}
```

## Migration Path

1. **Phase 1 (Current)**: Backend calculation enabled, n8n disabled
   - All new tokens use backend calculation
   - Recalculate existing tokens using new algorithm

2. **Phase 2 (Testing)**: Test n8n connectivity
   - Set `USE_BACKEND_RISK_SCORING=false` on test backend
   - Verify n8n workflow works correctly
   - Compare results between backend and n8n

3. **Phase 3 (Production)**: Switch back to n8n
   - Once n8n is working reliably
   - Set `USE_BACKEND_RISK_SCORING=false` in production
   - Backend calculation remains as fallback

## Benefits

✅ **No dependency on n8n** - System works independently
✅ **Same algorithm** - Results match n8n exactly
✅ **Easy migration** - Simple feature flag to switch
✅ **Consistent scoring** - All tokens use same algorithm
✅ **Fallback option** - Can switch back to n8n anytime

## Files Modified

- `src/services/pillar1-risk-scoring.service.ts` - New service implementing risk scoring
- `src/services/cron.service.ts` - Added recalculation method
- `src/listing/workers/refresh.worker.ts` - Uses backend calculation when flag enabled
- `src/listing/repository/listing.repository.ts` - Added `saveVettingResults()` method
- `src/services/token-vetting.module.ts` - Exports new service
- `src/listing/listing.module.ts` - Exports ListingRepository

## Next Steps

1. **Set** `USE_BACKEND_RISK_SCORING=true` in Coolify environment variables
2. **Deploy** the changes to Coolify
3. **Monitor** logs - recalculation will start automatically after deployment:
   - Look for: `🚀 Application started - Auto-triggering risk score recalculation...`
   - Progress: `📈 Progress: X/Y processed, X updated, X failed`
   - Completion: `✅ Auto-recalculation completed: X processed, X updated, X failed`
4. **Verify** risk scores are being calculated for new tokens
5. **Test** n8n connectivity separately when ready
6. **Switch** back to n8n once it's working (set `USE_BACKEND_RISK_SCORING=false`)

## Environment Variables

```bash
# Enable backend risk scoring (required)
USE_BACKEND_RISK_SCORING=true

# Auto-recalculate existing tokens on startup (optional, default: true)
AUTO_RECALCULATE_RISK_SCORES=true
```

