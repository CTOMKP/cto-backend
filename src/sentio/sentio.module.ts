import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SentioService } from './sentio.service';
import { SentioController } from './sentio.controller';

@Module({
  imports: [HttpModule],
  controllers: [SentioController],
  providers: [SentioService],
  exports: [SentioService],
})
export class SentioModule {}
