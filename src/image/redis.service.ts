import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClientType;
  private isConnected = false;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  private async connect(): Promise<void> {
    try {
      const host = this.configService.get<string>('CONTABO_HOST');
      const port = this.configService.get<number>('REDIS_PORT', 6379);
      const password = this.configService.get<string>('REDIS_PASSWORD');
      const db = this.configService.get<number>('REDIS_DB', 0);

      this.client = createClient({
        socket: {
          host,
          port,
          connectTimeout: 10000,
        },
        password: password || undefined,
        database: db,
      });

      this.client.on('error', (err) => {
        this.logger.error('Redis Client Error:', err);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        this.logger.log('🔗 Redis connected successfully');
        this.isConnected = true;
      });

      this.client.on('disconnect', () => {
        this.logger.warn('🔌 Redis disconnected');
        this.isConnected = false;
      });

      await this.client.connect();
    } catch (error) {
      this.logger.error('Failed to connect to Redis:', error);
      this.isConnected = false;
    }
  }

  private async disconnect(): Promise<void> {
    if (this.client && this.isConnected) {
      await this.client.quit();
      this.isConnected = false;
    }
  }

  async isRedisAvailable(): Promise<boolean> {
    try {
      if (!this.client || !this.isConnected) {
        return false;
      }
      await this.client.ping();
      return true;
    } catch (error) {
      this.logger.warn('Redis health check failed:', error.message);
      return false;
    }
  }

  // Cache Operations
  async get<T>(key: string): Promise<T | null> {
    try {
      if (!await this.isRedisAvailable()) {
        return null;
      }
      
      const value = await this.client.get(key);
      return value ? JSON.parse(value as string) : null;
    } catch (error) {
      this.logger.warn(`Failed to get key ${key}:`, error.message);
      return null;
    }
  }

  async set(key: string, value: any, ttlSeconds?: number): Promise<boolean> {
    try {
      if (!await this.isRedisAvailable()) {
        return false;
      }

      const serialized = JSON.stringify(value);
      
      if (ttlSeconds) {
        await this.client.setEx(key, ttlSeconds, serialized);
      } else {
        await this.client.set(key, serialized);
      }
      
      return true;
    } catch (error) {
      this.logger.warn(`Failed to set key ${key}:`, error.message);
      return false;
    }
  }

  async del(key: string): Promise<boolean> {
    try {
      if (!await this.isRedisAvailable()) {
        return false;
      }

      await this.client.del(key);
      return true;
    } catch (error) {
      this.logger.warn(`Failed to delete key ${key}:`, error.message);
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      if (!await this.isRedisAvailable()) {
        return false;
      }

      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.warn(`Failed to check existence of key ${key}:`, error.message);
      return false;
    }
  }

  async keys(pattern: string): Promise<string[]> {
    try {
      if (!await this.isRedisAvailable()) {
        return [];
      }

      return await this.client.keys(pattern);
    } catch (error) {
      this.logger.warn(`Failed to get keys with pattern ${pattern}:`, error.message);
      return [];
    }
  }

  async flushAll(): Promise<boolean> {
    try {
      if (!await this.isRedisAvailable()) {
        return false;
      }

      await this.client.flushAll();
      return true;
    } catch (error) {
      this.logger.warn('Failed to flush Redis cache:', error.message);
      return false;
    }
  }

  // Image-specific cache operations
  async getImageMetadata(imageId: string): Promise<any> {
    return this.get(`image:metadata:${imageId}`);
  }

  async setImageMetadata(imageId: string, metadata: any, ttlSeconds?: number): Promise<boolean> {
    return this.set(`image:metadata:${imageId}`, metadata, ttlSeconds);
  }

  async getImageFile(imageId: string): Promise<Buffer | null> {
    try {
      if (!await this.isRedisAvailable()) {
        return null;
      }

      const data = await this.client.get(`image:file:${imageId}`);
      return data ? Buffer.from(data as string, 'base64') : null;
    } catch (error) {
      this.logger.warn(`Failed to get image file ${imageId}:`, error.message);
      return null;
    }
  }

  async setImageFile(imageId: string, buffer: Buffer, ttlSeconds?: number): Promise<boolean> {
    try {
      if (!await this.isRedisAvailable()) {
        return false;
      }

      const base64Data = buffer.toString('base64');
      if (ttlSeconds) {
        await this.client.setEx(`image:file:${imageId}`, ttlSeconds, base64Data);
      } else {
        await this.client.set(`image:file:${imageId}`, base64Data);
      }
      
      return true;
    } catch (error) {
      this.logger.warn(`Failed to set image file ${imageId}:`, error.message);
      return false;
    }
  }

  async getFileList(): Promise<string[]> {
    return this.get('image:filelist') || [];
  }

  async setFileList(fileList: string[], ttlSeconds?: number): Promise<boolean> {
    return this.set('image:filelist', fileList, ttlSeconds);
  }

  async clearImageCache(): Promise<boolean> {
    try {
      if (!await this.isRedisAvailable()) {
        return false;
      }

      const keys = await this.keys('image:*');
      if (keys.length > 0) {
        await this.client.del(keys);
      }
      return true;
    } catch (error) {
      this.logger.warn('Failed to clear image cache:', error.message);
      return false;
    }
  }
}