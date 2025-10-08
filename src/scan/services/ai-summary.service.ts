import { getRiskLevel } from './risk-scoring.service';

/**
 * Generates an AI-like summary based on token data, tier, and risk score
 * This is a rule-based summary generator for the MVP
 */
export function generateAISummary(tokenData, tier, riskScore) {
  const riskLevel = getRiskLevel(riskScore);
  const tierName = tier.name;
  
  // Base summary components
  const ageSummary = getAgeSummary(tokenData.project_age_days);
  const liquiditySummary = getLiquiditySummary(tokenData.lp_amount_usd, tokenData.lp_lock_months);
  const riskSummary = getRiskSummary(riskLevel, riskScore);
  const tierSummary = getTierSummary(tierName);
  
  // Combine into 2-3 sentences
  let summary = `${ageSummary} ${liquiditySummary} ${tierSummary} ${riskSummary}`;
  
  // Add specific warnings or positive notes
  const warnings = generateWarnings(tokenData, riskScore);
  const positives = generatePositives(tokenData, riskScore);
  
  if (warnings.length > 0) {
    summary += ` ⚠️ ${warnings[0]}`;
  } else if (positives.length > 0) {
    summary += ` ✅ ${positives[0]}`;
  }
  
  return summary;
}

/**
 * Generates age-based summary
 */
function getAgeSummary(ageDays) {
  if (ageDays < 14) {
    return "This is a very new project that doesn't meet minimum age requirements.";
  } else if (ageDays < 30) {
    return "This is a relatively new project in early development.";
  } else if (ageDays < 90) {
    return "This project has been active for several weeks and shows growth potential.";
  } else {
    return "This is an established project with a proven track record.";
  }
}

/**
 * Generates liquidity-based summary
 */
function getLiquiditySummary(lpAmount, lockMonths) {
  let liquidityDesc = '';
  
  if (lpAmount < 10000) {
    liquidityDesc = 'minimal liquidity';
  } else if (lpAmount < 50000) {
    liquidityDesc = 'moderate liquidity';
  } else if (lpAmount < 150000) {
    liquidityDesc = 'strong liquidity';
  } else {
    liquidityDesc = 'excellent liquidity';
  }
  
  let lockDesc = '';
  if (lockMonths < 6) {
    lockDesc = 'short-term LP commitment';
  } else if (lockMonths < 12) {
    lockDesc = 'medium-term LP lock';
  } else if (lockMonths < 24) {
    lockDesc = 'long-term LP commitment';
  } else {
    lockDesc = 'extended LP lock period';
  }
  
  return `It features ${liquidityDesc} with ${lockDesc}.`;
}

/**
 * Generates tier-based summary
 */
function getTierSummary(tierName) {
  switch (tierName) {
    case 'Seed':
      return 'Classified as Seed tier, suitable for early-stage investors comfortable with higher risk.';
    case 'Sprout':
      return 'Classified as Sprout tier, showing growth and development beyond initial stages.';
    case 'Bloom':
      return 'Classified as Bloom tier, demonstrating maturity and strong fundamentals.';
    case 'Stellar':
      return 'Classified as Stellar tier, representing the highest quality projects with excellent credentials.';
    default:
      return 'Classification pending further analysis.';
  }
}

/**
 * Generates risk-based summary
 */
function getRiskSummary(riskLevel, riskScore) {
  switch (riskLevel) {
    case 'Low Risk':
      return `Risk assessment shows low concern (${riskScore}/100) with solid fundamentals.`;
    case 'Medium Risk':
      return `Risk assessment indicates moderate caution needed (${riskScore}/100).`;
    case 'High Risk':
      return `Risk assessment suggests high caution required (${riskScore}/100).`;
    case 'Very High Risk':
      return `Risk assessment shows very high concern (${riskScore}/100) - proceed with extreme caution.`;
    default:
      return `Risk score: ${riskScore}/100.`;
  }
}

/**
 * Generates specific warnings based on token data
 */
function generateWarnings(tokenData, riskScore) {
  const warnings = [];
  
  // High concentration warning
  if (tokenData.top_holders.length > 0 && tokenData.top_holders[0].percentage > 15) {
    warnings.push('High concentration risk with large holder dominance.');
  }
  
  // Suspicious activity warning
  if (tokenData.suspicious_activity.sell_off_percent > 20) {
    warnings.push('Recent suspicious selling activity detected.');
  }
  
  // Smart contract warnings
  if (tokenData.smart_contract_risks.critical_vulnerabilities > 0) {
    warnings.push('Critical smart contract vulnerabilities found.');
  }
  
  // Authority warnings
  if (tokenData.mint_authority && tokenData.freeze_authority) {
    warnings.push('Both mint and freeze authorities are active.');
  }
  
  // Low liquidity warning
  if (tokenData.lp_amount_usd < 10000) {
    warnings.push('Limited liquidity may affect trading.');
  }
  
  return warnings;
}

/**
 * Generates positive notes based on token data
 */
function generatePositives(tokenData, riskScore) {
  const positives = [];
  
  // LP burned
  if (tokenData.lp_burned) {
    positives.push('Liquidity pool has been burned, providing additional security.');
  }
  
  // No authorities
  if (!tokenData.mint_authority && !tokenData.freeze_authority) {
    positives.push('No mint or freeze authorities, enhancing decentralization.');
  }
  
  // Full audit
  if (tokenData.smart_contract_risks.full_audit) {
    positives.push('Smart contract has undergone a full security audit.');
  }
  
  // Bug bounty
  if (tokenData.smart_contract_risks.bug_bounty) {
    positives.push('Active bug bounty program demonstrates commitment to security.');
  }
  
  // Strong liquidity
  if (tokenData.lp_amount_usd > 100000) {
    positives.push('Strong liquidity pool supports stable trading.');
  }
  
  return positives;
}


