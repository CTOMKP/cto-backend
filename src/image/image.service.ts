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
  private readonly defaultGetTtl = 86400; // 24 hours instead of 15 minutes

  // Metadata cache only (no file buffers)
  private static readonly metadataCache = new Map<string, ImageMetadata>();

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  // ---------- Key building helpers ----------
  private sanitize(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  private extOr(defaultExt: string, from: string): string {
    const ext = path.extname(from || '').toLowerCase();
    return ext || defaultExt;
  }

  private buildKey(kind: UploadKind, params: { userId?: string; filename: string }) {
    const file = this.sanitize(params.filename);
    const userId = params.userId;
    if (!userId) throw new HttpException('userId required', HttpStatus.BAD_REQUEST);

    // Determine default extension by type if missing on original filename
    const defaultExt = kind === 'profile' ? '.png' : '.jpg';
    const ensuredExt = this.extOr(defaultExt, file); // returns existing ext or default
    const baseName = path.basename(file, path.extname(file));
    const timestamped = `${Date.now()}_${baseName}${ensuredExt}`;

    const typeSegment = kind; // 'generic' | 'profile' | 'banner' | 'meme'
    return `user-uploads/${userId}/${typeSegment}/${timestamped}`;
  }

  private guessMime(ext: string): string {
    const e = (ext || '').toLowerCase();
    if (e === '.png') return 'image/png';
    if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
    if (e === '.webp') return 'image/webp';
    if (e === '.gif') return 'image/gif';
    if (e === '.bmp') return 'image/bmp';
    if (e === '.svg') return 'image/svg+xml';
    return 'application/octet-stream';
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
  
  // Get a public URL for user uploads (uses ASSETS_CDN_BASE if available)
  getPublicAssetUrl(key: string): string {
    return this.storage.getPublicAssetUrl(key);
  }

  async getImage(key: string): Promise<ImageMetadata> {
    // memory cache
    const m = ImageService.metadataCache.get(key);
    if (m) return m;

    // redis cache
    const r = await this.redis.getImageMetadata(key);
    if (r) {
      ImageService.metadataCache.set(key, r);
      return r;
    }

    // fallback minimal metadata (unknown size)
    const url = await this.storage.getPresignedGetUrl(key, this.defaultGetTtl);
    const ext = path.extname(key);
    const mime = this.guessMime(ext);
    const meta: ImageMetadata = {
      id: key,
      filename: path.basename(key),
      originalName: key,
      size: 0,
      mimeType: mime,
      uploadDate: new Date(),
      path: key,
      url,
      storageProvider: 's3',
      storageKey: key,
    };
    ImageService.metadataCache.set(key, meta);
    await this.redis.setImageMetadata(key, meta).catch(() => {});
    return meta;
  }

  async getPresignedDownloadUrl(key: string, filename: string, ttlSeconds = this.defaultGetTtl): Promise<string> {
    if (this.storage.getPresignedDownloadUrl) {
      return this.storage.getPresignedDownloadUrl(key, filename, ttlSeconds);
    }
    // Fallback to regular GET URL
    return this.storage.getPresignedGetUrl(key, ttlSeconds);
  }

  async deleteImage(key: string): Promise<boolean> {
    try {
      await this.storage.deleteFile?.(key);
      ImageService.metadataCache.delete(key);
      await this.redis.del(`image:metadata:${key}`).catch(() => {});
      await this.redis.del(`image:buffer:${key}`).catch(() => {});

      // update list
      try {
        const list = (await this.redis.getFileList()) || [];
        const filtered = list.filter(i => i.id !== key);
        await this.redis.setFileList(filtered);
      } catch {}

      return true;
    } catch (e) {
      this.logger.error('Failed to delete image', e as any);
      throw new HttpException('Failed to delete image', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async listImages(): Promise<ImageMetadata[]> {
    const m = Array.from(ImageService.metadataCache.values());
    if (m.length) return m;
    return (await this.redis.getFileList()) || [];
  }

  async editImageMetadata(imageId: string, editData: EditImageData): Promise<ImageMetadata> {
    const current = ImageService.metadataCache.get(imageId) || await this.redis.getImageMetadata(imageId);
    if (!current) throw new HttpException('Image not found', HttpStatus.NOT_FOUND);

    const updated: ImageMetadata = { ...current, ...editData } as ImageMetadata;

    // Note: We do NOT rename S3 object here to avoid complexity; future provider can implement rename.
    ImageService.metadataCache.set(imageId, updated);
    await this.redis.setImageMetadata(imageId, updated).catch(() => {});

    // refresh list
    try {
      const list = (await this.redis.getFileList()) || [];
      const others = list.filter(i => i.id !== imageId);
      await this.redis.setFileList([updated, ...others]);
    } catch {}

    return updated;
  }
}