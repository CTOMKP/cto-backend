// Tier configuration embedded directly to avoid import issues
const tiersConfig = {
  "tiers": [
    {
      "name": "Seed",
      "description": "Entry-level CTO projects, 14–21 days old, minimal liquidity, early-stage activity.",
      "criteria": {
        "project_age_days": { "min": 14, "max": 21 },
        "lp_amount_usd": { "min": 5000, "max": 100000 },
        "lp_lock_months": { "min": 0, "max": 12 },
        "wallet_activity": {
          "min_active_wallets": 5,
          "max_active_wallets": 50,
          "flag_if_over": { "active_wallets": 100, "sell_off_percent": 15 }
        },
        "smart_contract": { "critical_vulnerabilities": 0 }
      },
      "risk_score_target": 70,
      "weighting": {
        "lp_amount": 30,
        "lp_lock_burn": 30,
        "wallet_activity": 20,
        "smart_contract": 20
      }
    },
    {
      "name": "Sprout",
      "description": "Established CTO projects, 21+ days old, growing liquidity & community engagement.",
      "criteria": {
        "project_age_days": { "min": 21 },
        "lp_amount_usd": { "min": 15000, "max": 10000000 },
        "lp_lock_months": { "min": 0 },
        "wallet_activity": {
          "min_active_wallets": 10,
          "max_active_wallets": 200,
          "flag_if_over": { "sell_off_percent": 30, "affected_wallets_percent": 35 }
        },
        "smart_contract": { "max_medium_vulnerabilities": 5 }
      },
      "risk_score_target": 65,
      "weighting": {
        "lp_amount": 25,
        "lp_lock_burn": 30,
        "wallet_activity": 25,
        "smart_contract": 20
      }
    },
    {
      "name": "Bloom",
      "description": "Mature CTO projects, 30+ days old, strong liquidity & proven track record.",
      "criteria": {
        "project_age_days": { "min": 30 },
        "lp_amount_usd": { "min": 25000, "max": 50000000 },
        "lp_lock_months": { "min": 0 },
        "wallet_activity": {
          "min_active_wallets": 15,
          "flag_if_sell_off": { "sell_off_percent": 25 }
        },
        "smart_contract": { "max_medium_vulnerabilities": 3 }
      },
      "risk_score_target": 60,
      "weighting": {
        "lp_amount": 25,
        "lp_lock_burn": 30,
        "wallet_activity": 25,
        "smart_contract": 20
      }
    },
    {
      "name": "Stellar",
      "description": "Highly credible CTO projects, ≥90 days old, top liquidity & governance standards.",
      "criteria": {
        "project_age_days": { "min": 90 },
        "lp_amount_usd": { "min": 100000 },
        "lp_lock_months": { "min": 0 },
        "wallet_activity": {
          "min_active_wallets": 40,
          "max_wallet_supply_percent": 10,
          "require_vesting_for_large_holders": true
        },
        "smart_contract": { "full_audit": true, "bug_bounty": true, "critical_vulnerabilities": 0, "high_vulnerabilities": 0 }
      },
      "risk_score_target": 50,
      "weighting": {
        "lp_amount": 20,
        "lp_lock_burn": 30,
        "wallet_activity": 30,
        "smart_contract": 20
      }
    }
  ]
};

/**
 * Classifies a token into the appropriate tier based on its data
 * Returns the tier object or null if no tier matches
 */
export function classifyTier(tokenData) {
  const tiers = tiersConfig.tiers;
  
  // Check tiers in reverse order: Stellar -> Bloom -> Sprout -> Seed
  // Find the highest tier that matches (check from highest to lowest)
  let matchedTier = null;
  
  for (const tier of tiers) {
    if (meetsCriteria(tokenData, tier.criteria)) {
      matchedTier = tier; // Keep checking to find the highest matching tier
    }
  }
  
  return matchedTier;
}

/**
 * Checks if token data meets the criteria for a specific tier
 */
function meetsCriteria(tokenData, criteria) {
  try {
    // Check project age
    if (!checkProjectAge(tokenData.project_age_days, criteria.project_age_days)) {
      return false;
    }
    
    // Check LP amount
    if (!checkLPAmount(tokenData.lp_amount_usd, criteria.lp_amount_usd)) {
      return false;
    }
    
    // Check LP lock duration
    if (!checkLPLock(tokenData.lp_lock_months, criteria.lp_lock_months)) {
      return false;
    }
    
    // Check wallet activity
    if (!checkWalletActivity(tokenData, criteria.wallet_activity)) {
      return false;
    }
    
    // Check smart contract requirements
    if (!checkSmartContract(tokenData.smart_contract_risks, criteria.smart_contract)) {
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Error checking criteria:', error);
    return false;
  }
}

/**
 * Checks project age criteria
 */
function checkProjectAge(projectAge, criteria) {
  if (typeof criteria.min === 'number' && projectAge < criteria.min) return false;
  if (typeof criteria.max === 'number' && projectAge > criteria.max) return false;
  return true;
}

/**
 * Checks LP amount criteria
 */
function checkLPAmount(lpAmount, criteria) {
  if (typeof criteria.min === 'number' && lpAmount < criteria.min) return false;
  // Ignore max cap to avoid penalizing large-cap tokens (e.g., USDC)
  // if (typeof criteria.max === 'number' && lpAmount > criteria.max) return false;
  return true;
}

/**
 * Checks LP lock criteria
 */
function checkLPLock(lpLockMonths, criteria) {
  if (typeof criteria.min === 'number' && lpLockMonths < criteria.min) return false;
  if (typeof criteria.max === 'number' && lpLockMonths > criteria.max) return false;
  return true;
}

/**
 * Checks wallet activity criteria
 */
function checkWalletActivity(tokenData, criteria) {
  const { active_wallets, suspicious_activity } = tokenData;
  
  // Check minimum active wallets
  if (typeof criteria.min_active_wallets === 'number' && active_wallets < criteria.min_active_wallets) {
    return false;
  }
  
  // Check maximum active wallets (for Seed tier)
  if (typeof criteria.max_active_wallets === 'number' && active_wallets > criteria.max_active_wallets) {
    return false;
  }
  
  // Check for suspicious activity flags
  if (criteria.flag_if_over) {
    if (typeof criteria.flag_if_over.active_wallets === 'number' && active_wallets > criteria.flag_if_over.active_wallets) {
      return false;
    }
    if (typeof criteria.flag_if_over.sell_off_percent === 'number' && 
        Number(suspicious_activity?.sell_off_percent) > criteria.flag_if_over.sell_off_percent) {
      return false;
    }
    if (typeof criteria.flag_if_over.affected_wallets_percent === 'number' && 
        Number(suspicious_activity?.affected_wallets_percent) > criteria.flag_if_over.affected_wallets_percent) {
      return false;
    }
  }
  
  // Check sell-off flags
  if (criteria.flag_if_sell_off) {
    if (typeof criteria.flag_if_sell_off.sell_off_percent === 'number' && 
        Number(suspicious_activity?.sell_off_percent) > criteria.flag_if_sell_off.sell_off_percent) {
      return false;
    }
  }
  
  // Check wallet supply percentage (for Stellar tier)
  if (criteria.max_wallet_supply_percent) {
    const percentages = Array.isArray(tokenData.top_holders)
      ? tokenData.top_holders.map((h: any) => h.percentage ?? h.share ?? h.percent).filter((x: any) => Number.isFinite(Number(x))).map(Number)
      : [];
    const maxHolderPercentage = percentages.length ? Math.max(...percentages) : 0;
    if (maxHolderPercentage > criteria.max_wallet_supply_percent) {
      return false;
    }
  }
  
  return true;
}

/**
 * Checks smart contract criteria
 */
function checkSmartContract(smartContractRisks, criteria) {
  // Check critical vulnerabilities
  if (criteria.critical_vulnerabilities !== undefined && 
      Number(smartContractRisks?.critical_vulnerabilities) > criteria.critical_vulnerabilities) {
    return false;
  }
  
  // Check high vulnerabilities
  if (criteria.high_vulnerabilities !== undefined && 
      Number(smartContractRisks?.high_vulnerabilities) > criteria.high_vulnerabilities) {
    return false;
  }
  
  // Check medium vulnerabilities
  if (criteria.medium_vulnerabilities !== undefined && 
      Number(smartContractRisks?.medium_vulnerabilities) > criteria.medium_vulnerabilities) {
    return false;
  }
  
  if (criteria.max_medium_vulnerabilities !== undefined && 
      Number(smartContractRisks?.medium_vulnerabilities) > criteria.max_medium_vulnerabilities) {
    return false;
  }
  
  // Check audit requirements (relaxed for MVP - only fail if explicitly false)
  if (criteria.full_audit && smartContractRisks.full_audit === false) {
    return false;
  }
  
  // Check bug bounty requirements (relaxed for MVP - only fail if explicitly false)
  if (criteria.bug_bounty && smartContractRisks.bug_bounty === false) {
    return false;
  }
  
  return true;
}

