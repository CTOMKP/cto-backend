# 📊 Dune Analytics Integration Setup

## ✅ What Was Built

We've integrated Dune Analytics to pull **live memecoin statistics** from https://dune.com/adam_tehc/memecoin-wars

### Backend Components:
- `src/dune/dune.service.ts` - Fetches and caches stats from Dune API
- `src/dune/dune.controller.ts` - Exposes `/api/stats/memecoin` endpoint
- `src/dune/dune.module.ts` - Dune module

### Frontend Integration:
- `main-cto-frontend/src/app/page.tsx` - Fetches and displays live stats

---

## 🔧 Railway Configuration

**Add this environment variable to Railway:**

```
DUNE_API_KEY=ksvavgx04wuAqbneYypa3pgnXHOHTnJg
```

### Steps:
1. Go to Railway → cto-backend service → Variables
2. Click "New Variable"
3. Add: `DUNE_API_KEY` = `ksvavgx04wuAqbneYypa3pgnXHOHTnJg`
4. Deploy (auto-redeploy will trigger)

---

## 📝 Getting Dune Query IDs

Currently using **placeholder query IDs**. To get real data:

1. Go to https://dune.com/adam_tehc/memecoin-wars
2. Click on each chart you want data from
3. Find the query ID in the URL (e.g., `dune.com/queries/4301519`)
4. Update `dune.service.ts` line 81-87 with real query IDs:

```typescript
// Execute query for daily tokens deployed
const dailyDeployed = await this.executeQuery(REAL_QUERY_ID_HERE);

// Execute query for daily graduates  
const dailyGraduates = await this.executeQuery(REAL_QUERY_ID_HERE);

// Execute query for top tokens last 7 days
const topTokens = await this.executeQuery(REAL_QUERY_ID_HERE);
```

---

## 🎯 How It Works

1. **Caching**: Stats refresh every 10 minutes (configurable)
2. **Fallback**: If Dune API fails, returns default values (100, 100, 100)
3. **Frontend**: Fetches from `/api/stats/memecoin` on page load
4. **Format**: Numbers display with commas (e.g., 1,234)

---

## 🧪 Testing

### Test Backend Endpoint:
```bash
curl https://cto-backend-production-28e3.up.railway.app/api/stats/memecoin
```

**Expected Response:**
```json
{
  "dailyTokensDeployed": 100,
  "dailyGraduates": 100,
  "topTokensLast7Days": 100,
  "lastUpdated": "2025-01-09T12:00:00.000Z"
}
```

### Test Frontend:
Visit https://cto-frontend.vercel.app/ and check the stats section.

---

## 🔍 Finding the Right Queries

You need to identify which specific queries on the Dune dashboard correspond to:
- **Launched**: Daily tokens deployed count
- **Graduated**: Daily graduates (tokens that reached bonding curve)
- **Runners**: Top tokens launched in last 7 days

Once you find them, replace the placeholder query IDs in `dune.service.ts`.

---

## ⚡ Admin Refresh Endpoint

Force refresh the cache (admin only):
```bash
POST /api/stats/memecoin/refresh
Authorization: Bearer YOUR_ADMIN_JWT_TOKEN
```

---

## 📈 Future Enhancements

- Add more granular stats (hourly, weekly)
- Cache stats in Redis for better performance
- Add charts/graphs to visualize trends
- Real-time WebSocket updates

