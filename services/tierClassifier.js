import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load tier configuration
const tiersConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../config/tiers.json'), 'utf8')
);

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
  if (criteria.min && projectAge < criteria.min) return false;
  if (criteria.max && projectAge > criteria.max) return false;
  return true;
}

/**
 * Checks LP amount criteria
 */
function checkLPAmount(lpAmount, criteria) {
  if (criteria.min && lpAmount < criteria.min) return false;
  if (criteria.max && lpAmount > criteria.max) return false;
  return true;
}

/**
 * Checks LP lock criteria
 */
function checkLPLock(lpLockMonths, criteria) {
  if (criteria.min && lpLockMonths < criteria.min) return false;
  if (criteria.max && lpLockMonths > criteria.max) return false;
  return true;
}

/**
 * Checks wallet activity criteria
 */
function checkWalletActivity(tokenData, criteria) {
  const { active_wallets, suspicious_activity } = tokenData;
  
  // Check minimum active wallets
  if (criteria.min_active_wallets && active_wallets < criteria.min_active_wallets) {
    return false;
  }
  
  // Check maximum active wallets (for Seed tier)
  if (criteria.max_active_wallets && active_wallets > criteria.max_active_wallets) {
    return false;
  }
  
  // Check for suspicious activity flags
  if (criteria.flag_if_over) {
    if (criteria.flag_if_over.active_wallets && active_wallets > criteria.flag_if_over.active_wallets) {
      return false;
    }
    if (criteria.flag_if_over.sell_off_percent && 
        suspicious_activity.sell_off_percent > criteria.flag_if_over.sell_off_percent) {
      return false;
    }
    if (criteria.flag_if_over.affected_wallets_percent && 
        suspicious_activity.affected_wallets_percent > criteria.flag_if_over.affected_wallets_percent) {
      return false;
    }
  }
  
  // Check sell-off flags
  if (criteria.flag_if_sell_off) {
    if (criteria.flag_if_sell_off.sell_off_percent && 
        suspicious_activity.sell_off_percent > criteria.flag_if_sell_off.sell_off_percent) {
      return false;
    }
  }
  
  // Check wallet supply percentage (for Stellar tier)
  if (criteria.max_wallet_supply_percent) {
    const maxHolderPercentage = Math.max(...tokenData.top_holders.map(h => h.percentage));
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
      smartContractRisks.critical_vulnerabilities > criteria.critical_vulnerabilities) {
    return false;
  }
  
  // Check high vulnerabilities
  if (criteria.high_vulnerabilities !== undefined && 
      smartContractRisks.high_vulnerabilities > criteria.high_vulnerabilities) {
    return false;
  }
  
  // Check medium vulnerabilities
  if (criteria.medium_vulnerabilities !== undefined && 
      smartContractRisks.medium_vulnerabilities > criteria.medium_vulnerabilities) {
    return false;
  }
  
  if (criteria.max_medium_vulnerabilities !== undefined && 
      smartContractRisks.medium_vulnerabilities > criteria.max_medium_vulnerabilities) {
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
