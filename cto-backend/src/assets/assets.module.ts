import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  controllers: [AssetsController],
})
export class AssetsModule {}