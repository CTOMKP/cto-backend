// Storage provider interface for abstraction
export const STORAGE_PROVIDER = 'STORAGE_PROVIDER';

export interface StorageProvider {
  /**
   * Generate a presigned PUT URL for direct-to-S3 uploads
   */
  getPresignedPutUrl(key: string, mimeType: string, ttlSeconds?: number): Promise<string>;

  /**
   * Generate a presigned GET URL for reading objects
   */
  getPresignedGetUrl(key: string, ttlSeconds?: number): Promise<string>;

  /**
   * Get a public asset URL (for CDN or direct S3 access)
   */
  getPublicAssetUrl(assetKey: string): string;

  /**
   * Delete a file from storage
   */
  deleteFile(key: string): Promise<void>;
}

