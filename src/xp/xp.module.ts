import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { XpService } from './xp.service';
import { XpController } from './xp.controller';
import { XpCronService } from './xp-cron.service';

@Module({
  imports: [PrismaModule, NotificationsModule],
  providers: [XpService, XpCronService],
  controllers: [XpController],
  exports: [XpService],
})
export class XpModule {}
