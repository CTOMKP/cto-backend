import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MarketplaceService } from './marketplace.service';

@Injectable()
export class MarketplaceCronService {
  private readonly logger = new Logger(MarketplaceCronService.name);

  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Cron('0 2 * * *', { name: 'marketplace-expiry' })
  async handleExpiry() {
    this.logger.log('Running marketplace expiry checks');
    await this.marketplaceService.flagExpiryNotice();
    await this.marketplaceService.expireAds();
  }
}
