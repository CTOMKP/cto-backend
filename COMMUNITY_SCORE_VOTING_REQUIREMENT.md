# Community Score - User Voting System Requirement

## Current Status

**Problem**: Community score is currently **automatically calculated** using a formula based on:
- Holders (30%)
- Transactions (25%)
- Price changes (15%)
- Liquidity (15%)
- Age (5%)
- Safety bonus (10%)

**Client Requirement**: Community score should be **based on user votes and interactions** on the CTO platform, NOT automatic calculation.

## Required Changes

### 1. Database Schema Changes

Add a new model to track user votes/interactions:

```prisma
model TokenVote {
  id              String   @id @default(cuid())
  contractAddress String
  userId          Int
  voteType        VoteType // UPVOTE, DOWNVOTE, LIKE, etc.
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  listing Listing? @relation(fields: [contractAddress], references: [contractAddress])

  @@unique([contractAddress, userId, voteType])
  @@index([contractAddress])
  @@index([userId])
}

enum VoteType {
  UPVOTE
  DOWNVOTE
  LIKE
  DISLIKE
}
```

### 2. Backend API Changes

**Remove automatic calculation** from:
- `src/listing/repository/listing.repository.ts` (remove `computeCommunityScore` calls)

**Add new endpoints**:
- `POST /api/v1/listings/:contractAddress/vote` - Submit a vote
- `GET /api/v1/listings/:contractAddress/votes` - Get vote summary
- `DELETE /api/v1/listings/:contractAddress/vote` - Remove vote

**Add service** to calculate community score from votes:
- Calculate based on: `(upvotes - downvotes) / total_votes * 100`
- Or weighted formula: `(upvotes * 2 - downvotes) / (total_votes * 2) * 100`
- Store in `Listing.communityScore` field

### 3. Frontend Changes

**Add voting UI**:
- Upvote/Downvote buttons on token cards
- Display current community score (from votes)
- Show vote count and user's current vote status

### 4. Migration Strategy

1. **Phase 1**: Add voting system alongside automatic calculation
2. **Phase 2**: Switch to vote-based calculation for new tokens
3. **Phase 3**: Migrate existing tokens to vote-based (or keep auto-calc as fallback)

## Implementation Priority

**HIGH**: This is a core feature requirement from the client. The automatic calculation should be replaced with user-based voting.

## Notes

- Community score should reflect **user sentiment** on the platform
- Consider implementing vote weighting (e.g., verified users' votes count more)
- May need to handle spam/abuse (rate limiting, vote validation)
- Consider showing both "automatic score" (for reference) and "community score" (from votes) during transition

