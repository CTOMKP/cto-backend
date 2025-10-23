# Listing Filters Implementation

## Overview

This document describes the implementation of new listing filters requested by the frontend developer and approved by Barbie (client). These filters help users identify safer and more legitimate tokens.

## New Filter Fields

### 1. LP Burned (Liquidity Pool Burned)
- **Field**: `lpBurnedPercentage`
- **Type**: `Float` (0-100)
- **Description**: Percentage of liquidity pool tokens that have been burned
- **Filter Logic**: `minLpBurned` - Show tokens with LP burned >= specified percentage
- **Example**: `minLpBurned=50` shows tokens with 50%+ LP burned

### 2. Top 10 Holders
- **Field**: `top10HoldersPercentage`
- **Type**: `Float` (0-100)
- **Description**: Percentage of total supply held by top 10 wallet addresses
- **Filter Logic**: `maxTop10Holders` - Show tokens with top 10 holders < specified percentage
- **Example**: `maxTop10Holders=15` shows tokens with <15% concentration

### 3. Mint Auth Disabled
- **Field**: `mintAuthDisabled`
- **Type**: `Boolean`
- **Description**: Whether token's mint authority has been revoked
- **Filter Logic**: `mintAuthDisabled=true` shows tokens with disabled mint authority
- **Example**: `mintAuthDisabled=true` shows tokens that can't create new tokens

### 4. Raiding Detection
- **Field**: `raidingDetected`
- **Type**: `Boolean`
- **Description**: Whether coordinated buying/selling patterns are detected
- **Filter Logic**: `noRaiding=true` shows tokens with no raiding detected
- **Example**: `noRaiding=true` shows tokens without suspicious trading patterns

## API Usage

### Query Parameters

```typescript
// Example API calls
GET /api/listing/listings?minLpBurned=50&maxTop10Holders=15&mintAuthDisabled=true&noRaiding=true
GET /api/listing/listings?minLpBurned=75  // Only tokens with 75%+ LP burned
GET /api/listing/listings?maxTop10Holders=10  // Only tokens with <10% top 10 concentration
```

### Response Format

The API response includes the new filter fields:

```json
{
  "page": 1,
  "limit": 20,
  "total": 150,
  "items": [
    {
      "contractAddress": "0x...",
      "symbol": "PEPE",
      "name": "Pepe Coin",
      "riskScore": 85,
      "communityScore": 72.5,
      "lpBurnedPercentage": 65.2,
      "top10HoldersPercentage": 12.8,
      "mintAuthDisabled": true,
      "raidingDetected": false,
      // ... other fields
    }
  ]
}
```

## Database Schema

### New Fields Added to Listing Model

```prisma
model Listing {
  // ... existing fields
  
  // New filter fields
  lpBurnedPercentage     Float?    // LP burned percentage (0-100)
  top10HoldersPercentage  Float?    // Top 10 holders percentage (0-100)
  mintAuthDisabled       Boolean?  // Mint authority disabled
  raidingDetected        Boolean?  // Raiding activity detected
  
  // ... rest of model
}
```

## Data Sources

### Current Implementation (Placeholder)
- **LP Burned**: Mock data (random 0-100%)
- **Top 10 Holders**: Mock data (random 0-50%)
- **Mint Auth**: Mock data (random boolean)
- **Raiding**: Mock data (20% chance of detection)

### Production Implementation (TODO)
- **LP Burned**: Solana RPC to check token supply and burned tokens
- **Top 10 Holders**: Solana RPC to fetch holder data and calculate concentration
- **Mint Auth**: Solana RPC to check mint authority status
- **Raiding**: Transaction pattern analysis for coordinated activity

## Frontend Integration

### Filter UI Components
The frontend should implement filter checkboxes and range inputs:

```typescript
// Filter state
const [filters, setFilters] = useState({
  minLpBurned: 50,           // >= 50% LP burned
  maxTop10Holders: 15,      // < 15% top 10 holders
  mintAuthDisabled: true,   // Mint auth disabled
  noRaiding: true,          // No raiding detected
});

// API call
const response = await fetch(`/api/listing/listings?${new URLSearchParams({
  minLpBurned: filters.minLpBurned.toString(),
  maxTop10Holders: filters.maxTop10Holders.toString(),
  mintAuthDisabled: filters.mintAuthDisabled.toString(),
  noRaiding: filters.noRaiding.toString(),
})}`);
```

### Display Logic
```typescript
// Show filter status in UI
const isFiltered = (listing) => {
  return (
    (listing.lpBurnedPercentage || 0) >= filters.minLpBurned &&
    (listing.top10HoldersPercentage || 100) < filters.maxTop10Holders &&
    listing.mintAuthDisabled === filters.mintAuthDisabled &&
    listing.raidingDetected !== filters.noRaiding
  );
};
```

## Testing

### Test Cases
1. **LP Burned Filter**: `minLpBurned=50` should only show tokens with 50%+ LP burned
2. **Top 10 Holders Filter**: `maxTop10Holders=15` should only show tokens with <15% concentration
3. **Mint Auth Filter**: `mintAuthDisabled=true` should only show tokens with disabled mint authority
4. **Raiding Filter**: `noRaiding=true` should only show tokens without raiding detection

### Test Data
```bash
# Test API endpoints
curl "http://localhost:3001/api/listing/listings?minLpBurned=50"
curl "http://localhost:3001/api/listing/listings?maxTop10Holders=15"
curl "http://localhost:3001/api/listing/listings?mintAuthDisabled=true"
curl "http://localhost:3001/api/listing/listings?noRaiding=true"
```

## Next Steps

1. **Implement Real Data Sources**: Replace mock data with actual Solana RPC calls
2. **Add Background Analysis**: Update refresh worker to analyze new tokens
3. **Frontend Integration**: Implement filter UI components
4. **Performance Optimization**: Add caching for analysis results
5. **Monitoring**: Add metrics for filter usage and performance

## Notes

- All new fields are optional (`nullable`) to maintain backward compatibility
- Mock data is used for development and testing
- Production implementation requires Solana RPC integration
- Filter logic follows the "safer = better" principle (higher LP burned, lower concentration, etc.)
