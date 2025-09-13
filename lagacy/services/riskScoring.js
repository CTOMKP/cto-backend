/**
 * Calculates the risk score for a token based on its data and tier
 * Returns a score from 0-100 (lower is better/safer)
 */
export function calculateRiskScore(tokenData, tier) {
  const weighting = tier.weighting;
  const targetScore = tier.risk_score_target;
  
  // Calculate individual component scores (0-100, where 0 is best)
  const lpScore = calculateLPScore(tokenData, tier);
  const lockBurnScore = calculateLockBurnScore(tokenData, tier);
  const walletActivityScore = calculateWalletActivityScore(tokenData, tier);
  const smartContractScore = calculateSmartContractScore(tokenData, tier);
  
  // Apply weighted average
  const weightedScore = (
    (lpScore * weighting.lp_amount / 100) +
    (lockBurnScore * weighting.lp_lock_burn / 100) +
    (walletActivityScore * weighting.wallet_activity / 100) +
    (smartContractScore * weighting.smart_contract / 100)
  );
  
  // Ensure score is within 0-100 range
  return Math.max(0, Math.min(100, Math.round(weightedScore)));
}

/**
 * Calculates LP amount risk score
 */
function calculateLPScore(tokenData, tier) {
  const lpAmount = tokenData.lp_amount_usd;
  const criteria = tier.criteria.lp_amount_usd;
  
  if (!criteria.min) return 0;
  
  // Higher LP is better (lower risk)
  if (lpAmount >= criteria.min * 2) return 10; // Excellent
  if (lpAmount >= criteria.min * 1.5) return 25; // Good
  if (lpAmount >= criteria.min) return 50; // Acceptable
  
  return 80; // Below minimum is high risk
}

/**
 * Calculates LP lock/burn risk score
 */
function calculateLockBurnScore(tokenData, tier) {
  const lockMonths = tokenData.lp_lock_months;
  const isBurned = tokenData.lp_burned;
  const criteria = tier.criteria.lp_lock_months;
  
  // LP burned is the best scenario
  if (isBurned) return 5;
  
  if (!criteria.min) return 50;
  
  // Longer lock is better (lower risk)
  if (lockMonths >= criteria.min * 2) return 15; // Excellent
  if (lockMonths >= criteria.min * 1.5) return 30; // Good
  if (lockMonths >= criteria.min) return 50; // Acceptable
  
  return 85; // Below minimum is very high risk
}

/**
 * Calculates wallet activity risk score
 */
function calculateWalletActivityScore(tokenData, tier) {
  const { active_wallets, suspicious_activity, top_holders } = tokenData;
  const criteria = tier.criteria.wallet_activity;
  
  let score = 50; // Base score
  
  // Check active wallets count
  if (criteria.min_active_wallets) {
    if (active_wallets >= criteria.min_active_wallets * 2) {
      score -= 20; // More active wallets = lower risk
    } else if (active_wallets >= criteria.min_active_wallets) {
      score -= 10;
    } else {
      score += 30; // Below minimum is high risk
    }
  }
  
  // Check for concentration risk
  const topHolderPercentage = top_holders.length > 0 ? top_holders[0].percentage : 0;
  if (topHolderPercentage > 15) score += 25;
  else if (topHolderPercentage > 10) score += 15;
  else if (topHolderPercentage > 5) score += 5;
  
  // Check suspicious activity
  if (suspicious_activity.sell_off_percent > 20) score += 30;
  else if (suspicious_activity.sell_off_percent > 10) score += 15;
  
  if (suspicious_activity.affected_wallets_percent > 25) score += 20;
  else if (suspicious_activity.affected_wallets_percent > 15) score += 10;
  
  // Check for suspicious holders
  const suspiciousHolders = top_holders.filter(h => h.is_suspicious).length;
  if (suspiciousHolders > 2) score += 25;
  else if (suspiciousHolders > 0) score += 10;
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Calculates smart contract risk score
 */
function calculateSmartContractScore(tokenData, tier) {
  const risks = tokenData.smart_contract_risks;
  let score = 30; // Base score for basic contract
  
  // Critical vulnerabilities are deal-breakers
  if (risks.critical_vulnerabilities > 0) {
    score += 60;
  }
  
  // High vulnerabilities
  score += risks.high_vulnerabilities * 20;
  
  // Medium vulnerabilities
  score += risks.medium_vulnerabilities * 8;
  
  // Positive factors (reduce score)
  if (risks.full_audit) score -= 20;
  if (risks.bug_bounty) score -= 15;
  
  // Authority checks (having authorities increases risk)
  if (tokenData.mint_authority) score += 15;
  if (tokenData.freeze_authority) score += 10;
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Gets risk level description based on score
 */
export function getRiskLevel(score) {
  if (score <= 39) return 'Low Risk';
  if (score <= 69) return 'Medium Risk';
  return 'High Risk';
}

/**
 * Gets risk color for UI display
 */
export function getRiskColor(score) {
  if (score <= 39) return '#10B981'; // Green
  if (score <= 69) return '#F59E0B'; // Yellow
  return '#EF4444'; // Red
}
