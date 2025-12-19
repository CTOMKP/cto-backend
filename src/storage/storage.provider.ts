// cto-backend/src/storage/storage.provider.ts

export interface StorageProvider {
  // Generate presigned PUT URL for uploading a private object
  getPresignedPutUrl(key: string, mimeType: string, ttlSeconds?: number): Promise<string>;

  // Generate presigned GET URL for reading a private object
  getPresignedGetUrl(key: string, ttlSeconds?: number): Promise<string>;

  // Public URL for static assets (no signature required)
  getPublicAssetUrl(assetKey: string): string;

  // Optional: delete object
  deleteFile?(key: string): Promise<void>;

  // Optional: check if file exists
  fileExists?(key: string): Promise<boolean>;

  // Optional: get object stream for proxying
  getObjectStream?(key: string): Promise<{ Body: any; ContentType?: string; ContentLength?: number }>;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');