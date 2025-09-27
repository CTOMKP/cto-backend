import { Module } from '@nestjs/common';
import { ImageController } from './image.controller';
import { ImageService } from './image.service';
import { RedisService } from './redis.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  controllers: [ImageController],
  providers: [ImageService, RedisService],
  exports: [ImageService, RedisService],
})
export class ImageModule {}
