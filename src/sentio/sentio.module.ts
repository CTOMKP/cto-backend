import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from '../prisma/prisma.module';
import { SentioService } from './sentio.service';
import { SentioController } from './sentio.controller';
import { TradesModule } from '../trades/trades.module';

@Module({
  imports: [HttpModule, PrismaModule, TradesModule],
  controllers: [SentioController],
  providers: [SentioService],
  exports: [SentioService],
})
export class SentioModule {}
