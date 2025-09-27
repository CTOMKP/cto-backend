import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';
import { ImageMetadata } from './types';

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
      const url = this.configService.get<string>('REDIS_URL');
      const host = this.configService.get<string>('REDIS_HOST', 'localhost');
      const port = this.configService.get<number>('REDIS_PORT', 6379);
      const password = this.configService.get<string>('REDIS_PASSWORD');
      const db = this.configService.get<number>('REDIS_DB', 0);

      const dev = process.env.NODE_ENV !== 'production';
      const connectTimeout = dev ? 2000 : 5000;

      if (url) {
        this.client = createClient({ url, socket: { connectTimeout, keepAlive: true, noDelay: true } });
      } else {
        this.client = createClient({
          socket: { host, port, connectTimeout, keepAlive: true, noDelay: true },
          password: password || undefined,
          database: db,
          commandsQueueMaxLength: 1000,
        });
      }

      this.client.on('error', (err) => {
        this.logger.error('Redis Client Error:', err);
        this.isConnected = false;
      });

      this.client.on('ready', () => {
        this.logger.log('🔗 Redis connected successfully');
        this.isConnected = true;
      });

      this.client.on('end', () => {
        this.logger.warn('🔌 Redis disconnected');
        this.isConnected = false;
      });

      // Do not block app startup indefinitely in dev
      await Promise.race([
        this.client.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Redis connect timeout')), connectTimeout + 200)),
      ]);
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn('Skipping Redis connection during dev startup:', (error as Error).message);
      } else {
        this.logger.error('Failed to connect to Redis:', error);
      }
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

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<boolean> {
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
  async getImageMetadata(imageId: string): Promise<ImageMetadata | null> {
    return this.get<ImageMetadata>(`image:metadata:${imageId}`);
  }

  async setImageMetadata(imageId: string, metadata: ImageMetadata, ttlSeconds?: number): Promise<boolean> {
    return this.set(`image:metadata:${imageId}`, metadata, ttlSeconds);
  }


  async getFileList(): Promise<ImageMetadata[]> {
    const result = await this.get<ImageMetadata[]>('image:filelist');
    return result || [];
  }

  async setFileList(fileList: ImageMetadata[], ttlSeconds?: number): Promise<boolean> {
    return this.set('image:filelist', fileList, ttlSeconds);
  }

  // Image file buffer caching
  async getImageFileBuffer(imageId: string): Promise<Buffer | null> {
    try {
      if (!await this.isRedisAvailable()) {
        this.logger.warn(`Redis not available for image buffer ${imageId}`);
        return null;
      }
      
      const key = `image:buffer:${imageId}`;
      const value = await this.client.get(key);
      if (value) {
        try {
          const stringValue = String(value);
          const buffer = Buffer.from(stringValue, 'base64');
          this.logger.debug(`Retrieved image buffer from Redis: ${imageId} (${(buffer.length / 1024).toFixed(1)}KB)`);
          return buffer;
        } catch (bufferError) {
          this.logger.warn(`Failed to create buffer from value for ${imageId}:`, bufferError);
          return null;
        }
      } else {
        this.logger.debug(`No cached buffer found for image: ${imageId}`);
      }
      return null;
    } catch (error) {
      this.logger.warn(`Failed to get image buffer ${imageId}:`, error.message);
      return null;
    }
  }

  async setImageFileBuffer(imageId: string, buffer: Buffer, ttlSeconds?: number): Promise<boolean> {
    try {
      if (!await this.isRedisAvailable()) {
        this.logger.warn(`Redis not available for setting image buffer ${imageId}`);
        return false;
      }

      const key = `image:buffer:${imageId}`;
      const base64Buffer = buffer.toString('base64');
      
      if (ttlSeconds) {
        await this.client.setEx(key, ttlSeconds, base64Buffer);
      } else {
        // Default TTL of 24 hours for image buffers
        await this.client.setEx(key, 24 * 60 * 60, base64Buffer);
      }
      
      this.logger.debug(`Cached image buffer in Redis: ${imageId} (${(buffer.length / 1024).toFixed(1)}KB)`);
      return true;
    } catch (error) {
      this.logger.warn(`Failed to set image buffer ${imageId}:`, error.message);
      return false;
    }
  }

  async clearImageCache(): Promise<boolean> {
    try {
      if (!await this.isRedisAvailable()) {
        return false;
      }

      // Only clear metadata and file list, not file content
      const keys = await this.keys('image:metadata:*');
      const fileListKeys = await this.keys('image:filelist');
      const allKeys = [...keys, ...fileListKeys];
      
      if (allKeys.length > 0) {
        await this.client.del(allKeys);
      }
      return true;
    } catch (error) {
      this.logger.warn('Failed to clear image cache:', error.message);
      return false;
    }
  }
}