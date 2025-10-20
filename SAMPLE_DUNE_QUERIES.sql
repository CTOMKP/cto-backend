-- Sample Dune Queries for Pump.fun Memecoin Metrics
-- Dashboard: https://dune.com/adam_tehc/memecoin-wars

-- =====================================================
-- Query 1: Daily Tokens Deployed (Launched)
-- =====================================================
-- Gets the count of new tokens created today on pump.fun
SELECT 
  COUNT(DISTINCT token_address) as daily_tokens_deployed
FROM solana.tokens
WHERE 
  created_at >= CURRENT_DATE
  AND platform = 'pump.fun'  -- Adjust based on actual schema
;

-- Alternative if using events:
SELECT 
  COUNT(*) as daily_tokens_deployed
FROM solana.pump_fun.token_created_events
WHERE 
  block_time >= CURRENT_DATE
;

-- =====================================================
-- Query 2: Daily Graduates (Tokens that bonded)
-- =====================================================
-- Gets the count of tokens that graduated (reached bonding curve) today
SELECT 
  COUNT(DISTINCT token_address) as daily_graduates
FROM solana.pump_fun.bonding_curve_events
WHERE 
  event_type = 'graduated'
  AND block_time >= CURRENT_DATE
;

-- Alternative:
SELECT 
  COUNT(*) as daily_graduates
FROM solana.pump_fun.graduated_tokens
WHERE 
  graduated_at >= CURRENT_DATE
;

-- =====================================================
-- Query 3: Top Tokens Last 7 Days (Runners)
-- =====================================================
-- Gets the count of top performing tokens in the last 7 days
SELECT 
  COUNT(*) as top_tokens_last_7_days
FROM (
  SELECT 
    token_address,
    SUM(volume_usd) as total_volume
  FROM solana.pump_fun.trades
  WHERE 
    block_time >= CURRENT_DATE - INTERVAL '7' DAY
  GROUP BY token_address
  ORDER BY total_volume DESC
  LIMIT 100  -- Top 100 tokens
) as top_tokens
;

-- =====================================================
-- INSTRUCTIONS TO USE THESE QUERIES:
-- =====================================================
-- 1. Go to https://dune.com/
-- 2. Click "Create" > "New Query"
-- 3. Copy each query above
-- 4. Adjust table names based on actual Dune schema for pump.fun
-- 5. Run and save each query
-- 6. Get the query ID from the URL (e.g., dune.com/queries/1234567)
-- 7. Replace the IDs in dune.service.ts lines 83-89
--
-- Example:
--   const dailyDeployed = await this.executeQuery(YOUR_QUERY_ID_HERE);

