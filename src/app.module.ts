import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScanModule } from './scan/scan.module';
import { ImageModule } from './image/image.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScanModule,
    ImageModule,
    AuthModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
