import { Module } from '@nestjs/common';
import { ImageController } from './image.controller';
import { ImageService } from './image.service';
import { RedisService } from './redis.service';
import { ConfigModule } from '@nestjs/config';
import { S3StorageService } from '../storage/s3-storage.service';
import { STORAGE_PROVIDER } from '../storage/storage.provider';

@Module({
  imports: [ConfigModule],
  controllers: [ImageController],
  providers: [
    ImageService, 
    RedisService,
    {
      provide: STORAGE_PROVIDER,
      useClass: S3StorageService,
    },
  ],
  exports: [ImageService, RedisService],
})
export class ImageModule {}
