import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PrivyPaymentController } from './privy-payment.controller';
import { PrivyPaymentService } from './privy-payment.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PaymentController, PrivyPaymentController],
  providers: [PaymentService, PrivyPaymentService],
  exports: [PaymentService, PrivyPaymentService],
})
export class PaymentModule {}

