import { Module } from '@nestjs/common';
import { MovementPaymentService } from './movement-payment.service';
import { MovementPaymentController } from './movement-payment.controller';
import { SolanaPaymentService } from './solana-payment.service';
import { SolanaPaymentController } from './solana-payment.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { MovementWalletModule } from '../wallet/movement-wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmailModule } from '../email/email.module';
import { CreatorProgramModule } from '../creator-program/creator-program.module';
import { SolanaNetworkModule } from '../solana/solana-network.module';

@Module({
  imports: [PrismaModule, MovementWalletModule, NotificationsModule, EmailModule, CreatorProgramModule, SolanaNetworkModule],
  controllers: [MovementPaymentController, SolanaPaymentController],
  providers: [MovementPaymentService, SolanaPaymentService],
  exports: [MovementPaymentService, SolanaPaymentService],
})
export class PaymentModule {}

