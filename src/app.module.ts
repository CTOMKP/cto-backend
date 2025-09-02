import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScanModule } from './scan/scan.module';
import { ImageModule } from './image/image.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScanModule,
    ImageModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
