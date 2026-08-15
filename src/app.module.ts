import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ScanModule } from './scan/scan.module';
import { ImageModule } from './image/image.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { ListingModule } from './listing/listing.module';
import { UserListingsModule } from './user-listings/user-listings.module';
import { MemeModule } from './meme/meme.module';
import { WaitlistModule } from './waitlist/waitlist.module';
import { AssetsModule } from './assets/assets.module';
import { DuneModule } from './dune/dune.module';
import { PaymentModule } from './payment/payment.module';
import { AdminModule } from './admin/admin.module';
import { StatsModule } from './stats/stats.module';
import { PfpModule } from './pfp/pfp.module';
import { TokenVettingModule } from './services/token-vetting.module';
import { MovementWalletModule } from './wallet/movement-wallet.module';
import { SolanaWalletModule } from './wallet/solana-wallet.module';
import { WalletSummaryModule } from './wallet/wallet-summary.module';
import { SentioModule } from './sentio/sentio.module';
import { TradesModule } from './trades/trades.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { NotificationsModule } from './notifications/notifications.module';
import { XpModule } from './xp/xp.module';
import { MessagingModule } from './messaging/messaging.module';
import { EscrowModule } from './escrow/escrow.module';
import { SupportTicketModule } from './support-ticket/support-ticket.module';
import { CreatorProgramModule } from './creator-program/creator-program.module';
import { SolanaNetworkModule } from './solana/solana-network.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        `.env.${process.env.NODE_ENV}.local`,
        `.env.${process.env.NODE_ENV}`,
        '.env.local',
        '.env',
      ],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    SolanaNetworkModule,
    ScanModule,
    ImageModule,
    AuthModule,
    ListingModule,
    UserListingsModule,
    MemeModule,
    WaitlistModule,
    AssetsModule,
    DuneModule,
    PaymentModule,
    AdminModule,
    StatsModule,
    PfpModule,
    TokenVettingModule,
    MovementWalletModule,
    SolanaWalletModule,
    WalletSummaryModule,
    SentioModule,
    TradesModule,
    MarketplaceModule,
    NotificationsModule,
    XpModule,
    MessagingModule,
    EscrowModule,
    SupportTicketModule,
    CreatorProgramModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
