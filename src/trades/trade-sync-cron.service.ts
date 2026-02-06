import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TradeHistoryService } from './trade-history.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Trade Sync Cron Service
 * Periodically syncs Movement trades from Sentio to UserTrade table
 * This ensures local PostgreSQL always matches what Sentio has indexed
 */
@Injectable()
export class TradeSyncCronService {
  private readonly logger = new Logger(TradeSyncCronService.name);

  constructor(
    private readonly tradeHistoryService: TradeHistoryService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Sync Sentio trades to UserTrade table every 5 minutes
   * Processes all users with Movement wallets
   */
  @Cron('0 */5 * * * *', {
    name: 'sync-sentio-trades',
    timeZone: 'UTC',
  })
  async syncSentioTradesToDatabase() {
    this.logger.log('🔄 Starting Sentio trades sync to UserTrade table...');

    try {
      // Get all users with Movement wallets
      const movementWallets = await this.prisma.wallet.findMany({
        where: {
          blockchain: 'MOVEMENT',
          walletClient: 'APTOS_EMBEDDED',
        },
        include: {
          user: {
            select: {
              id: true,
            },
          },
        },
      });

      if (movementWallets.length === 0) {
        this.logger.debug('No Movement wallets found to sync');
        return;
      }

      this.logger.log(`📊 Found ${movementWallets.length} Movement wallets to sync`);

      let totalSynced = 0;
      let totalTrades = 0;

      // Sync trades for each wallet
      for (const wallet of movementWallets) {
        if (!wallet.address || !wallet.user) {
          continue;
        }

        try {
          const syncedCount = await this.tradeHistoryService.syncSentioTradesToUserTrade(
            wallet.user.id,
            wallet.address,
            wallet.id,
          );

          if (syncedCount > 0) {
            totalSynced++;
            totalTrades += syncedCount;
            this.logger.debug(
              `✅ Synced ${syncedCount} trades for user ${wallet.user.id} (wallet: ${wallet.address.substring(0, 10)}...)`,
            );
          }
        } catch (error: any) {
          this.logger.warn(
            `⚠️ Failed to sync trades for wallet ${wallet.id}: ${error.message}`,
          );
        }
      }

      if (totalTrades > 0) {
        this.logger.log(
          `✅ Sentio trades sync complete: ${totalSynced} wallets synced, ${totalTrades} new trades added`,
        );
      } else {
        this.logger.debug('✅ Sentio trades sync complete: No new trades found');
      }
    } catch (error: any) {
      this.logger.error(`❌ Sentio trades sync failed: ${error.message}`, error.stack);
    }
  }
}
