import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as Client from 'ssh2-sftp-client';
import { RedisService } from './redis.service';
import { 
  ImageMetadata, 
  UploadedImageFile, 
  EditImageData
} from './types';

@Injectable()
export class ImageService {
  private readonly logger = new Logger(ImageService.name);
  private sftp: Client;
  private readonly remoteBasePath: string;
  private readonly baseUrl: string;

  // Performance optimizations - static to persist across requests
  private static readonly metadataCache = new Map<string, ImageMetadata>();
  private static readonly fileCache = new Map<string, Buffer>();
  private static readonly KEEP_ALIVE_INTERVAL = 180000; // 3 minutes keep-alive
  private static connectionPromise: Promise<void> | null = null;
  private static keepAliveInterval: NodeJS.Timeout | null = null;
  private static sftpInstance: Client | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {
    this.remoteBasePath = this.configService.get('CONTABO_IMAGE_PATH') || '/var/www/ctomemes.xyz/images';
    this.baseUrl = this.configService.get('BACKEND_BASE_URL') || 'http://localhost:3001';
    
    // Set the static SFTP instance reference
    this.sftp = ImageService.sftpInstance;
    
    // Pre-warm cache on startup (non-blocking)
    this.preWarmCache().catch(error => {
      this.logger.warn('Failed to pre-warm cache on startup:', error);
    });
    
    this.logger.log(`ImageService initialized with remoteBasePath: ${this.remoteBasePath}`);
  }

  /**
   * Initialize SFTP connection to Contabo VPS
   */
  private async connectSFTP(): Promise<void> {
    try {
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

      ImageService.sftpInstance = new Client();
      const port = this.configService.get('CONTABO_PORT') || 22;
      
      await ImageService.sftpInstance.connect({
        host,
        port,
        username,
        password,
        keepaliveInterval: 30000,
        keepaliveCountMax: 5,
        readyTimeout: 10000,
        algorithms: {
          kex: ['diffie-hellman-group14-sha256', 'ecdh-sha2-nistp256'],
          cipher: ['aes128-ctr', 'aes192-ctr', 'aes256-ctr'],
          hmac: ['hmac-sha2-256', 'hmac-sha2-512'],
          compress: ['none']
        },
      });

      this.logger.log('SFTP connection established to Contabo VPS');
      this.sftp = ImageService.sftpInstance;
      this.startKeepAlive();
    } catch (error) {
      this.logger.error('Failed to connect to Contabo VPS:', error);
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
   * Check if VPS is configured
   */
  private isVpsConfigured(): boolean {
    const host = this.configService.get('CONTABO_HOST');
    const username = this.configService.get('CONTABO_USERNAME');
    const password = this.configService.get('CONTABO_PASSWORD');
    return !!(host && username && password);
  }

  /**
   * Ensure SFTP connection is active
   */
  private async ensureConnection(): Promise<void> {
    try {
      if (!this.isVpsConfigured()) {
        throw new Error('VPS not configured');
      }

      if (ImageService.connectionPromise) {
        await ImageService.connectionPromise;
        return;
      }

      if (this.isConnected()) {
        return;
      }

      ImageService.connectionPromise = this.connectSFTP();
      await ImageService.connectionPromise;
      ImageService.connectionPromise = null;
    } catch (error) {
      ImageService.connectionPromise = null;
      this.logger.error('Failed to ensure SFTP connection:', error);
      if (error.message === 'VPS not configured') {
        throw error;
      }
      ImageService.sftpInstance = null;
      throw error;
    }
  }

  /**
   * Check if connected
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
   * Pre-warm cache on startup
   */
  private async preWarmCache(): Promise<void> {
    try {
      if (!this.isVpsConfigured()) {
        return;
      }

      await this.ensureConnection();
      await this.populateCacheFromVPS();
      
      this.logger.log('Cache pre-warmed successfully');
    } catch (error) {
      this.logger.warn('Failed to pre-warm cache:', error);
    }
  }

  /**
   * Start keep-alive mechanism
   */
  private startKeepAlive(): void {
    if (ImageService.keepAliveInterval) {
      clearInterval(ImageService.keepAliveInterval);
    }

    ImageService.keepAliveInterval = setInterval(async () => {
      try {
        if (this.isConnected()) {
          await ImageService.sftpInstance.list(this.remoteBasePath);
          this.logger.log(`Keep-alive: Connection maintained (${ImageService.metadataCache.size} images cached, ${ImageService.fileCache.size} files cached)`);
          
          // Pre-cache files that aren't cached yet
          await this.preCacheFiles();
        } else {
          this.logger.warn('Keep-alive: SFTP connection lost, attempting to reconnect...');
          await this.ensureConnection();
        }
      } catch (error) {
        this.logger.error('Keep-alive error:', error);
        try {
          await this.ensureConnection();
        } catch (reconnectError) {
          this.logger.error('Keep-alive reconnection failed:', reconnectError);
        }
      }
    }, ImageService.KEEP_ALIVE_INTERVAL);
  }

  /**
   * Pre-cache files for instant downloads
   */
  private async preCacheFiles(): Promise<void> {
    try {
      const uncachedImages = Array.from(ImageService.metadataCache.values())
        .filter(metadata => !ImageService.fileCache.has(metadata.id));
      
      if (uncachedImages.length === 0) {
        return;
      }
      
      this.logger.log(`Pre-caching ${uncachedImages.length} files for instant downloads...`);
      
      const batchSize = 3;
      for (let i = 0; i < uncachedImages.length; i += batchSize) {
        const batch = uncachedImages.slice(i, i + batchSize);
        const cachePromises = batch.map(async (metadata) => {
          try {
            const filePath = `${this.remoteBasePath}/${metadata.originalName}`;
            const fileBuffer = await this.streamDownload(filePath);
            ImageService.fileCache.set(metadata.id, fileBuffer);
            this.logger.log(`Pre-cached: ${metadata.originalName} (${(fileBuffer.length / 1024).toFixed(1)}KB)`);
          } catch (error) {
            this.logger.warn(`Failed to pre-cache ${metadata.originalName}:`, error.message);
          }
        });
        
        await Promise.all(cachePromises);
        
        if (i + batchSize < uncachedImages.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      this.logger.log(`Pre-caching completed: ${ImageService.fileCache.size} files cached`);
    } catch (error) {
      this.logger.error('Pre-caching error:', error);
    }
  }

  /**
   * Stream download for maximum speed
   */
  private async streamDownload(filePath: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalSize = 0;
      
      const stream = ImageService.sftpInstance.createReadStream(filePath, {
        flags: 'r',
        encoding: null,
        highWaterMark: 64 * 1024, // 64KB chunks for optimal speed
        autoClose: true
      });
      
      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        totalSize += chunk.length;
      });
      
      stream.on('end', () => {
        const buffer = Buffer.concat(chunks, totalSize);
        resolve(buffer);
      });
      
      stream.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Get image metadata by ID
   */
  async getImage(imageId: string): Promise<ImageMetadata> {
    try {
      // Check in-memory cache first
      if (ImageService.metadataCache.has(imageId)) {
        this.logger.debug(`Metadata found in cache for: ${imageId}`);
        return ImageService.metadataCache.get(imageId)!;
      }

      // Check Redis cache
      const cachedMetadata = await this.redisService.getImageMetadata(imageId);
      if (cachedMetadata) {
        this.logger.debug(`Metadata found in Redis for: ${imageId}`);
        ImageService.metadataCache.set(imageId, cachedMetadata);
        return cachedMetadata;
      }

      // If not in cache, search VPS directly
      this.logger.log(`Metadata not in cache for ${imageId}, searching VPS...`);
      
      const metadata = await this.findImageOnVPS(imageId);
      
      // Cache the metadata
      ImageService.metadataCache.set(imageId, metadata);
      await this.redisService.setImageMetadata(imageId, metadata);
      
      this.logger.log(`Found and cached metadata for: ${metadata.originalName}`);
      return metadata;
    } catch (error) {
      this.logger.error(`Failed to get image metadata for ${imageId}:`, error);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException('Image not found', HttpStatus.NOT_FOUND);
    }
  }

  /**
   * Get image file - INSTANT download from local cache
   */
  async getImageFile(imageId: string): Promise<Buffer> {
    const startTime = Date.now();
    try {
      // Check in-memory cache first (fastest - 0.1ms)
      if (ImageService.fileCache.has(imageId)) {
        const cachedFile = ImageService.fileCache.get(imageId);
        const totalTime = Date.now() - startTime;
        this.logger.log(`INSTANT download from memory cache: ${imageId} (${(cachedFile.length / 1024).toFixed(1)}KB) - Total: ${totalTime}ms`);
        return cachedFile;
      }

      // Get metadata to find the filename
      const metadata = await this.getImage(imageId);

      // Download from VPS with streaming for maximum speed
      this.logger.log(`Streaming download from VPS: ${metadata.originalName}`);
      const filePath = `${this.remoteBasePath}/${metadata.originalName}`;
      const downloadStart = Date.now();
      
      const fileBuffer = await this.streamDownload(filePath);
      const downloadTime = Date.now() - downloadStart;
      
      // Cache the file for instant future downloads
      ImageService.fileCache.set(imageId, fileBuffer);
      
      const totalTime = Date.now() - startTime;
      const speedKBps = (fileBuffer.length / 1024) / (downloadTime / 1000);
      this.logger.log(`Streaming download completed: ${metadata.originalName} (${(fileBuffer.length / 1024).toFixed(1)}KB) - Speed: ${speedKBps.toFixed(1)}KB/s - Download: ${downloadTime}ms, Total: ${totalTime}ms`);
      return fileBuffer;
    } catch (error) {
      this.logger.error('Failed to get image file:', error);
      throw new HttpException('Failed to get image file', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * List all images
   */
  async listImages(): Promise<ImageMetadata[]> {
    try {
      // Try to get from Redis first
      const redisImages: ImageMetadata[] = await this.redisService.getFileList();
      if (redisImages && redisImages.length > 0) {
        this.logger.log(`Returning ${redisImages.length} images from Redis`);
        
        
        return redisImages;
      }

      // If Redis is empty, populate from VPS
      this.logger.log('Redis cache empty, populating from VPS...');
      await this.populateCacheFromVPS();
      
      const allImages = Array.from(ImageService.metadataCache.values());
      this.logger.log(`Returning ${allImages.length} images from cache`);
      
      
      return allImages;
    } catch (error) {
      this.logger.error('Failed to list images:', error);
      throw new HttpException('Failed to list images', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Upload image
   */
  async uploadImage(file: UploadedImageFile): Promise<ImageMetadata> {
    try {
      await this.ensureConnection();

      // Generate unique filename
      const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
      const timestamp = Date.now();
      const fileExtension = path.extname(sanitizedName);
      const nameWithoutExt = sanitizedName.replace(/\.[^/.]+$/, "");
      const filename = `${nameWithoutExt}_${timestamp}${fileExtension}`;
      const remotePath = `${this.remoteBasePath}/${filename}`;
        
      // Upload file to VPS using persistent connection
      await ImageService.sftpInstance.put(file.buffer, remotePath);

      // Create metadata
      const metadata: ImageMetadata = {
        id: filename.replace(/\.[^/.]+$/, ""),
        filename: file.originalname,
        originalName: filename,
        size: file.size,
        mimeType: file.mimetype,
        uploadDate: new Date(),
        path: remotePath,
        url: `${this.baseUrl}/api/images/${filename.replace(/\.[^/.]+$/, "")}/view`,
        description: undefined,
        category: undefined,
      };

      // Cache the metadata and file immediately
      ImageService.metadataCache.set(metadata.id, metadata);
      ImageService.fileCache.set(metadata.id, file.buffer); // INSTANT access!
      
      // Also cache in Redis as backup
      await this.redisService.setImageMetadata(metadata.id, metadata);
      await this.redisService.setImageFileBuffer(metadata.id, file.buffer);
      

      this.logger.log(`Uploaded and cached: ${metadata.originalName} (${(file.buffer.length / 1024).toFixed(1)}KB)`);
      return metadata;
    } catch (error) {
      this.logger.error('Failed to upload image:', error);
      throw new HttpException('Failed to upload image', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Delete image
   */
  async deleteImage(imageId: string): Promise<boolean> {
    try {
      const metadata = ImageService.metadataCache.get(imageId) || await this.redisService.getImageMetadata(imageId);
      if (!metadata) {
        throw new HttpException('Image not found', HttpStatus.NOT_FOUND);
      }

      await this.ensureConnection();

      // Delete file from VPS using persistent connection
      const filePath = `${this.remoteBasePath}/${metadata.originalName}`;
      await ImageService.sftpInstance.delete(filePath);

      // Remove from caches
      ImageService.metadataCache.delete(imageId);
      ImageService.fileCache.delete(imageId);
      
      // Remove specific image from Redis (not entire cache)
      await this.redisService.del(`image:metadata:${imageId}`);
      await this.redisService.del(`image:buffer:${imageId}`);

      this.logger.log(`Deleted: ${metadata.originalName}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to delete image:', error);
      throw new HttpException('Failed to delete image', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Edit image metadata
   */
  async editImageMetadata(imageId: string, editData: EditImageData): Promise<ImageMetadata> {
    try {
      const currentMetadata = ImageService.metadataCache.get(imageId) || await this.redisService.getImageMetadata(imageId);
      if (!currentMetadata) {
        throw new HttpException('Image not found', HttpStatus.NOT_FOUND);
      }

      const updatedMetadata: ImageMetadata = {
        ...currentMetadata,
        ...editData,
      };

      // Update caches
      ImageService.metadataCache.set(imageId, updatedMetadata);
      await this.redisService.setImageMetadata(imageId, updatedMetadata);

      this.logger.log(`Updated metadata for: ${imageId}`);
      return updatedMetadata;
    } catch (error) {
      this.logger.error('Failed to edit image metadata:', error);
      throw new HttpException('Failed to update image metadata', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Find image on VPS and create metadata
   */
  private async findImageOnVPS(imageId: string): Promise<ImageMetadata> {
    try {
      await this.ensureConnection();

      const files = await ImageService.sftpInstance.list(this.remoteBasePath);
      
      // Look for a file that matches the imageId
      const matchingFile = files.find(file => {
        const fileWithoutExt = file.name.replace(/\.[^/.]+$/, "");
        return fileWithoutExt === imageId;
      });
      
      if (!matchingFile) {
        throw new HttpException('Image not found', HttpStatus.NOT_FOUND);
      }
      
      // Get file stats and create metadata
      const stats = await ImageService.sftpInstance.stat(`${this.remoteBasePath}/${matchingFile.name}`);
      const metadata: ImageMetadata = {
        id: imageId,
        filename: matchingFile.name,
        originalName: matchingFile.name,
        size: stats.size || 0,
        mimeType: this.getMimeType(path.extname(matchingFile.name)),
        uploadDate: new Date(stats.modifyTime || Date.now()),
        path: `${this.remoteBasePath}/${matchingFile.name}`,
        url: `${this.baseUrl}/api/images/${imageId}/view`,
        description: undefined,
        category: undefined,
      };
      
      return metadata;
    } catch (error) {
      this.logger.error(`Failed to find image on VPS: ${imageId}`, error);
      throw error;
    }
  }

  /**
   * Populate cache from VPS
   */
  private async populateCacheFromVPS(): Promise<void> {
    try {
      await this.ensureConnection();

      const files = await ImageService.sftpInstance.list(this.remoteBasePath);
      const imageFiles = files.filter(file => 
        file.type === '-' && file.name.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i)
      );

      const allMetadata: ImageMetadata[] = [];

      for (const file of imageFiles) {
        try {
          const fileExtension = path.extname(file.name);
          const id = file.name.replace(fileExtension, '');
          
          const stats = await ImageService.sftpInstance.stat(`${this.remoteBasePath}/${file.name}`);
          const metadata: ImageMetadata = {
            id,
            filename: file.name,
            originalName: file.name,
            size: stats.size || 0,
            mimeType: this.getMimeType(fileExtension),
            uploadDate: new Date(stats.modifyTime || Date.now()),
            path: `${this.remoteBasePath}/${file.name}`,
            url: `${this.baseUrl}/api/images/${id}/view`,
            description: undefined,
            category: undefined,
          };

          ImageService.metadataCache.set(id, metadata);
          allMetadata.push(metadata);
        } catch (error) {
          this.logger.warn(`Failed to process file ${file.name}:`, error);
        }
      }

      // Update Redis with all metadata
      await this.redisService.setFileList(allMetadata);
      
      this.logger.log(`Populated cache with ${allMetadata.length} images`);
    } catch (error) {
      this.logger.error('Failed to populate cache from VPS:', error);
      throw error;
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