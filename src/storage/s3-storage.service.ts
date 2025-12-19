// cto-backend/src/storage/s3-storage.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, DeleteObjectCommand, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageProvider } from './storage.provider';

@Injectable()
export class S3StorageService implements StorageProvider {
  private readonly logger = new Logger(S3StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly region: string;
  private readonly assetsCdnBase?: string; // optional CDN/public base

  constructor(private readonly config: ConfigService) {
    this.region = this.config.get<string>('AWS_REGION', 'eu-north-1');
    this.bucket = this.config.get<string>('AWS_S3_BUCKET_NAME', '');
    const accessKeyId = this.config.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('AWS_SECRET_ACCESS_KEY');
    this.assetsCdnBase = this.config.get<string>('ASSETS_CDN_BASE'); // optional

    if (!this.bucket || !accessKeyId || !secretAccessKey) {
      throw new Error('S3 not configured. Set AWS_S3_BUCKET_NAME, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.');
    }

    this.s3 = new S3Client({
      region: this.region,
      credentials: { accessKeyId, secretAccessKey },
      // Disable auto checksum headers on presigned PUTs so browsers don't need to send x-amz-checksum-*
      requestChecksumCalculation: 'NEVER' as any,
    } as any);
  }

  async getPresignedPutUrl(key: string, mimeType: string, ttlSeconds = 900): Promise<string> {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
    });
    const url = await getSignedUrl(this.s3, cmd, { expiresIn: ttlSeconds });
    
    // Log which AWS credentials are being used (first few chars of access key)
    const accessKeyId = this.config.get<string>('AWS_ACCESS_KEY_ID', '');
    const accessKeyPreview = accessKeyId ? `${accessKeyId.substring(0, 8)}...` : 'NOT SET';
    
    this.logger.log(`Presigned PUT: ${key} → Bucket: ${this.bucket} (ttl=${ttlSeconds}s)`);
    this.logger.log(`Using AWS Access Key: ${accessKeyPreview}`);
    this.logger.log(`Presigned URL bucket check: ${url.includes(this.bucket) ? 'CORRECT' : 'MISMATCH'}`);
    
    return url;
  }

  async getPresignedGetUrl(key: string, ttlSeconds = 900): Promise<string> {
    try {
      this.logger.log(`[S3Storage] Generating presigned GET URL for key: ${key}, bucket: ${this.bucket}, region: ${this.region}`);
      const cmd = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const url = await getSignedUrl(this.s3, cmd, { expiresIn: ttlSeconds });
      this.logger.log(`[S3Storage] ✅ Presigned GET URL generated successfully for: ${key} (ttl=${ttlSeconds}s)`);
      return url;
    } catch (error: any) {
      this.logger.error(`[S3Storage] ❌ Failed to generate presigned GET URL:`, {
        key,
        bucket: this.bucket,
        region: this.region,
        errorMessage: error?.message || error,
        errorName: error?.name,
        errorCode: error?.code,
        errorStack: error?.stack,
      });
      throw error;
    }
  }

  async getPresignedDownloadUrl(key: string, filename: string, ttlSeconds = 900): Promise<string> {
    // Sanitize filename: remove or replace invalid characters (keep spaces)
    const sanitizedFilename = filename
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') // Replace invalid filename characters
      .substring(0, 255); // Limit length
    
    // Encode filename for Content-Disposition header (RFC 5987)
    // AWS S3 supports both filename and filename* formats
    const encodedFilename = encodeURIComponent(sanitizedFilename);
    const contentDisposition = `attachment; filename="${sanitizedFilename}"; filename*=UTF-8''${encodedFilename}`;
    
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: contentDisposition,
    });
    const url = await getSignedUrl(this.s3, cmd, { expiresIn: ttlSeconds });
    this.logger.debug(`Presigned DOWNLOAD: ${key} -> ${sanitizedFilename} (ttl=${ttlSeconds}s)`);
    return url;
  }

  getPublicAssetUrl(assetKey: string): string {
    // For user uploads, keep the original key structure
    const fullKey = assetKey.startsWith('user-uploads/') 
      ? assetKey 
      : (assetKey.startsWith('assets/') ? assetKey : `assets/${assetKey}`);
      
    if (this.assetsCdnBase) {
      return `${this.assetsCdnBase.replace(/\/+$/, '')}/${encodeURI(fullKey)}`;
    }
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${encodeURI(fullKey)}`;
  }

  async deleteFile(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    this.logger.log(`Deleted S3 object: ${key}`);
  }

  async fileExists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      // Re-throw other errors (permissions, network, etc.)
      throw error;
    }
  }

  async getObjectStream(key: string): Promise<{ Body: any; ContentType?: string; ContentLength?: number }> {
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const response = await this.s3.send(cmd);
    return {
      Body: response.Body,
      ContentType: response.ContentType,
      ContentLength: response.ContentLength,
    };
  }
}