import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentModule } from '../payment/payment.module';
import { XpModule } from '../xp/xp.module';
import { EmailModule } from '../email/email.module';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { MarketplacePricingService } from './marketplace-pricing.service';
import { MarketplaceCronService } from './marketplace-cron.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminGuard } from '../auth/guards/admin.guard';

@Module({
  imports: [PrismaModule, PaymentModule, XpModule, EmailModule, NotificationsModule],
  controllers: [MarketplaceController],
  providers: [MarketplaceService, MarketplacePricingService, MarketplaceCronService, AdminGuard],
  exports: [MarketplaceService, MarketplacePricingService],
})
export class MarketplaceModule {}
