import express from 'express';
import { validateSolanaAddress } from '../utils/validation.js';
import { fetchTokenData } from '../services/solanaApi.js';
import { classifyTier } from '../services/tierClassifier.js';
import { calculateRiskScore, getRiskLevel } from '../services/riskScoring.js';
import { generateAISummary } from '../services/aiSummary.js';
import { formatTokenAge, formatTokenAgeShort } from '../utils/ageFormatter.js';

const router = express.Router();

router.post('/scan', async (req, res) => {
  try {
    const { contractAddress } = req.body;

    // Validate input
    if (!contractAddress) {
      return res.status(400).json({ 
        error: 'Contract address is required' 
      });
    }

    if (!validateSolanaAddress(contractAddress)) {
      return res.status(400).json({ 
        error: 'Invalid Solana contract address format' 
      });
    }

    // Fetch token data from Solana APIs
    const tokenData = await fetchTokenData(contractAddress);
    
    if (!tokenData) {
      return res.status(404).json({ 
        error: 'Token not found or invalid contract address' 
      });
    }

    // Check minimum age requirement (14 days)
    if (tokenData.project_age_days < 14) {
      const ageDisplay = formatTokenAge(tokenData.project_age_days);

      return res.status(400).json({ 
        error: `Token is too young for listing. Minimum age requirement is 14 days. This token is ${ageDisplay} old.`,
        eligible: false,
        metadata: {
          token_symbol: tokenData.symbol,
          token_name: tokenData.name,
          project_age_days: tokenData.project_age_days,
          age_display: ageDisplay,
          minimum_age_required: 14
        }
      });
    }

    // Classify tier based on token data
    const tier = classifyTier(tokenData);
    
    if (!tier) {
      return res.status(400).json({ 
        error: 'Token does not meet minimum criteria for any tier',
        eligible: false
      });
    }

    // Calculate risk score
    const riskScore = calculateRiskScore(tokenData, tier);
    const riskLevel = getRiskLevel(riskScore);

    // Generate AI summary
    const summary = generateAISummary(tokenData, tier, riskScore);

    // Return results
    const response = {
      tier: tier.name,
      risk_score: riskScore,
      risk_level: riskLevel,
      eligible: true,
      summary,
      metadata: {
        token_symbol: tokenData.symbol,
        token_name: tokenData.name,
        project_age_days: tokenData.project_age_days,
        age_display: formatTokenAge(tokenData.project_age_days),
        age_display_short: formatTokenAgeShort(tokenData.project_age_days),
        creation_date: tokenData.creation_date,
        lp_amount_usd: tokenData.lp_amount_usd,
        token_price: tokenData.token_price,
        volume_24h: tokenData.volume_24h,
        market_cap: tokenData.market_cap,
        pool_count: tokenData.pool_count,
        lp_lock_months: tokenData.lp_lock_months,
        lp_burned: tokenData.lp_burned,
        lp_locked: tokenData.lp_locked,
        lock_contract: tokenData.lock_contract,
        lock_analysis: tokenData.lock_analysis,
        largest_lp_holder: tokenData.largest_lp_holder,
        pair_address: tokenData.pair_address,
        scan_timestamp: new Date().toISOString(),
        verified: tokenData.verified,
        holder_count: tokenData.holder_count,
        creation_transaction: tokenData.creation_transaction,
        distribution_metrics: tokenData.distribution_metrics,
        whale_analysis: tokenData.whale_analysis,
        suspicious_activity_details: tokenData.suspicious_activity,
        activity_summary: tokenData.activity_summary,
        wallet_activity_data: tokenData.wallet_activity,
        smart_contract_security: tokenData.smart_contract_risks
      }
    };

    res.json(response);

  } catch (error) {
    console.error('Scan error:', error);
    
    // More specific error handling
    if (error.message.includes('Token not found') || error.message.includes('account not found')) {
      return res.status(404).json({ 
        error: 'Token not found. Please verify the contract address is correct.',
        eligible: false
      });
    }
    
    if (error.message.includes('API') || error.message.includes('timeout')) {
      return res.status(503).json({ 
        error: 'External API temporarily unavailable. Please try again in a moment.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
    
    if (error.message.includes('Invalid') || error.message.includes('format')) {
      return res.status(400).json({ 
        error: 'Invalid contract address format. Please check and try again.',
        eligible: false
      });
    }
    
    res.status(500).json({ 
      error: 'Scan failed. Please try again later.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/scan-batch', async (req, res) => {
  try {
    const { contractAddresses } = req.body;

    // Validate input
    if (!contractAddresses || !Array.isArray(contractAddresses)) {
      return res.status(400).json({ 
        error: 'contractAddresses array is required' 
      });
    }

    // Validate array length (limit to prevent abuse)
    if (contractAddresses.length === 0) {
      return res.status(400).json({ 
        error: 'At least one contract address is required' 
      });
    }

    if (contractAddresses.length > 20) {
      return res.status(400).json({ 
        error: 'Maximum 20 contract addresses allowed per batch request' 
      });
    }

    // Validate each address
    const invalidAddresses = [];
    const validAddresses = [];
    
    contractAddresses.forEach((address, index) => {
      if (!validateSolanaAddress(address)) {
        invalidAddresses.push({ address, index });
      } else {
        validAddresses.push(address);
      }
    });

    if (invalidAddresses.length > 0) {
      return res.status(400).json({ 
        error: 'Invalid contract address format(s) found',
        invalidAddresses,
        validAddresses: validAddresses.length
      });
    }

    // Process all addresses in parallel
    const scanPromises = validAddresses.map(async (contractAddress) => {
      try {
        // Fetch token data from Solana APIs
        const tokenData = await fetchTokenData(contractAddress);
        
        if (!tokenData) {
          return {
            contractAddress,
            success: false,
            error: 'Token not found or invalid contract address',
            eligible: false
          };
        }

        // Check minimum age requirement (14 days)
        if (tokenData.project_age_days < 14) {
          const ageDisplay = formatTokenAge(tokenData.project_age_days);
          
          return {
            contractAddress,
            success: false,
            error: `Token is too young for listing. Minimum age requirement is 14 days. This token is ${ageDisplay} old.`,
            eligible: false,
            metadata: {
              token_symbol: tokenData.symbol,
              token_name: tokenData.name,
              project_age_days: tokenData.project_age_days,
              age_display: ageDisplay,
              minimum_age_required: 14
            }
          };
        }

        // Classify tier based on token data
        const tier = classifyTier(tokenData);
        
        if (!tier) {
          return {
            contractAddress,
            success: false,
            error: 'Token does not meet minimum criteria for any tier',
            eligible: false
          };
        }

        // Calculate risk score
        const riskScore = calculateRiskScore(tokenData, tier);
        const riskLevel = getRiskLevel(riskScore);

        // Generate AI summary
        const summary = generateAISummary(tokenData, tier, riskScore);

        // Return successful result
        return {
          contractAddress,
          success: true,
          tier: tier.name,
          risk_score: riskScore,
          risk_level: riskLevel,
          eligible: true,
          summary,
          metadata: {
            token_symbol: tokenData.symbol,
            token_name: tokenData.name,
            project_age_days: tokenData.project_age_days,
            age_display: formatTokenAge(tokenData.project_age_days),
            age_display_short: formatTokenAgeShort(tokenData.project_age_days),
            creation_date: tokenData.creation_date,
            lp_amount_usd: tokenData.lp_amount_usd,
            token_price: tokenData.token_price,
            volume_24h: tokenData.volume_24h,
            market_cap: tokenData.market_cap,
            pool_count: tokenData.pool_count,
            lp_lock_months: tokenData.lp_lock_months,
            lp_burned: tokenData.lp_burned,
            lp_locked: tokenData.lp_locked,
            lock_contract: tokenData.lock_contract,
            lock_analysis: tokenData.lock_analysis,
            largest_lp_holder: tokenData.largest_lp_holder,
            pair_address: tokenData.pair_address,
            scan_timestamp: new Date().toISOString(),
            verified: tokenData.verified,
            holder_count: tokenData.holder_count,
            creation_transaction: tokenData.creation_transaction,
            distribution_metrics: tokenData.distribution_metrics,
            whale_analysis: tokenData.whale_analysis,
            suspicious_activity_details: tokenData.suspicious_activity,
            activity_summary: tokenData.activity_summary,
            wallet_activity_data: tokenData.wallet_activity,
            smart_contract_security: tokenData.smart_contract_risks
          }
        };

      } catch (error) {
        console.error(`Error scanning ${contractAddress}:`, error);
        
        // Handle specific error types
        let errorMessage = 'Scan failed';
        let eligible = false;
        
        if (error.message.includes('Token not found') || error.message.includes('account not found')) {
          errorMessage = 'Token not found. Please verify the contract address is correct.';
        } else if (error.message.includes('API') || error.message.includes('timeout')) {
          errorMessage = 'External API temporarily unavailable.';
        } else if (error.message.includes('Invalid') || error.message.includes('format')) {
          errorMessage = 'Invalid contract address format.';
        }
        
        return {
          contractAddress,
          success: false,
          error: errorMessage,
          eligible,
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        };
      }
    });

    // Wait for all scans to complete
    const results = await Promise.all(scanPromises);

    // Calculate batch statistics
    const successfulScans = results.filter(r => r.success);
    const failedScans = results.filter(r => !r.success);
    const eligibleTokens = results.filter(r => r.success && r.eligible);
    const ineligibleTokens = results.filter(r => r.success && !r.eligible);

    // Group by tier for easy listing page display
    const tokensByTier = {};
    eligibleTokens.forEach(token => {
      const tier = token.tier;
      if (!tokensByTier[tier]) {
        tokensByTier[tier] = [];
      }
      tokensByTier[tier].push(token);
    });

    // Sort tiers by priority (Stellar -> Bloom -> Sprout -> Seed)
    const tierPriority = ['Stellar', 'Bloom', 'Sprout', 'Seed'];
    const sortedTiers = {};
    tierPriority.forEach(tier => {
      if (tokensByTier[tier]) {
        sortedTiers[tier] = tokensByTier[tier].sort((a, b) => b.risk_score - a.risk_score);
      }
    });

    // Return comprehensive batch results
    const response = {
      batch_summary: {
        total_requested: contractAddresses.length,
        total_scanned: validAddresses.length,
        successful_scans: successfulScans.length,
        failed_scans: failedScans.length,
        eligible_tokens: eligibleTokens.length,
        ineligible_tokens: ineligibleTokens.length,
        scan_timestamp: new Date().toISOString()
      },
      tokens_by_tier: sortedTiers,
      all_results: results,
      statistics: {
        tier_distribution: Object.keys(sortedTiers).reduce((acc, tier) => {
          acc[tier] = sortedTiers[tier].length;
          return acc;
        }, {}),
        average_risk_score: eligibleTokens.length > 0 
          ? Math.round(eligibleTokens.reduce((sum, token) => sum + token.risk_score, 0) / eligibleTokens.length)
          : 0,
        total_liquidity: eligibleTokens.reduce((sum, token) => sum + (token.metadata.lp_amount_usd || 0), 0)
      }
    };

    res.json(response);

  } catch (error) {
    console.error('Batch scan error:', error);
    
    res.status(500).json({ 
      error: 'Batch scan failed. Please try again later.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;
