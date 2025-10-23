# CTO Vineyard Scoring System Explanation

## Overview

The CTO Vineyard platform uses **two distinct scoring systems** to evaluate tokens. Each score serves a different purpose and uses different calculation methods.

## 1. Risk Score (Security Assessment)

**Purpose**: Evaluates the security and safety of a token investment
**Range**: 0-100
**Direction**: **HIGHER = SAFER** (matches repoanalyzer.io)
**Source**: Calculated by `risk-scoring.service.ts` based on comprehensive security analysis

### Risk Score Levels:
- **70-100**: Low Risk (Safe) ✅
- **40-69**: Medium Risk (Moderate) ⚠️
- **0-39**: High Risk (Dangerous) ❌

### Calculation Factors:
- **LP Amount**: Liquidity pool size and stability
- **Lock & Burn**: Token lock mechanisms and burn events
- **Wallet Activity**: Distribution and suspicious activity
- **Smart Contract**: Security vulnerabilities and audits

### Example:
```json
{
  "riskScore": 85,        // Low Risk (Safe)
  "riskLevel": "Low Risk"
}
```

## 2. Community Score (Overall Health + Social Engagement)

**Purpose**: Evaluates the overall health, activity, and community engagement of a token
**Range**: 0-100
**Direction**: **HIGHER = BETTER** (like academic grading)
**Source**: Calculated by `listing.repository.ts` based on market activity

### Community Score Levels:
- **80-100**: Excellent community (Very active + engaged) 🟢
- **60-79**: Good community (Active + engaged) 🟡
- **40-59**: Moderate community (Moderate activity) 🟠
- **0-39**: Poor community (Low activity) 🔴

### Current Calculation Formula:
```
Holders (30%) + Transactions (25%) + Price changes (15%) + 
Liquidity (15%) + Age (5%) + Safety bonus (10%)
```

### Future Implementation (Barbie's n8n automation):
- **Twitter engagement**: Mentions, retweets, sentiment
- **Telegram activity**: Member count, message frequency
- **Discord activity**: Server members, message activity
- **Reddit mentions**: Posts, comments, sentiment
- **GitHub activity**: Repository stars, commits

### Example:
```json
{
  "communityScore": 85,  // Excellent community
}
```

## API Response Example

```json
{
  "contractAddress": "0x...",
  "symbol": "PEPE",
  "name": "Pepe Coin",
  "riskScore": 85,           // Low Risk (Safe)
  "communityScore": 85,     // Excellent community
  "tier": "Stellar",
  "priceUsd": 0.000001,
  "liquidityUsd": 50000,
  "holders": 1500
}
```

## Why Two Different Scores?

### Scenario 1: Safe but Inactive Token
```json
{
  "riskScore": 85,           // Very safe
  "communityScore": 30        // Poor community (inactive)
}
```
**Analysis**: Safe to hold but not actively traded

### Scenario 2: Risky but Active Token
```json
{
  "riskScore": 25,           // High risk (dangerous)
  "communityScore": 90        // Excellent community (very active)
}
```
**Analysis**: Very active and popular but risky investment

### Scenario 3: Well-Balanced Token
```json
{
  "riskScore": 75,           // Low risk (safe)
  "communityScore": 80        // Good community
}
```
**Analysis**: Safe, active, and well-supported token

## Implementation Status

- ✅ **Risk Score**: Fully implemented with comprehensive security analysis
- ✅ **Community Score**: Current implementation with market activity metrics
- 🚧 **Social Media Integration**: Pending Barbie's n8n automation

## References

- [repoanalyzer.io](https://repoanalyzer.io) - Risk assessment methodology (confirms HIGHER = SAFER)
- Industry standards for token evaluation
- Social sentiment analysis best practices
