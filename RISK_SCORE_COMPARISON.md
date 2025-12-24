# Risk Score Calculation Comparison

## Summary

**NO, the risk score calculations do NOT align.**

The current `risk-scoring.service.ts` (used by `ScanService`) uses a **completely different formula** than `Pillar1RiskScoringService` (which implements the N8N workflow formula).

---

## Current Implementation: `risk-scoring.service.ts`

### Components
1. **LP Amount Score** - Based on tier criteria
2. **LP Lock/Burn Score** - Based on lock duration
3. **Wallet Activity Score** - Active wallets, suspicious activity, top holders
4. **Smart Contract Score** - Vulnerabilities, audits, authorities

### Weighting
- **Dynamic** - Based on tier (different tiers have different weightings)
- Example: Seed tier might weight LP at 40%, while Stellar tier might weight it at 20%

### Scoring Logic
- **Lower score = More dangerous** (matches repoanalyzer.io system)
- Score range: 0-100
- Uses tier-specific criteria and thresholds

### Data Required
- LP amount USD
- LP lock months
- Active wallets count
- Suspicious activity metrics
- Top holders data
- Smart contract vulnerabilities

---

## Pillar1RiskScoringService (N8N Workflow Formula)

### Components
1. **Distribution Score (25%)** - Holder concentration risk
2. **Liquidity Score (35%)** - LP lock/burn security
3. **Dev Abandonment Score (20%)** - Community takeover verification
4. **Technical Score (20%)** - Smart contract security checks

### Weighting
- **Fixed** - Always the same regardless of tier:
  - Distribution: 25%
  - Liquidity: 35%
  - Dev Abandonment: 20%
  - Technical: 20%

### Scoring Logic
- **Higher score = Safer token** (0-100 scale)
- Score range: 0-100
- Uses fixed thresholds (from N8N workflow)

### Key Thresholds (from N8N workflow):

**Distribution:**
- Top holder > 20%: -40 points
- Top holder > 15%: -25 points
- Top holder > 10%: -15 points
- Top 5 > 50%: -25 points
- Top 10 > 60%: -20 points

**Liquidity:**
- LP lock >= 99%: OK
- LP lock >= 90%: -10 points
- LP lock >= 80%: -20 points
- LP lock >= 50%: -40 points
- LP lock < 50%: -60 points

**Dev Abandonment:**
- Creator holds > 10%: -30 points
- Creator holds > 5%: -15 points
- Token age < 14 days: -40 points
- Serial launcher (>5 tokens): -15 points

**Technical:**
- Mint authority NOT renounced: -50 points
- Freeze authority active: -40 points
- Circulating supply < 80%: -15 points

### Data Required
- Holder distribution (top 10 holders with percentages)
- LP lock percentage and lock details
- Creator address and balance
- Creator status and token count
- Mint/freeze authority status
- Liquidity USD amount
- Token age

---

## Key Differences

| Aspect | risk-scoring.service.ts | Pillar1RiskScoringService |
|--------|------------------------|---------------------------|
| **Components** | LP Amount, LP Lock, Wallet Activity, Smart Contract | Distribution, Liquidity, Dev Abandonment, Technical |
| **Weighting** | Dynamic (tier-based) | Fixed (25%, 35%, 20%, 20%) |
| **Scoring Direction** | Lower = More Dangerous | Higher = Safer |
| **Data Sources** | Tier criteria, suspicious activity | Holder distribution, creator data, LP locks |
| **Thresholds** | Tier-specific | Fixed (from N8N workflow) |

---

## Impact on User Listings

**Current Situation:**
- User listing scan uses `ScanService` → `risk-scoring.service.ts`
- This calculates a DIFFERENT risk score than the N8N workflow
- Scores may not be comparable or consistent

**If You Want Consistency:**
- Should update `ScanService.scanToken()` to use `Pillar1RiskScoringService` instead
- This would align user listing scores with the N8N workflow scores
- Would require data transformation to match `TokenVettingData` interface

---

## Recommendation

To align user listing risk scores with the N8N workflow:

1. **Option A: Switch to Pillar1RiskScoringService** (Recommended)
   - Update `ScanService` to use `Pillar1RiskScoringService`
   - Transform token data to `TokenVettingData` format
   - This ensures consistency with the N8N workflow formula

2. **Option B: Keep Both Systems**
   - Use `risk-scoring.service.ts` for public listings (existing system)
   - Use `Pillar1RiskScoringService` for user listings (matches N8N)
   - Note: Scores won't be directly comparable

3. **Option C: Unify to One System**
   - Choose one formula (recommend Pillar1RiskScoringService as it's the official N8N workflow)
   - Migrate all scoring to use the same service
   - Update all existing tokens to use new scoring system

---

## Code Location

- **Current**: `src/scan/services/risk-scoring.service.ts`
- **N8N Formula**: `src/services/pillar1-risk-scoring.service.ts`
- **Used By**: `src/scan/services/scan.service.ts` (line 134)

