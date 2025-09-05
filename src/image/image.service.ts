import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as Client from 'ssh2-sftp-client';
import { v4 as uuidv4 } from 'uuid';

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
  private static readonly KEEP_ALIVE_INTERVAL = 120000; // 2 minutes keep-alive
  private static connectionPromise: Promise<void> | null = null;
  private static keepAliveInterval: NodeJS.Timeout | null = null;
  private static sftpInstance: Client | null = null;

  constructor(private readonly configService: ConfigService) {
    this.remoteBasePath = this.configService.get('CONTABO_IMAGE_PATH') || '/var/www/html/images';
    this.baseUrl = this.configService.get('CONTABO_BASE_URL') || 'https://your-domain.com/images';
    
    // Configure cache intervals from environment variables
    this.configureCacheIntervals();
    
    // Set the static SFTP instance reference
    this.sftp = ImageService.sftpInstance;
    
    // Pre-warm cache on startup (non-blocking)
    this.preWarmCache().catch(error => {
      this.logger.warn('Failed to pre-warm cache on startup:', error);
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
        // Connection options for better stability
        keepaliveInterval: 180000, // 3 minutes (180 seconds)
        keepaliveCountMax: 3,
        readyTimeout: 20000, // 20 seconds
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
    const now = Date.now();
    
    // Return cached files if cache is still valid
    if (ImageService.fileListCache && (now - ImageService.fileListCache.timestamp) < ImageService.CACHE_TTL) {
      return ImageService.fileListCache.files;
    }

    // Cache expired, fetch fresh data
    return this.refreshFileListCache();
  }

  /**
   * Refresh file list cache with fresh data from VPS
   */
  private async refreshFileListCache(): Promise<any[]> {
    await this.ensureConnection();
    const files = await ImageService.sftpInstance.list(this.remoteBasePath);
    
    // Update cache
    ImageService.fileListCache = {
      files,
      timestamp: Date.now()
    };
    
    return files;
  }

  /**
   * Clear file list cache (call after upload/delete operations)
   */
  private clearFileListCache(): void {
    ImageService.fileListCache = null;
    ImageService.metadataCache.clear();
  }

  /**
   * Update cache after upload operation
   */
  private updateCacheAfterUpload(metadata: ImageMetadata): void {
    // Add new metadata to cache
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
    }
  }

  /**
   * Update cache after delete operation
   */
  private updateCacheAfterDelete(imageId: string, filename: string): void {
    // Remove metadata from cache
    ImageService.metadataCache.delete(imageId);
    
    // Update file list cache by removing the deleted file
    if (ImageService.fileListCache) {
      ImageService.fileListCache.files = ImageService.fileListCache.files.filter(
        file => file.name !== filename
      );
    }
  }

  /**
   * Pre-warm cache on startup
   */
  private async preWarmCache(): Promise<void> {
    try {
      // Check if VPS is configured
      if (!this.isVpsConfigured()) {
        return; // Skip if VPS not configured
      }

      // Connect and fetch initial data
      await this.ensureConnection();
      await this.populateCacheFromVPS();
      
      this.logger.log('Cache pre-warmed successfully');
    } catch (error) {
      this.logger.warn('Failed to pre-warm cache:', error);
    }
  }

  /**
   * Populate cache from VPS files
   */
  private async populateCacheFromVPS(): Promise<void> {
    try {
      await this.ensureConnection();
      const files = await this.getCachedFileList();
      
      // Filter for image files
      const imageFiles = files.filter(file => 
        file.type === '-' && 
        file.name.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i)
      );
      
      // Cache metadata for all images
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
          
          ImageService.metadataCache.set(id, metadata);
        } catch (error) {
          this.logger.warn(`Failed to cache metadata for ${file.name}:`, error);
        }
      }
      
      this.logger.log(`Populated cache with ${ImageService.metadataCache.size} images`);
    } catch (error) {
      this.logger.error('Failed to populate cache from VPS:', error);
      throw error;
    }
  }

  /**
   * Upload image to Contabo VPS
   */
  async uploadImage(file: any): Promise<ImageMetadata> {
    try {
      // Connection should be maintained by keep-alive ping

      // Use original filename with timestamp to avoid conflicts
      const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'); // Sanitize filename
      const timestamp = Date.now();
      const fileExtension = path.extname(sanitizedName);
      const nameWithoutExt = sanitizedName.replace(/\.[^/.]+$/, "");
      const filename = `${nameWithoutExt}_${timestamp}${fileExtension}`;
      const remotePath = `${this.remoteBasePath}/${filename}`;

      // Upload file to VPS
      await ImageService.sftpInstance.put(file.buffer, remotePath);

      // Create metadata
      const metadata: ImageMetadata = {
        id: filename.replace(/\.[^/.]+$/, ""), // Use filename without extension as ID
        filename: file.originalname, // Editable display name (starts as original name)
        originalName: filename, // Timestamped filename (immutable)
        size: file.size,
        mimeType: file.mimeType,
        uploadDate: new Date(),
        path: remotePath,
        url: `${this.baseUrl}/${filename}`,
        description: undefined,
        category: undefined,
      };

      // Update cache directly instead of clearing it
      this.updateCacheAfterUpload(metadata);

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
    try {
      // Get metadata from cache to find the filename
      const metadata = ImageService.metadataCache.get(imageId);
      if (!metadata) {
        throw new HttpException('Image not found', HttpStatus.NOT_FOUND);
      }

      // Delete file from VPS using cached metadata (connection should be maintained by keep-alive)
      const filePath = `${this.remoteBasePath}/${metadata.originalName}`;
      await ImageService.sftpInstance.delete(filePath);

      // Update cache directly instead of clearing it
      this.updateCacheAfterDelete(imageId, metadata.originalName);

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

      // Check cache first
      if (ImageService.metadataCache.has(imageId)) {
        return ImageService.metadataCache.get(imageId)!;
      }

      // If cache is empty, try to populate it first
      if (ImageService.metadataCache.size === 0) {
        await this.populateCacheFromVPS();
        
        // Check cache again after population
        if (ImageService.metadataCache.has(imageId)) {
          return ImageService.metadataCache.get(imageId)!;
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
      
      // If cache is empty, try to populate it first
      if (ImageService.metadataCache.size === 0) {
        await this.populateCacheFromVPS();
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
   * Get image file from VPS
   */
  async getImageFile(imageId: string): Promise<Buffer> {
    const startTime = Date.now();
    try {
      // Get metadata from cache to find the filename
      const metadata = ImageService.metadataCache.get(imageId);
      if (!metadata) {
        throw new HttpException('Image not found', HttpStatus.NOT_FOUND);
      }

      // Let SFTP client handle connection automatically
      // No need to test connection - SFTP client will reconnect if needed

      // Download file from VPS using cached metadata
      const filePath = `${this.remoteBasePath}/${metadata.originalName}`;
      const downloadStart = Date.now();
      const fileBuffer = await ImageService.sftpInstance.get(filePath);
      const downloadTime = Date.now() - downloadStart;
      const totalTime = Date.now() - startTime;
      
      this.logger.log(`Download completed: ${metadata.originalName} (${(fileBuffer.length / 1024).toFixed(1)}KB) - Download: ${downloadTime}ms, Total: ${totalTime}ms`);
      return fileBuffer;
    } catch (error) {
      this.logger.error('Failed to get image file:', error);
      throw new HttpException('Failed to get image file', HttpStatus.INTERNAL_SERVER_ERROR);
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
      const currentMetadata = ImageService.metadataCache.get(imageId);
      if (!currentMetadata) {
        throw new HttpException('Image not found', HttpStatus.NOT_FOUND);
      }
      
      // Update metadata with new values
      const updatedMetadata: ImageMetadata = {
        ...currentMetadata,
        ...editData,
      };

      // Update cache directly (no database operations needed)
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
   * Start keep-alive mechanism to maintain SFTP connection and refresh cache
   */
  private startKeepAlive(): void {
    // Clear existing interval
    if (ImageService.keepAliveInterval) {
      clearInterval(ImageService.keepAliveInterval);
    }

    // Ping every 3 minutes to keep connection alive (less aggressive)
    ImageService.keepAliveInterval = setInterval(async () => {
      try {
        if (this.isConnected()) {
          // Simple ping to keep connection alive
          await ImageService.sftpInstance.list(this.remoteBasePath);
          this.logger.log(`Keep-alive: Connection maintained (${ImageService.metadataCache.size} images cached)`);
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
    }, ImageService.KEEP_ALIVE_INTERVAL); // 3 minutes interval
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

