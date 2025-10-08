import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ScanModule } from './scan/scan.module';
import { ImageModule } from './image/image.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { ListingModule } from './listing/listing.module';
import { CircleModule } from './circle/circle.module';
import { UserListingsModule } from './user-listings/user-listings.module';
import { MemeModule } from './meme/meme.module';
import { AssetsModule } from './assets/assets.module';

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
    ScanModule,
    ImageModule,
    AuthModule,
    ListingModule,
    CircleModule,
    UserListingsModule,
    MemeModule,
    AssetsModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
