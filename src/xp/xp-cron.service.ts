import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { XpService } from './xp.service';

@Injectable()
export class XpCronService {
  private readonly logger = new Logger(XpCronService.name);

  constructor(private readonly xpService: XpService) {}

  @Cron('0 10 0 * * *', { name: 'xp-account-age-milestones' })
  async processAccountAgeMilestones() {
    try {
      const processed = await this.xpService.processAccountAgeMilestones();
      if (processed > 0) {
        this.logger.log(`Awarded ${processed} account-age rank milestone reward(s).`);
      }
    } catch (error: any) {
      this.logger.error(`Account-age milestone cron failed: ${error?.message || 'Unknown error'}`);
    }
  }
}
