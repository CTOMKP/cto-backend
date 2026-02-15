import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MovementWalletModule } from '../wallet/movement-wallet.module';
import { PaymentModule } from '../payment/payment.module';
import { EscrowService } from './escrow.service';
import { EscrowController } from './escrow.controller';

@Module({
  imports: [PrismaModule, NotificationsModule, MovementWalletModule, PaymentModule],
  providers: [EscrowService],
  controllers: [EscrowController],
  exports: [EscrowService],
})
export class EscrowModule {}
