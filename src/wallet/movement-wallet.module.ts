import { Module } from '@nestjs/common';
import { MovementWalletService } from './movement-wallet.service';
import { MovementWalletController } from './movement-wallet.controller';
import { MovementWalletCronService } from './movement-wallet-cron.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { XpModule } from '../xp/xp.module';

@Module({
  imports: [PrismaModule, NotificationsModule, XpModule],
  controllers: [MovementWalletController],
  providers: [MovementWalletService, MovementWalletCronService],
  exports: [MovementWalletService],
})
export class MovementWalletModule {}







