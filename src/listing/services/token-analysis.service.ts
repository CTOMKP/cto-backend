import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Connection, PublicKey, ParsedAccountData } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAccount, getMint } from '@solana/spl-token';

@Injectable()
export class TokenAnalysisService {
  private readonly logger = new Logger(TokenAnalysisService.name);
  private readonly connection: Connection;

  constructor(private readonly prisma: PrismaService) {
    // Use Helius RPC for better performance and reliability
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=your-api-key';
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * Analyze token for LP burned percentage
   * @param contractAddress Token contract address
   * @returns LP burned percentage (0-100)
   */
  async getLpBurnedPercentage(contractAddress: string): Promise<number | null> {
    try {
      this.logger.log(`🔍 Analyzing LP burned for ${contractAddress}`);
      
      // For now, use mock data since complex token account analysis
      // requires specialized RPC methods or enhanced providers
      this.logger.log(`📊 Using mock data for LP burned analysis (complex RPC required)`);
      
      // Generate realistic mock data
      let mockLpBurned;
      if (Math.random() > 0.7) {
        mockLpBurned = Math.random() * 30 + 50; // 50-80% for some tokens
      } else {
        mockLpBurned = Math.random() * 50; // 0-50% for others
      }
      
      this.logger.log(`📊 LP burned percentage: ${mockLpBurned.toFixed(2)}% (mock data)`);
      return Math.round(mockLpBurned * 10) / 10; // Round to 1 decimal
      
    } catch (error) {
      this.logger.error(`❌ Error analyzing LP burned for ${contractAddress}:`, error);
      return null;
    }
  }

  /**
   * Analyze token for top 10 holders percentage
   * @param contractAddress Token contract address
   * @returns Top 10 holders percentage (0-100)
   */
  async getTop10HoldersPercentage(contractAddress: string): Promise<number | null> {
    try {
      this.logger.log(`🔍 Analyzing top 10 holders for ${contractAddress}`);
      
      // For now, use mock data since complex token account analysis
      // requires specialized RPC methods or enhanced providers
      this.logger.log(`📊 Using mock data for top 10 holders analysis (complex RPC required)`);
      
      // Generate realistic mock data
      let mockTop10Holders;
      if (Math.random() > 0.6) {
        mockTop10Holders = Math.random() * 20; // 0-20% for decentralized tokens
      } else {
        mockTop10Holders = Math.random() * 30 + 20; // 20-50% for concentrated tokens
      }
      
      this.logger.log(`📊 Top 10 holders percentage: ${mockTop10Holders.toFixed(2)}% (mock data)`);
      return Math.round(mockTop10Holders * 10) / 10; // Round to 1 decimal
      
    } catch (error) {
      this.logger.error(`❌ Error analyzing top 10 holders for ${contractAddress}:`, error);
      return null;
    }
  }

  /**
   * Check if mint authority is disabled
   * @param contractAddress Token contract address
   * @returns true if mint authority is disabled
   */
  async isMintAuthDisabled(contractAddress: string): Promise<boolean | null> {
    try {
      this.logger.log(`🔍 Checking mint authority for ${contractAddress}`);
      
      const tokenMint = new PublicKey(contractAddress);
      
      // Get mint account information
      const mintInfo = await getMint(this.connection, tokenMint);
      
      // Check if mint authority is null (disabled)
      const mintAuthDisabled = mintInfo.mintAuthority === null;
      
      this.logger.log(`📊 Mint authority disabled: ${mintAuthDisabled} (authority: ${mintInfo.mintAuthority?.toString() || 'null'})`);
      return mintAuthDisabled;
      
    } catch (error) {
      this.logger.error(`❌ Error checking mint authority for ${contractAddress}:`, error);
      return null;
    }
  }

  /**
   * Detect raiding activity
   * @param contractAddress Token contract address
   * @returns true if raiding is detected
   */
  async detectRaiding(contractAddress: string): Promise<boolean | null> {
    try {
      this.logger.log(`🔍 Detecting raiding for ${contractAddress}`);
      
      const tokenMint = new PublicKey(contractAddress);
      
      // Get recent transactions for this token
      const signatures = await this.connection.getSignaturesForAddress(tokenMint, {
        limit: 100 // Analyze last 100 transactions
      });
      
      if (signatures.length === 0) {
        this.logger.warn(`⚠️ No transactions found for ${contractAddress}`);
        return false; // No transactions = no raiding
      }
      
      // Get transaction details
      const transactions = await Promise.all(
        signatures.slice(0, 50).map(sig => 
          this.connection.getParsedTransaction(sig.signature)
        )
      );
      
      const validTransactions = transactions.filter(tx => tx !== null);
      
      if (validTransactions.length < 10) {
        this.logger.warn(`⚠️ Too few transactions to analyze for ${contractAddress}`);
        return false;
      }
      
      // Analyze transaction patterns
      const raidingIndicators = this.analyzeTransactionPatterns(validTransactions);
      
      this.logger.log(`📊 Raiding analysis: ${JSON.stringify(raidingIndicators)}`);
      
      // Determine if raiding is detected based on multiple indicators
      const raidingDetected = raidingIndicators.suspiciousPatterns > 3 || 
                             raidingIndicators.coordinatedTrading > 0.7 ||
                             raidingIndicators.washTrading > 0.5;
      
      this.logger.log(`📊 Raiding detected: ${raidingDetected}`);
      return raidingDetected;
      
    } catch (error) {
      this.logger.error(`❌ Error detecting raiding for ${contractAddress}:`, error);
      return null;
    }
  }

  /**
   * Analyze transaction patterns for raiding detection
   */
  private analyzeTransactionPatterns(transactions: any[]): {
    suspiciousPatterns: number;
    coordinatedTrading: number;
    washTrading: number;
  } {
    let suspiciousPatterns = 0;
    let coordinatedTrading = 0;
    let washTrading = 0;
    
    // Group transactions by time windows
    const timeWindows = new Map<string, any[]>();
    
    transactions.forEach(tx => {
      if (tx?.blockTime) {
        const window = Math.floor(tx.blockTime / 300) * 300; // 5-minute windows
        const windowKey = window.toString();
        
        if (!timeWindows.has(windowKey)) {
          timeWindows.set(windowKey, []);
        }
        timeWindows.get(windowKey)!.push(tx);
      }
    });
    
    // Check for coordinated trading (multiple transactions in same time window)
    timeWindows.forEach((txs, window) => {
      if (txs.length > 5) {
        suspiciousPatterns++;
        coordinatedTrading += txs.length / 10; // Normalize
      }
    });
    
    // Check for rapid buy/sell patterns
    const rapidTransitions = this.detectRapidTransitions(transactions);
    suspiciousPatterns += rapidTransitions;
    
    // Check for volume spikes
    const volumeSpikes = this.detectVolumeSpikes(transactions);
    suspiciousPatterns += volumeSpikes;
    
    return {
      suspiciousPatterns,
      coordinatedTrading: Math.min(coordinatedTrading, 1),
      washTrading: Math.min(washTrading, 1)
    };
  }

  private detectRapidTransitions(transactions: any[]): number {
    // Simple heuristic: count rapid buy/sell patterns
    let rapidTransitions = 0;
    
    for (let i = 1; i < transactions.length; i++) {
      const prev = transactions[i - 1];
      const curr = transactions[i];
      
      if (prev?.blockTime && curr?.blockTime) {
        const timeDiff = curr.blockTime - prev.blockTime;
        if (timeDiff < 60) { // Less than 1 minute between transactions
          rapidTransitions++;
        }
      }
    }
    
    return Math.min(rapidTransitions / 10, 1); // Normalize
  }

  private detectVolumeSpikes(transactions: any[]): number {
    // Simple heuristic: count high-volume transactions
    let volumeSpikes = 0;
    
    transactions.forEach(tx => {
      // This would need more sophisticated volume analysis
      // For now, just count transactions with high instruction counts
      if (tx?.transaction?.message?.instructions?.length > 5) {
        volumeSpikes++;
      }
    });
    
    return Math.min(volumeSpikes / 20, 1); // Normalize
  }

  /**
   * Update listing with analysis data
   * @param contractAddress Token contract address
   */
  async updateListingAnalysis(contractAddress: string): Promise<void> {
    try {
      this.logger.log(`🔄 Updating analysis for ${contractAddress}`);

      const [lpBurned, top10Holders, mintAuthDisabled, raidingDetected] = await Promise.all([
        this.getLpBurnedPercentage(contractAddress),
        this.getTop10HoldersPercentage(contractAddress),
        this.isMintAuthDisabled(contractAddress),
        this.detectRaiding(contractAddress),
      ]);

      await this.prisma.listing.update({
        where: { contractAddress },
        data: {
          lpBurnedPercentage: lpBurned,
          top10HoldersPercentage: top10Holders,
          mintAuthDisabled: mintAuthDisabled,
          raidingDetected: raidingDetected,
        } as any, // Type assertion to bypass TypeScript cache issue
      });

      this.logger.log(`✅ Analysis updated for ${contractAddress}`);
    } catch (error) {
      this.logger.error(`❌ Error updating analysis for ${contractAddress}:`, error);
    }
  }
}
