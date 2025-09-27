import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScanModule } from './scan/scan.module';
import { ImageModule } from './image/image.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Load env in this order: .env.NODE_ENV.local → .env.NODE_ENV → .env.local → .env
      envFilePath: [
        `.env.${process.env.NODE_ENV}.local`,
        `.env.${process.env.NODE_ENV}`,
        '.env.local',
        '.env',
      ],
    }),
    PrismaModule,
    ScanModule,
    ImageModule,
    AuthModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
