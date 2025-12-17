-- SQL Queries to Verify N8N Workflow Saved Data
-- Run these in your database to check if the test data was saved

-- ============================================
-- 1. Check if data was saved to 'tokens' table (n8n workflow uses this)
-- ============================================
SELECT 
    id,
    contract_address,
    name,
    symbol,
    chain,
    image_url,
    token_age_days,
    holder_count,
    last_scanned,
    created_at
FROM tokens
WHERE contract_address = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

-- ============================================
-- 2. Check if data was saved to 'listing' table (backend uses this)
-- ============================================
SELECT 
    id,
    "contractAddress",
    name,
    symbol,
    chain,
    "riskScore",
    tier,
    "createdAt",
    "lastScannedAt"
FROM listing
WHERE "contractAddress" = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

-- ============================================
-- 3. Check vetting results (should be in 'vetting_results' table)
-- ============================================
SELECT 
    vr.id,
    vr.token_id,
    vr.overall_score,
    vr.risk_level,
    vr.eligible_tier,
    vr.distribution_score,
    vr.liquidity_score,
    vr.dev_abandonment_score,
    vr.technical_score,
    vr.flags,
    vr.vetted_at,
    t.contract_address,
    t.name,
    t.symbol
FROM vetting_results vr
JOIN tokens t ON vr.token_id = t.id
WHERE t.contract_address = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

-- ============================================
-- 4. Check launch analysis
-- ============================================
SELECT 
    la.*,
    t.contract_address,
    t.name
FROM launch_analysis la
JOIN tokens t ON la.token_id = t.id
WHERE t.contract_address = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

-- ============================================
-- 5. Check holders data
-- ============================================
SELECT 
    h.*,
    t.contract_address,
    t.name
FROM holders h
JOIN tokens t ON h.token_id = t.id
WHERE t.contract_address = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

-- ============================================
-- 6. List all tables to see what exists
-- ============================================
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- ============================================
-- 7. Check recent activity in both tables
-- ============================================
-- Recent tokens (n8n workflow)
SELECT 
    'tokens (n8n)' as source,
    contract_address,
    name,
    symbol,
    created_at,
    last_scanned
FROM tokens
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;

-- Recent listings (backend)
SELECT 
    'listing (backend)' as source,
    "contractAddress",
    name,
    symbol,
    "createdAt",
    "lastScannedAt"
FROM listing
WHERE "createdAt" > NOW() - INTERVAL '1 hour'
ORDER BY "createdAt" DESC;

-- ============================================
-- 8. Count records in each table
-- ============================================
SELECT 
    'tokens' as table_name,
    COUNT(*) as record_count
FROM tokens
UNION ALL
SELECT 
    'listing' as table_name,
    COUNT(*) as record_count
FROM listing
UNION ALL
SELECT 
    'vetting_results' as table_name,
    COUNT(*) as record_count
FROM vetting_results
UNION ALL
SELECT 
    'launch_analysis' as table_name,
    COUNT(*) as record_count
FROM launch_analysis
UNION ALL
SELECT 
    'holders' as table_name,
    COUNT(*) as record_count
FROM holders;

