import { Injectable, Logger, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { RedisService } from './redis.service';
import { ImageMetadata, EditImageData } from './types';
import { STORAGE_PROVIDER, StorageProvider } from '../storage/storage.provider';

// Upload categories supported by key builder
export type UploadKind = 'generic' | 'profile' | 'banner' | 'meme';

@Injectable()
export class ImageService {
  private readonly logger = new Logger(ImageService.name);
  private readonly defaultGetTtl = 3600; // 1 hour for GET URLs
  private readonly baseUrl: string;

  // In-memory cache for metadata
  private static readonly metadataCache = new Map<string, ImageMetadata>();

  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {
    this.baseUrl = this.config.get('BACKEND_BASE_URL') || 'http://localhost:3001';
  }

  private buildKey(kind: UploadKind, opts: { userId?: string; filename: string }): string {
    const timestamp = Date.now();
    const ext = path.extname(opts.filename) || '.jpg';
    const basename = path.basename(opts.filename, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeFilename = `${basename}_${timestamp}${ext}`;
    
    // Build key based on upload kind
    if (kind === 'meme') {
      // Memes go to memes folder
      return `memes/${safeFilename}`;
    } else if (kind === 'profile' || kind === 'banner') {
      // User profile/banner images
      const userId = opts.userId || 'anonymous';
      return `user-uploads/${userId}/${kind}/${safeFilename}`;
    } else {
      // Generic uploads
      const userId = opts.userId || 'anonymous';
      return `user-uploads/${userId}/generic/${safeFilename}`;
    }
  }

  private guessMime(ext: string): string {
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml',
    };

    return mimeMap[ext.toLowerCase()] || 'application/octet-stream';
  }

  // ---------- Core operations (presigned flow) ----------

  async createPresignedUpload(kind: UploadKind, args: {
    userId?: string;
    filename: string;
    mimeType: string;
    putTtlSeconds?: number;
    getTtlSeconds?: number;
  }): Promise<{ key: string; uploadUrl: string; viewUrl: string; metadata: ImageMetadata }>
  {
    const key = this.buildKey(kind, { userId: args.userId, filename: args.filename });
    const uploadUrl = await this.storage.getPresignedPutUrl(key, args.mimeType, args.putTtlSeconds ?? 900);
    const viewUrl = await this.storage.getPresignedGetUrl(key, args.getTtlSeconds ?? this.defaultGetTtl);

    const metadata: ImageMetadata = {
      id: key, // using S3 key as id for simplicity
      filename: args.filename,
      originalName: key,
      size: 0,
      mimeType: args.mimeType,
      uploadDate: new Date(),
      path: key,
      url: viewUrl,
      storageProvider: 's3',
      storageKey: key,
      userId: args.userId,
    };

    // Cache metadata only (no file buffers)
    ImageService.metadataCache.set(key, metadata);
    await this.redis.setImageMetadata(key, metadata).catch(() => {});

    // Update file list cache (optional best-effort)
    try {
      const list = (await this.redis.getFileList()) || [];
      const without = list.filter(i => i.id !== key);
      await this.redis.setFileList([metadata, ...without].slice(0, 1000));
    } catch {}

    return { key, uploadUrl, viewUrl, metadata };
  }

  async getPresignedViewUrl(key: string, ttlSeconds = this.defaultGetTtl): Promise<string> {
    return this.storage.getPresignedGetUrl(key, ttlSeconds);
  }

  async getImage(imageId: string): Promise<ImageMetadata> {
    // Check in-memory cache first
    if (ImageService.metadataCache.has(imageId)) {
      this.logger.debug(`Metadata found in cache for: ${imageId}`);
      return ImageService.metadataCache.get(imageId)!;
    }

    // Check Redis cache
    const cachedMetadata = await this.redis.getImageMetadata(imageId);
    if (cachedMetadata) {
      this.logger.debug(`Metadata found in Redis for: ${imageId}`);
      ImageService.metadataCache.set(imageId, cachedMetadata);
      return cachedMetadata;
    }

    throw new HttpException('Image not found', HttpStatus.NOT_FOUND);
  }

  async listImages(): Promise<ImageMetadata[]> {
    try {
      // Always use memory cache first (most up-to-date)
      if (ImageService.metadataCache.size > 0) {
        const allImages = Array.from(ImageService.metadataCache.values());
        this.logger.log(`Returning ${allImages.length} images from memory cache`);
        return allImages;
      }

      // If memory cache is empty, try Redis
      const redisImages: ImageMetadata[] = await this.redis.getFileList();
      if (redisImages && redisImages.length > 0) {
        this.logger.log(`Returning ${redisImages.length} images from Redis`);
        
        // Populate memory cache with Redis data
        redisImages.forEach(image => {
          ImageService.metadataCache.set(image.id, image);
        });
        
        return redisImages;
      }

      // Return empty array if no images
      return [];
    } catch (error) {
      this.logger.error('Failed to list images:', error);
      throw new HttpException('Failed to list images', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async deleteImage(imageId: string): Promise<boolean> {
    try {
      const metadata = ImageService.metadataCache.get(imageId) || await this.redis.getImageMetadata(imageId);
      if (!metadata) {
        throw new HttpException('Image not found', HttpStatus.NOT_FOUND);
      }

      // Delete file from S3
      await this.storage.deleteFile(metadata.storageKey || imageId);

      // Remove from caches
      ImageService.metadataCache.delete(imageId);
      
      // Remove specific image from Redis
      await this.redis.del(`image:metadata:${imageId}`);
      
      // Update file list in Redis to remove the deleted image
      await this.updateFileListInRedis();

      this.logger.log(`Deleted: ${metadata.originalName}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to delete image:', error);
      throw new HttpException('Failed to delete image', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async editImageMetadata(imageId: string, editData: EditImageData): Promise<ImageMetadata> {
    try {
      const currentMetadata = ImageService.metadataCache.get(imageId) || await this.redis.getImageMetadata(imageId);
      if (!currentMetadata) {
        throw new HttpException('Image not found', HttpStatus.NOT_FOUND);
      }

      const updatedMetadata: ImageMetadata = {
        ...currentMetadata,
        ...editData,
      };

      // Update caches
      ImageService.metadataCache.set(imageId, updatedMetadata);
      await this.redis.setImageMetadata(imageId, updatedMetadata);
      
      // Update the file list in Redis to include the edited image
      await this.updateFileListInRedis();

      this.logger.log(`Updated metadata for: ${imageId}`);
      return updatedMetadata;
    } catch (error) {
      this.logger.error('Failed to edit image metadata:', error);
      throw new HttpException('Failed to update image metadata', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Update file list in Redis with current memory cache
   */
  private async updateFileListInRedis(): Promise<void> {
    try {
      const allImages = Array.from(ImageService.metadataCache.values());
      await this.redis.setFileList(allImages);
      this.logger.debug(`Updated file list in Redis with ${allImages.length} images`);
    } catch (error) {
      this.logger.warn('Failed to update file list in Redis:', error);
    }
  }

  /**
   * Bulk import metadata for migrated images
   * This registers existing S3 images with the backend cache
   */
  async bulkImportMetadata(images: ImageMetadata[]): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;

    for (const imageData of images) {
      try {
        // Check if already exists
        if (ImageService.metadataCache.has(imageData.id)) {
          this.logger.debug(`Skipping existing image: ${imageData.id}`);
          skipped++;
          continue;
        }

        // Normalize the metadata
        const metadata: ImageMetadata = {
          ...imageData,
          uploadDate: new Date(imageData.uploadDate),
        };

        // Add to cache
        ImageService.metadataCache.set(metadata.id, metadata);
        
        // Add to Redis
        await this.redis.setImageMetadata(metadata.id, metadata).catch(() => {});
        
        imported++;
        this.logger.log(`Imported metadata for: ${metadata.id}`);
      } catch (error) {
        this.logger.error(`Failed to import ${imageData.id}:`, error);
        skipped++;
      }
    }

    // Update file list in Redis
    await this.updateFileListInRedis();

    this.logger.log(`Bulk import complete: ${imported} imported, ${skipped} skipped`);
    return { imported, skipped };
  }
}


