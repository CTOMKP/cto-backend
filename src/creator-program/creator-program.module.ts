import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { XpModule } from '../xp/xp.module';
import { CreatorProgramService } from './creator-program.service';
import { CreatorProgramController } from './creator-program.controller';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    NotificationsModule,
    XpModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'your-secret-key',
        signOptions: { expiresIn: '24h' },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [CreatorProgramService],
  controllers: [CreatorProgramController],
  exports: [CreatorProgramService],
})
export class CreatorProgramModule {}
