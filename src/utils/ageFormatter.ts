/**
 * Formats token age in a clean, readable format
 * @param ageInDays - Age in days (can be fractional)
 * @returns Formatted age string
 */
export function formatTokenAge(ageInDays: number): string {
  if (ageInDays < 1) {
    // For tokens less than 1 day old, show hours/minutes
    const hours = Math.floor(ageInDays * 24);
    if (hours === 0) {
      const minutes = Math.round(ageInDays * 24 * 60);
      if (minutes <= 0) {
        return "just created";
      } else if (minutes < 60) {
        return `${minutes} minutes`;
      } else {
        return "less than 1 hour";
      }
    } else if (hours === 1) {
      return "1 hour";
    } else {
      return `${hours} hours`;
    }
  } else if (ageInDays < 30) {
    // For tokens less than 30 days, show days
    const days = Math.floor(ageInDays);
    if (days === 1) {
      return "1 day";
    } else {
      return `${days} days`;
    }
  } else {
    // For tokens 30+ days old, show years, months, and days
    const totalDays = Math.floor(ageInDays);
    const years = Math.floor(totalDays / 365);
    const remainingDaysAfterYears = totalDays % 365;
    const months = Math.floor(remainingDaysAfterYears / 30);
    const days = remainingDaysAfterYears % 30;
    
    let result = '';
    
    if (years > 0) {
      result += `${years}y`;
      if (months > 0 || days > 0) {
        result += ' ';
      }
    }
    
    if (months > 0) {
      result += `${months}mo`;
      if (days > 0) {
        result += ' ';
      }
    }
    
    if (days > 0) {
      result += `${days}d`;
    }
    
    return result;
  }
}

/**
 * Formats token age for display in results (shorter format)
 * @param ageInDays - Age in days (can be fractional)
 * @returns Short formatted age string
 */
export function formatTokenAgeShort(ageInDays: number): string {
  if (ageInDays < 1) {
    // For tokens less than 1 day old, show hours/minutes
    const hours = Math.floor(ageInDays * 24);
    if (hours === 0) {
      const minutes = Math.round(ageInDays * 24 * 60);
      if (minutes <= 0) {
        return "just created";
      } else if (minutes < 60) {
        return `${minutes}m`;
      } else {
        return "<1h";
      }
    } else if (hours === 1) {
      return "1h";
    } else {
      return `${hours}h`;
    }
  } else if (ageInDays < 30) {
    // For tokens less than 30 days, show days
    const days = Math.floor(ageInDays);
    if (days === 1) {
      return "1d";
    } else {
      return `${days}d`;
    }
  } else {
    // For tokens 30+ days old, show years, months, and days
    const totalDays = Math.floor(ageInDays);
    const years = Math.floor(totalDays / 365);
    const remainingDaysAfterYears = totalDays % 365;
    const months = Math.floor(remainingDaysAfterYears / 30);
    const days = remainingDaysAfterYears % 30;
    
    let result = '';
    
    if (years > 0) {
      result += `${years}y`;
      if (months > 0 || days > 0) {
        result += ' ';
      }
    }
    
    if (months > 0) {
      result += `${months}mo`;
      if (days > 0) {
        result += ' ';
      }
    }
    
    if (days > 0) {
      result += `${days}d`;
    }
    
    return result;
  }
}


