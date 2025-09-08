import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as Client from 'ssh2-sftp-client';
import { v4 as uuidv4 } from 'uuid';
import { RedisService } from './redis.service';

export interface ImageMetadata {
  id: string;
  filename: string;
  originalName: string;
  size: number;
  mimeType: string;
  uploadDate: Date;
  path: string;
  url: string;
  description?: string;
  category?: string;
}

@Injectable()
export class ImageService {
  private readonly logger = new Logger(ImageService.name);
  private sftp: Client;
  private readonly remoteBasePath: string;
  private readonly baseUrl: string;

  // Performance optimizations - static to persist across requests
  private static metadataCache: Map<string, ImageMetadata> = new Map();
  private static fileListCache: { files: any[], timestamp: number } | null = null;
  private static readonly CACHE_TTL = 300000; // 5 minutes cache (production recommended)
  private static readonly KEEP_ALIVE_INTERVAL = 1800000; // 30 minutes keep-alive (reduced frequency)
  private static connectionPromise: Promise<void> | null = null;
  private static keepAliveInterval: NodeJS.Timeout | null = null;
  private static sftpInstance: Client | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService
  ) {
    this.remoteBasePath = this.configService.get('CONTABO_IMAGE_PATH') || '/var/www/html/images';
    this.baseUrl = this.configService.get('CONTABO_BASE_URL') || 'https://your-domain.com/images';
    
    // Configure cache intervals from environment variables
    this.configureCacheIntervals();
    
    // Set the static SFTP instance reference
    this.sftp = ImageService.sftpInstance;
    
    // Lightweight startup - only populate metadata cache (no file downloads)
    this.initializeMetadataCache().catch(error => {
      this.logger.warn('Failed to initialize metadata cache on startup:', error);
    });
  }

  /**
   * Configure cache intervals from environment variables
   */
  private configureCacheIntervals(): void {
    const cacheTtl = this.configService.get('IMAGE_CACHE_TTL');
    const keepAliveInterval = this.configService.get('IMAGE_KEEP_ALIVE_INTERVAL');
    
    if (cacheTtl) {
      (ImageService as any).CACHE_TTL = parseInt(cacheTtl) * 1000; // Convert to milliseconds
    }
    
    if (keepAliveInterval) {
      (ImageService as any).KEEP_ALIVE_INTERVAL = parseInt(keepAliveInterval) * 1000; // Convert to milliseconds
    }
  }

  /**
   * Initialize SFTP connection to Contabo VPS
   */
  private async connectSFTP(): Promise<void> {
    try {
      // Check if we're in a serverless environment or VPS is not configured
      const host = this.configService.get('CONTABO_HOST');
      const username = this.configService.get('CONTABO_USERNAME');
      const password = this.configService.get('CONTABO_PASSWORD');
      
      if (!host || !username || !password) {
        this.logger.warn('Contabo VPS not configured, skipping SFTP connection');
        throw new Error('VPS not configured');
      }

      // Clean up existing connection if it exists
      if (ImageService.sftpInstance) {
        try {
          if (typeof ImageService.sftpInstance.end === 'function') {
            await ImageService.sftpInstance.end();
          }
        } catch (cleanupError) {
          this.logger.warn('Error during SFTP cleanup:', cleanupError);
        }
        ImageService.sftpInstance = null;
      }

      // Try to create SFTP client, but handle import errors gracefully
      try {
        ImageService.sftpInstance = new Client();
      } catch (importError) {
        this.logger.error('Failed to import SFTP client:', importError);
        throw new Error('SFTP client not available in this environment');
      }
      
      const port = this.configService.get('CONTABO_PORT') || 22;
      
      await ImageService.sftpInstance.connect({
        host,
        port,
        username,
        password,
        // Ultra-fast connection options
        keepaliveInterval: 30000, // 30 seconds for faster recovery
        keepaliveCountMax: 5,
        readyTimeout: 10000, // 10 seconds timeout
        algorithms: {
          kex: ['diffie-hellman-group14-sha256', 'ecdh-sha2-nistp256'],
          cipher: ['aes128-ctr', 'aes192-ctr', 'aes256-ctr'],
          hmac: ['hmac-sha2-256', 'hmac-sha2-512'],
          compress: ['none'] // Disable compression for speed
        },
        // Alternative: use private key
        // privateKey: fs.readFileSync(this.configService.get('CONTABO_PRIVATE_KEY_PATH')),
      });

      this.logger.log('SFTP connection established to Contabo VPS');
      
      // Set the instance reference
      this.sftp = ImageService.sftpInstance;
      
      // Start keep-alive mechanism
      this.startKeepAlive();
    } catch (error) {
      this.logger.error('Failed to connect to Contabo VPS:', error);
      // Clean up failed connection
      if (ImageService.sftpInstance) {
        try {
          if (typeof ImageService.sftpInstance.end === 'function') {
            await ImageService.sftpInstance.end();
          }
        } catch (cleanupError) {
          this.logger.warn('Error during failed connection cleanup:', cleanupError);
        }
        ImageService.sftpInstance = null;
      }
      throw new HttpException('Failed to connect to image storage', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  /**
   * Check if VPS is configured (cached check)
   */
  private isVpsConfigured(): boolean {
      const host = this.configService.get('CONTABO_HOST');
      const username = this.configService.get('CONTABO_USERNAME');
      const password = this.configService.get('CONTABO_PASSWORD');
    return !!(host && username && password);
  }

  /**
   * Ensure SFTP connection is active with connection pooling
   */
  private async ensureConnection(): Promise<void> {
    try {
      // Quick check if VPS is configured
      if (!this.isVpsConfigured()) {
        throw new Error('VPS not configured');
      }

      // If there's already a connection in progress, wait for it
      if (ImageService.connectionPromise) {
        await ImageService.connectionPromise;
        return;
      }

      // Check if sftp exists and is connected
      if (this.isConnected()) {
        return; // Connection is good, no need to reconnect
      }

      // Create new connection
      ImageService.connectionPromise = this.connectSFTP();
      await ImageService.connectionPromise;
      ImageService.connectionPromise = null;
      } catch (error) {
      ImageService.connectionPromise = null;
      this.logger.error('Failed to ensure SFTP connection:', error);
      // Don't try to reconnect if VPS is not configured
      if (error.message === 'VPS not configured') {
        throw error;
      }
      // Force new connection for other errors
      ImageService.sftpInstance = null;
      throw error;
    }
  }

  /**
   * Quick connection check for operations (no credential re-checking)
   */
  private async ensureConnectionForOperation(): Promise<void> {
    // If already connected, return immediately
    if (this.isConnected()) {
      return;
    }

    // Only do full connection check if not connected
    await this.ensureConnection();
  }

  /**
   * Safe connection check
   */
  private isConnected(): boolean {
    try {
      return ImageService.sftpInstance && 
             typeof ImageService.sftpInstance.isConnected === 'function' && 
             ImageService.sftpInstance.isConnected();
    } catch (error) {
      return false;
    }
  }

  /**
   * Get cached file list or fetch from SFTP
   */
  private async getCachedFileList(): Promise<any[]> {
    // Try Redis first
    const redisFileList = await this.redisService.getFileList();
    if (redisFileList && redisFileList.length > 0) {
      return redisFileList;
    }

    // Fallback to in-memory cache
    const now = Date.now();
    if (ImageService.fileListCache && (now - ImageService.fileListCache.timestamp) < ImageService.CACHE_TTL) {
      return ImageService.fileListCache.files;
    }

    // Cache expired, try to fetch fresh data from VPS
    try {
      return await this.refreshFileListCache();
    } catch (sftpError) {
      this.logger.warn('SFTP file list refresh failed, using empty list:', sftpError.message);
      return [];
    }
  }

  /**
   * Refresh file list cache with fresh data from VPS
   */
  private async refreshFileListCache(): Promise<any[]> {
    await this.ensureConnection();
    const files = await ImageService.sftpInstance.list(this.remoteBasePath);
    
    // Update Redis cache
    await this.redisService.setFileList(files.map(f => f.name), ImageService.CACHE_TTL / 1000);
    
    // Update in-memory cache as fallback
    ImageService.fileListCache = {
      files,
      timestamp: Date.now()
    };
    
    return files;
  }

  /**
   * Clear metadata cache (call after upload/delete operations)
   */
  private async clearFileListCache(): Promise<void> {
    // Clear Redis cache
    await this.redisService.clearImageCache();
    
    // Clear in-memory cache as fallback
    ImageService.fileListCache = null;
    ImageService.metadataCache.clear();
  }

  /**
   * Update metadata cache after upload operation (no file content caching)
   */
  private async updateCacheAfterUpload(metadata: ImageMetadata): Promise<void> {
    try {
      // Add new metadata to Redis cache
      await this.redisService.setImageMetadata(metadata.id, metadata, ImageService.CACHE_TTL / 1000);
      
      // Add new metadata to in-memory cache as fallback
      ImageService.metadataCache.set(metadata.id, metadata);
      
      // Update file list cache by adding the new file
      if (ImageService.fileListCache) {
        const newFile = {
          name: metadata.originalName,
          type: '-',
          size: metadata.size,
          modifyTime: metadata.uploadDate.getTime()
        };
        ImageService.fileListCache.files.push(newFile);
      } else {
        // If file list cache is null, initialize it with the new file
        ImageService.fileListCache = {
          files: [{
            name: metadata.originalName,
            type: '-',
            size: metadata.size,
            modifyTime: metadata.uploadDate.getTime()
          }],
          timestamp: Date.now()
        };
      }
      
      // Update Redis file list - get current files and add new one
      const currentFiles = await this.redisService.getFileList();
      const updatedFiles = currentFiles ? [...currentFiles, metadata.originalName] : [metadata.originalName];
      await this.redisService.setFileList(updatedFiles, ImageService.CACHE_TTL / 1000);
      
      this.logger.log(`✅ Metadata cache updated for new upload: ${metadata.originalName}`);
    } catch (error) {
      this.logger.error('Failed to update metadata cache after upload:', error);
      // Don't throw error - upload was successful, just cache update failed
    }
  }

  /**
   * Update metadata cache after delete operation (no file content caching)
   */
  private async updateCacheAfterDelete(imageId: string, filename: string): Promise<void> {
    // Remove from Redis cache
    await this.redisService.del(`image:metadata:${imageId}`);
    
    // Remove metadata from in-memory cache
    ImageService.metadataCache.delete(imageId);
    
    // Update file list cache by removing the deleted file
    if (ImageService.fileListCache) {
      ImageService.fileListCache.files = ImageService.fileListCache.files.filter(
        file => file.name !== filename
      );
    }
    
    // Update Redis file list
    const currentFiles = await this.redisService.getFileList();
    if (currentFiles) {
      const updatedFiles = currentFiles.filter(file => file !== filename);
      await this.redisService.setFileList(updatedFiles, ImageService.CACHE_TTL / 1000);
    }
  }

  /**
   * Lightweight metadata cache initialization on startup
   */
  private async initializeMetadataCache(): Promise<void> {
    try {
      // Check if VPS is configured
      if (!this.isVpsConfigured()) {
        return; // Skip if VPS not configured
      }

      this.logger.log('🚀 Lightweight startup: Initializing metadata cache only...');
      
      // Connect and fetch metadata only (no file downloads)
      await this.ensureConnection();
      await this.populateMetadataFromVPS();
      
      this.logger.log(`✅ Metadata cache initialized: ${ImageService.metadataCache.size} images ready for fast access!`);
    } catch (error) {
      this.logger.warn('Failed to initialize metadata cache:', error);
    }
  }


  /**
   * Populate metadata cache from VPS files (no file downloads)
   */
  private async populateMetadataFromVPS(): Promise<void> {
    try {
      await this.ensureConnection();
      const files = await this.getCachedFileList();
      
      // Filter for image files
      const imageFiles = files.filter(file => 
        file.type === '-' && 
        file.name.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i)
      );
      
      // Cache metadata for all images (no file downloads)
      for (const file of imageFiles) {
        try {
          const fileExtension = path.extname(file.name);
          const id = file.name.replace(fileExtension, '');
          
          // Skip if already cached
          if (ImageService.metadataCache.has(id)) {
            continue;
          }
          
          const stats = await ImageService.sftpInstance.stat(`${this.remoteBasePath}/${file.name}`);
          
          const metadata: ImageMetadata = {
            id,
            filename: file.name,
            originalName: file.name,
            size: stats.size || 0,
            mimeType: this.getMimeType(fileExtension),
            uploadDate: new Date(stats.modifyTime || Date.now()),
            path: `${this.remoteBasePath}/${file.name}`,
            url: `${this.baseUrl}/${file.name}`,
            description: undefined,
            category: undefined,
          };
          
          // Cache in Redis
          await this.redisService.setImageMetadata(id, metadata, ImageService.CACHE_TTL / 1000);
          
          // Cache in memory as fallback
          ImageService.metadataCache.set(id, metadata);
        } catch (error) {
          this.logger.warn(`Failed to cache metadata for ${file.name}:`, error);
        }
      }
      
      this.logger.log(`Populated metadata cache with ${ImageService.metadataCache.size} images`);
    } catch (error) {
      this.logger.error('Failed to populate metadata cache from VPS:', error);
      throw error;
    }
  }

  /**
   * Upload image to Contabo VPS
   */
  async uploadImage(file: any): Promise<ImageMetadata> {
    const startTime = Date.now();
    try {
      // Use original filename with timestamp to avoid conflicts
      const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'); // Sanitize filename
      const timestamp = Date.now();
      const fileExtension = path.extname(sanitizedName);
      const nameWithoutExt = sanitizedName.replace(/\.[^/.]+$/, "");
      const filename = `${nameWithoutExt}_${timestamp}${fileExtension}`;
      const remotePath = `${this.remoteBasePath}/${filename}`;

      // Try to upload to VPS, fallback to Redis-only if SFTP fails
      let uploadTime = 0;
      try {
        // Ensure SFTP connection for upload
        await this.ensureConnection();
        
        // Upload file to VPS with optimized settings
        const uploadStart = Date.now();
        await ImageService.sftpInstance.put(file.buffer, remotePath);
        uploadTime = Date.now() - uploadStart;
      } catch (sftpError) {
        this.logger.warn('SFTP upload failed, using Redis-only mode:', sftpError.message);
        // Continue with Redis-only mode - file will be cached but not on VPS
      }

      // Create metadata
      const metadata: ImageMetadata = {
        id: filename.replace(/\.[^/.]+$/, ""), // Use filename without extension as ID
        filename: file.originalname, // Editable display name (starts as original name)
        originalName: filename, // Timestamped filename (immutable)
        size: file.size,
        mimeType: file.mimetype || this.getMimeType(fileExtension), // Use correct property name
        uploadDate: new Date(),
        path: remotePath,
        url: `${this.baseUrl}/${filename}`,
        description: undefined,
        category: undefined,
      };

      // Update cache directly instead of clearing it
      await this.updateCacheAfterUpload(metadata);

      const totalTime = Date.now() - startTime;
      if (uploadTime > 0) {
        const uploadSpeedKBps = (file.size / 1024) / (uploadTime / 1000);
        this.logger.log(`🚀 OPTIMIZED upload: ${metadata.originalName} (${(file.size / 1024).toFixed(1)}KB) - Upload Speed: ${uploadSpeedKBps.toFixed(1)}KB/s - Upload: ${uploadTime}ms, Total: ${totalTime}ms`);
      } else {
        this.logger.log(`🚀 REDIS-ONLY upload: ${metadata.originalName} (${(file.size / 1024).toFixed(1)}KB) - Cached in Redis - Total: ${totalTime}ms`);
      }

      // Verify the upload was successful by checking if metadata is in cache
      const cachedMetadata = await this.redisService.getImageMetadata(metadata.id);
      if (!cachedMetadata) {
        this.logger.warn(`⚠️ Upload completed but metadata not found in cache for ${metadata.id}`);
      } else {
        this.logger.log(`✅ Upload verified: ${metadata.id} is cached and accessible`);
      }

      return metadata;
    } catch (error) {
      this.logger.error('Failed to upload image:', error);
      throw new HttpException('Failed to upload image', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Delete image from Contabo VPS
   */
  async deleteImage(imageId: string): Promise<boolean> {
    const startTime = Date.now();
    try {
      // Get metadata from cache to find the filename
      const metadata = ImageService.metadataCache.get(imageId);
      if (!metadata) {
        throw new HttpException('Image not found', HttpStatus.NOT_FOUND);
      }

      // Try to delete from VPS, fallback to Redis-only if SFTP fails
      let deleteTime = 0;
      try {
        // Ensure SFTP connection for delete
        await this.ensureConnection();

        // Delete file from VPS using cached metadata
        const filePath = `${this.remoteBasePath}/${metadata.originalName}`;
        const deleteStart = Date.now();
        await ImageService.sftpInstance.delete(filePath);
        deleteTime = Date.now() - deleteStart;
      } catch (sftpError) {
        this.logger.warn('SFTP delete failed, using Redis-only mode:', sftpError.message);
        // Continue with Redis-only mode - file will be removed from cache but not from VPS
      }

      // Update cache directly instead of clearing it
      await this.updateCacheAfterDelete(imageId, metadata.originalName);

      const totalTime = Date.now() - startTime;
      if (deleteTime > 0) {
        this.logger.log(`🚀 OPTIMIZED delete: ${metadata.originalName} - Delete: ${deleteTime}ms, Total: ${totalTime}ms`);
      } else {
        this.logger.log(`🚀 REDIS-ONLY delete: ${metadata.originalName} - Removed from Redis cache - Total: ${totalTime}ms`);
      }

      return true;
    } catch (error) {
      this.logger.error('Failed to delete image:', error);
      throw new HttpException('Failed to delete image', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Get image metadata by ID
   */
  async getImage(imageId: string): Promise<ImageMetadata> {
    try {
      // Quick VPS configuration check
      if (!this.isVpsConfigured()) {
        throw new HttpException(
          'Image storage service is not configured. Please contact administrator.',
          HttpStatus.SERVICE_UNAVAILABLE
        );
      }

      // Check Redis cache first
      const redisMetadata = await this.redisService.getImageMetadata(imageId);
      if (redisMetadata) {
        return redisMetadata;
      }

      // Check in-memory cache as fallback
      if (ImageService.metadataCache.has(imageId)) {
        return ImageService.metadataCache.get(imageId)!;
      }

      // If cache is empty, try to populate it first from VPS
      if (ImageService.metadataCache.size === 0) {
        try {
          await this.populateMetadataFromVPS();
          
          // Check cache again after population
          if (ImageService.metadataCache.has(imageId)) {
            return ImageService.metadataCache.get(imageId)!;
          }
        } catch (sftpError) {
          this.logger.warn('SFTP populate metadata cache failed for getImage:', sftpError.message);
          // Continue to throw "not found" error
        }
      }

      // If still not found, the image doesn't exist
      throw new HttpException('Image not found', HttpStatus.NOT_FOUND);
    } catch (error) {
      this.logger.error('Failed to get image:', error);
      
      // If it's already an HttpException, re-throw it
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        'Image storage service is temporarily unavailable. Please try again later.',
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  /**
   * List all images
   */
  async listImages(): Promise<ImageMetadata[]> {
    try {
      // Quick VPS configuration check
      if (!this.isVpsConfigured()) {
        throw new HttpException(
          'Image storage service is not configured. Please contact administrator.',
          HttpStatus.SERVICE_UNAVAILABLE
        );
      }
      
      // Try to get from Redis first
      const redisKeys = await this.redisService.keys('image:metadata:*');
      if (redisKeys.length > 0) {
        const allImages = [];
        for (const key of redisKeys) {
          const imageId = key.replace('image:metadata:', '');
          const metadata = await this.redisService.getImageMetadata(imageId);
          if (metadata) {
            allImages.push(metadata);
          }
        }
        return allImages;
      }
      
      // Fallback to in-memory cache
      if (ImageService.metadataCache.size === 0) {
        try {
          await this.populateMetadataFromVPS();
        } catch (sftpError) {
          this.logger.warn('SFTP populate metadata cache failed, using empty list:', sftpError.message);
          return []; // Return empty array if SFTP fails
        }
      }
      
      // Return all cached metadata
      const allImages = Array.from(ImageService.metadataCache.values());
      
      return allImages;
    } catch (error) {
      this.logger.error('Failed to list images:', error);
      
      // If it's already an HttpException, re-throw it
      if (error instanceof HttpException) {
        throw error;
      }
      
      // For other errors, throw a generic service unavailable error
      throw new HttpException(
        'Image storage service is temporarily unavailable. Please try again later.',
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }



  /**
   * Get image file URL for direct serving (no file content caching)
   */
  async getImageFileUrl(imageId: string): Promise<string> {
    try {
      // Get metadata from cache to find the filename
      const metadata = await this.getImage(imageId);
      if (!metadata) {
        throw new HttpException('Image not found', HttpStatus.NOT_FOUND);
      }

      // Return direct URL for web server serving
      this.logger.log(`Direct file URL requested: ${metadata.originalName} -> ${metadata.url}`);
      return metadata.url;
    } catch (error) {
      this.logger.error('Failed to get image file URL:', error);
      throw new HttpException('Failed to get image file URL', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }


  /**
   * Save image metadata (implement with your preferred storage method)
   */
  private async saveImageMetadata(metadata: ImageMetadata): Promise<void> {
    // TODO: Implement metadata storage (database, file, etc.)
    // For now, just cache it
  }

  /**
   * Get image metadata (implement with your preferred storage method)
   */
  private async getImageMetadata(imageId: string): Promise<ImageMetadata | null> {
    // TODO: Implement metadata retrieval (database, file, etc.)
    // For now, return null
    return null;
  }

  /**
   * Delete image metadata (implement with your preferred storage method)
   */
  private async deleteImageMetadata(imageId: string): Promise<void> {
    // TODO: Implement metadata deletion (database, file, etc.)
    // Remove from cache
    ImageService.metadataCache.delete(imageId);
  }

  /**
   * Manually refresh metadata cache from VPS (admin endpoint)
   */
  async refreshCacheFromVPS(): Promise<{ success: boolean; message: string; count: number }> {
    try {
      this.logger.log('🔄 Manual metadata cache refresh requested...');
      
      // Try to connect and populate metadata cache only
      await this.ensureConnection();
      await this.populateMetadataFromVPS();
      
      const count = ImageService.metadataCache.size;
      this.logger.log(`✅ Metadata cache refreshed successfully: ${count} images loaded`);
      
      return {
        success: true,
        message: `Metadata cache refreshed successfully`,
        count: count
      };
    } catch (error) {
      this.logger.error('Failed to refresh metadata cache from VPS:', error);
      return {
        success: false,
        message: `Failed to refresh metadata cache: ${error.message}`,
        count: 0
      };
    }
  }

  /**
   * Update all image URLs when domain changes (admin endpoint)
   */
  async updateImageUrlsForNewDomain(): Promise<{ success: boolean; message: string; updatedCount: number }> {
    try {
      this.logger.log('🔄 Updating image URLs for new domain...');
      
      const currentBaseUrl = this.configService.get('CONTABO_BASE_URL') || 'https://your-domain.com/images';
      let updatedCount = 0;
      
      // Get all cached images
      const allImages = Array.from(ImageService.metadataCache.values());
      
      for (const metadata of allImages) {
        try {
          // Update the URL with the new base URL
          const updatedMetadata: ImageMetadata = {
            ...metadata,
            url: `${currentBaseUrl}/${metadata.originalName}`,
          };
          
          // Update Redis cache
          await this.redisService.setImageMetadata(metadata.id, updatedMetadata, ImageService.CACHE_TTL / 1000);
          
          // Update in-memory cache
          ImageService.metadataCache.set(metadata.id, updatedMetadata);
          
          updatedCount++;
        } catch (error) {
          this.logger.warn(`Failed to update URL for image ${metadata.id}:`, error);
        }
      }
      
      this.logger.log(`✅ Updated URLs for ${updatedCount} images with new domain: ${currentBaseUrl}`);
      
      return {
        success: true,
        message: `Updated URLs for ${updatedCount} images`,
        updatedCount: updatedCount
      };
    } catch (error) {
      this.logger.error('Failed to update image URLs:', error);
      return {
        success: false,
        message: `Failed to update URLs: ${error.message}`,
        updatedCount: 0
      };
    }
  }


  /**
   * Edit image metadata
   */
  async editImageMetadata(imageId: string, editData: { filename?: string; description?: string; category?: string }): Promise<ImageMetadata> {
    try {
      // Quick VPS configuration check
      if (!this.isVpsConfigured()) {
        throw new HttpException(
          'Image storage service is not configured. Please contact administrator.',
          HttpStatus.SERVICE_UNAVAILABLE
        );
      }

      // Get current metadata from cache (should be fast)
      let currentMetadata = await this.redisService.getImageMetadata(imageId);
      if (!currentMetadata) {
        currentMetadata = ImageService.metadataCache.get(imageId);
      }
      if (!currentMetadata) {
        throw new HttpException('Image not found', HttpStatus.NOT_FOUND);
      }
      
      // If filename is being changed, we need to rename the file on the server
      if (editData.filename && editData.filename !== currentMetadata.filename) {
        try {
          await this.ensureConnection();
          
          // Create new filename with proper extension
          const fileExtension = path.extname(currentMetadata.originalName);
          const sanitizedNewName = editData.filename.replace(/[^a-zA-Z0-9.-]/g, '_');
          const newFilename = `${sanitizedNewName}${fileExtension}`;
          const oldPath = `${this.remoteBasePath}/${currentMetadata.originalName}`;
          const newPath = `${this.remoteBasePath}/${newFilename}`;
          
          // Rename file on server
          await ImageService.sftpInstance.rename(oldPath, newPath);
          
          // Update the originalName to reflect the new filename
          currentMetadata.originalName = newFilename;
          currentMetadata.path = newPath;
          currentMetadata.url = `${this.baseUrl}/${newFilename}`;
          
          this.logger.log(`File renamed from ${currentMetadata.originalName} to ${newFilename}`);
        } catch (sftpError) {
          this.logger.warn('SFTP rename failed, updating metadata only:', sftpError.message);
          // Continue with metadata update even if rename fails
        }
      }
      
      // Update metadata with new values
      const updatedMetadata: ImageMetadata = {
        ...currentMetadata,
        ...editData,
      };

      // Update Redis cache
      await this.redisService.setImageMetadata(imageId, updatedMetadata, ImageService.CACHE_TTL / 1000);
      
      // Update in-memory cache as fallback
      ImageService.metadataCache.set(imageId, updatedMetadata);

      return updatedMetadata;
    } catch (error) {
      this.logger.error('Failed to edit image metadata:', error);
      
      // If it's already an HttpException, re-throw it
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        'Failed to update image metadata',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get MIME type from file extension
   */
  private getMimeType(extension: string): string {
    const mimeTypes: { [key: string]: string } = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml',
    };
    
    return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
  }

  /**
   * Start keep-alive mechanism - lightweight connection maintenance only
   */
  private startKeepAlive(): void {
    // Clear existing interval
    if (ImageService.keepAliveInterval) {
      clearInterval(ImageService.keepAliveInterval);
    }

    // Lightweight keep-alive: Ping every 30 minutes for connection maintenance only
    ImageService.keepAliveInterval = setInterval(async () => {
      try {
        // Check Redis health first
        const redisHealthy = await this.redisService.isRedisAvailable();
        if (!redisHealthy) {
          this.logger.warn('Keep-alive: Redis connection lost, attempting to reconnect...');
          // Redis will auto-reconnect on next operation
        }

        if (this.isConnected()) {
          // Simple ping to keep SFTP connection alive
          await ImageService.sftpInstance.list(this.remoteBasePath);
          this.logger.log(`Keep-alive: SFTP maintained, Redis: ${redisHealthy ? 'OK' : 'Issues'} (${ImageService.metadataCache.size} metadata cached)`);
        } else {
          this.logger.warn('Keep-alive: SFTP connection lost, attempting to reconnect...');
          await this.ensureConnection();
        }
      } catch (error) {
        this.logger.error('Keep-alive error:', error);
        // Try to reconnect on error
        try {
          await this.ensureConnection();
        } catch (reconnectError) {
          this.logger.error('Keep-alive reconnection failed:', reconnectError);
        }
      }
    }, ImageService.KEEP_ALIVE_INTERVAL); // 30 minutes interval
  }


  /**
   * Stop keep-alive mechanism
   */
  private stopKeepAlive(): void {
    if (ImageService.keepAliveInterval) {
      clearInterval(ImageService.keepAliveInterval);
      ImageService.keepAliveInterval = null;
    }
  }

  /**
   * Cleanup SFTP connection
   */
  async onModuleDestroy() {
    this.stopKeepAlive();
    
    if (ImageService.sftpInstance) {
      try {
        if (typeof ImageService.sftpInstance.end === 'function') {
          await ImageService.sftpInstance.end();
          this.logger.log('SFTP connection closed');
        }
      } catch (error) {
        this.logger.warn('Error during SFTP cleanup on module destroy:', error);
      } finally {
        ImageService.sftpInstance = null;
      }
    }
  }


}

