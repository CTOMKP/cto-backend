import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MovementWalletModule } from '../wallet/movement-wallet.module';
import { PaymentModule } from '../payment/payment.module';
import { XpModule } from '../xp/xp.module';
import { CreatorProgramModule } from '../creator-program/creator-program.module';
import { EscrowService } from './escrow.service';
import { EscrowController } from './escrow.controller';
import { EscrowCronService } from './escrow-cron.service';

@Module({
  imports: [PrismaModule, NotificationsModule, MovementWalletModule, PaymentModule, XpModule, CreatorProgramModule],
  providers: [EscrowService, EscrowCronService],
  controllers: [EscrowController],
  exports: [EscrowService],
})
export class EscrowModule {}
