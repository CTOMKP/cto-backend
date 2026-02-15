import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { XpService } from './xp.service';
import { XpController } from './xp.controller';

@Module({
  imports: [PrismaModule, NotificationsModule],
  providers: [XpService],
  controllers: [XpController],
  exports: [XpService],
})
export class XpModule {}
