import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EscrowService } from './escrow.service';

@Injectable()
export class EscrowCronService {
  private readonly logger = new Logger(EscrowCronService.name);

  constructor(private readonly escrowService: EscrowService) {}

  // Check every minute for elapsed escrow deadlines.
  @Cron('0 * * * * *', { name: 'escrow-deadline-review' })
  async processDeadlineReviews() {
    try {
      const processed = await this.escrowService.processExpiredEscrows();
      if (processed > 0) {
        this.logger.log(`Processed ${processed} escrow deadline review transition(s).`);
      }
    } catch (error: any) {
      this.logger.error(`Escrow deadline cron failed: ${error?.message || 'Unknown error'}`);
    }
  }
}

