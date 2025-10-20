import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { CircleController } from './circle.controller';
import { CircleService } from './circle.service';
import { TransferController } from './transfer.controller';
import { TransferService } from './transfer.service';
import { FundingController } from './funding.controller';
import { FundingService } from './funding.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ConfigModule, PrismaModule, HttpModule, AuthModule],
  controllers: [CircleController, TransferController, FundingController],
  providers: [CircleService, TransferService, FundingService],
  exports: [CircleService, TransferService, FundingService],
})
export class CircleModule {}