import { Module } from '@nestjs/common';
import { DuneService } from './dune.service';
import { DuneController } from './dune.controller';

@Module({
  controllers: [DuneController],
  providers: [DuneService],
  exports: [DuneService],
})
export class DuneModule {}

