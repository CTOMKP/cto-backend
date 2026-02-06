import { Module } from '@nestjs/common';
import { MovementPaymentService } from './movement-payment.service';
import { MovementPaymentController } from './movement-payment.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { MovementWalletModule } from '../wallet/movement-wallet.module';

@Module({
  imports: [PrismaModule, MovementWalletModule],
  controllers: [MovementPaymentController],
  providers: [MovementPaymentService],
  exports: [MovementPaymentService],
})
export class PaymentModule {}

