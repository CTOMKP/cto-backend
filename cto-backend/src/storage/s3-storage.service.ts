// cto-backend/src/storage/s3-storage.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, DeleteObjectCommand, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
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
      // @ts-expect-error: property exists in newer AWS SDKs; casting below keeps TS happy on older versions.
      requestChecksumCalculation: 'NEVER',
    } as any);
  }

  async getPresignedPutUrl(key: string, mimeType: string, ttlSeconds = 900): Promise<string> {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
    });
    const url = await getSignedUrl(this.s3, cmd, { expiresIn: ttlSeconds });
    this.logger.debug(`Presigned PUT: ${key} (ttl=${ttlSeconds}s)`);
    return url;
  }

  async getPresignedGetUrl(key: string, ttlSeconds = 900): Promise<string> {
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const url = await getSignedUrl(this.s3, cmd, { expiresIn: ttlSeconds });
    this.logger.debug(`Presigned GET: ${key} (ttl=${ttlSeconds}s)`);
    return url;
  }

  getPublicAssetUrl(assetKey: string): string {
    const fullKey = assetKey.startsWith('assets/') ? assetKey : `assets/${assetKey}`;
    if (this.assetsCdnBase) {
      return `${this.assetsCdnBase.replace(/\/+$/, '')}/${encodeURI(fullKey)}`;
    }
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${encodeURI(fullKey)}`;
  }

  async deleteFile(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    this.logger.log(`Deleted S3 object: ${key}`);
  }
}