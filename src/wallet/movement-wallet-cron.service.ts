import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MovementWalletService } from './movement-wallet.service';

/**
 * Movement Wallet Cron Service
 * Periodically syncs Movement wallet balances and detects funding
 */
@Injectable()
export class MovementWalletCronService {
  private readonly logger = new Logger(MovementWalletCronService.name);

  constructor(private readonly movementWalletService: MovementWalletService) {}

  /**
   * Sync all Movement wallets every 5 minutes
   * Detects funding by comparing balance changes
   */
  @Cron('0 */5 * * * *') // Every 5 minutes
  async syncAllMovementWallets() {
    this.logger.log('🔄 Starting Movement wallet sync...');
    
    try {
      // Use testnet by default (can be made configurable)
      const isTestnet = process.env.MOVEMENT_NETWORK !== 'mainnet';
      const result = await this.movementWalletService.syncAllWallets(isTestnet);
      
      this.logger.log(`✅ Movement wallet sync complete: ${result.synced} synced, ${result.funded} funding events detected`);
    } catch (error: any) {
      this.logger.error(`❌ Movement wallet sync failed: ${error.message}`);
    }
  }
}
