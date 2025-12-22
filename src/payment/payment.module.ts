import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PrivyPaymentController } from './privy-payment.controller';
import { PrivyPaymentService } from './privy-payment.service';
import { MovementPaymentService } from './movement-payment.service';
import { MovementPaymentController } from './movement-payment.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { MovementWalletModule } from '../wallet/movement-wallet.module';

@Module({
  imports: [PrismaModule, MovementWalletModule],
  controllers: [PaymentController, PrivyPaymentController, MovementPaymentController],
  providers: [PaymentService, PrivyPaymentService, MovementPaymentService],
  exports: [PaymentService, PrivyPaymentService, MovementPaymentService],
})
export class PaymentModule {}

