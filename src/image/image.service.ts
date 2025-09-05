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
  
  // Performance optimizations
  private metadataCache: Map<string, ImageMetadata> = new Map();
  private fileListCache: { files: any[], timestamp: number } | null = null;
  private readonly CACHE_TTL = 30000; // 30 seconds cache
  private connectionPromise: Promise<void> | null = null;
  private keepAliveInterval: NodeJS.Timeout | null = null;

  constructor(private readonly configService: ConfigService) {
    this.remoteBasePath = this.configService.get('CONTABO_IMAGE_PATH') || '/var/www/html/images';
    this.baseUrl = this.configService.get('CONTABO_BASE_URL') || 'https://your-domain.com/images';
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
      if (this.sftp) {
        try {
          if (typeof this.sftp.end === 'function') {
            await this.sftp.end();
          }
        } catch (cleanupError) {
          this.logger.warn('Error during SFTP cleanup:', cleanupError);
        }
        this.sftp = null;
      }

      // Try to create SFTP client, but handle import errors gracefully
      try {
        this.sftp = new Client();
      } catch (importError) {
        this.logger.error('Failed to import SFTP client:', importError);
        throw new Error('SFTP client not available in this environment');
      }
      
      // Debug: Log the actual values being used
      const port = this.configService.get('CONTABO_PORT') || 22;
      
      this.logger.log(`DEBUG - Environment variables loaded:`);
      this.logger.log(`  CONTABO_HOST: ${host}`);
      this.logger.log(`  CONTABO_PORT: ${port}`);
      this.logger.log(`  CONTABO_USERNAME: ${username}`);
      this.logger.log(`  CONTABO_PASSWORD: ${password ? '[SET]' : '[MISSING]'}`);
      
      await this.sftp.connect({
        host,
        port,
        username,
        password,
        // Alternative: use private key
        // privateKey: fs.readFileSync(this.configService.get('CONTABO_PRIVATE_KEY_PATH')),
      });

      this.logger.log('SFTP connection established to Contabo VPS');
      
      // Start keep-alive mechanism
      this.startKeepAlive();
    } catch (error) {
      this.logger.error('Failed to connect to Contabo VPS:', error);
      // Clean up failed connection
      if (this.sftp) {
        try {
          if (typeof this.sftp.end === 'function') {
            await this.sftp.end();
          }
        } catch (cleanupError) {
          this.logger.warn('Error during failed connection cleanup:', cleanupError);
        }
        this.sftp = null;
      }
      throw new HttpException('Failed to connect to image storage', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  /**
   * Ensure SFTP connection is active with connection pooling
   */
  private async ensureConnection(): Promise<void> {
    try {
      // Check if VPS is configured first
      const host = this.configService.get('CONTABO_HOST');
      const username = this.configService.get('CONTABO_USERNAME');
      const password = this.configService.get('CONTABO_PASSWORD');
      
      if (!host || !username || !password) {
        this.logger.warn('Contabo VPS not configured, skipping connection');
        throw new Error('VPS not configured');
      }

      // If there's already a connection in progress, wait for it
      if (this.connectionPromise) {
        await this.connectionPromise;
        return;
      }

      // Check if sftp exists and is connected
      if (this.sftp && typeof this.sftp.isConnected === 'function' && this.sftp.isConnected()) {
        return; // Connection is good, no need to reconnect
      }

      // Create new connection
      this.connectionPromise = this.connectSFTP();
      await this.connectionPromise;
      this.connectionPromise = null;
    } catch (error) {
      this.connectionPromise = null;
      this.logger.error('Failed to ensure SFTP connection:', error);
      // Don't try to reconnect if VPS is not configured
      if (error.message === 'VPS not configured') {
        throw error;
      }
      // Force new connection for other errors
      this.sftp = null;
      throw error;
    }
  }

  /**
   * Get cached file list or fetch from SFTP
   */
  private async getCachedFileList(): Promise<any[]> {
    const now = Date.now();
    
    // Return cached files if cache is still valid
    if (this.fileListCache && (now - this.fileListCache.timestamp) < this.CACHE_TTL) {
      return this.fileListCache.files;
    }

    // Fetch fresh file list
    await this.ensureConnection();
    const files = await this.sftp.list(this.remoteBasePath);
    
    // Update cache
    this.fileListCache = {
      files,
      timestamp: now
    };
    
    return files;
  }

  /**
   * Clear file list cache (call after upload/delete operations)
   */
  private clearFileListCache(): void {
    this.fileListCache = null;
    this.metadataCache.clear();
  }

  /**
   * Upload image to Contabo VPS
   */
  async uploadImage(file: any): Promise<ImageMetadata> {
    try {
      await this.ensureConnection();

      // Use original filename with timestamp to avoid conflicts
      const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'); // Sanitize filename
      const timestamp = Date.now();
      const fileExtension = path.extname(sanitizedName);
      const nameWithoutExt = sanitizedName.replace(/\.[^/.]+$/, "");
      const filename = `${nameWithoutExt}_${timestamp}${fileExtension}`;
      const remotePath = `${this.remoteBasePath}/${filename}`;

      // Upload file to VPS
      await this.sftp.put(file.buffer, remotePath);

      // Create metadata
      const metadata: ImageMetadata = {
        id: filename.replace(/\.[^/.]+$/, ""), // Use filename without extension as ID
        filename,
        originalName: file.originalname,
        size: file.size,
        mimeType: file.mimeType,
        uploadDate: new Date(),
        path: remotePath,
        url: `${this.baseUrl}/${filename}`,
        description: undefined,
        category: undefined,
      };

      // Save metadata to local database/file (optional)
      await this.saveImageMetadata(metadata);

      // Clear cache since we added a new file
      this.clearFileListCache();

      this.logger.log(`Image uploaded successfully: ${filename}`);
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
      await this.ensureConnection();

      // Find the image file by ID using cached file list
      const files = await this.getCachedFileList();
      const imageFile = files.find(file => 
        file.type === '-' && 
        file.name.startsWith(imageId) &&
        file.name.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i)
      );
      
      if (!imageFile) {
        throw new HttpException('Image not found', HttpStatus.NOT_FOUND);
      }

      // Delete file from VPS
      const filePath = `${this.remoteBasePath}/${imageFile.name}`;
      await this.sftp.delete(filePath);

      // Remove metadata (placeholder for now)
      await this.deleteImageMetadata(imageId);

      // Clear cache since we deleted a file
      this.clearFileListCache();

      this.logger.log(`Image deleted successfully: ${imageFile.name}`);
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
      // Check if VPS is configured
      const host = this.configService.get('CONTABO_HOST');
      const username = this.configService.get('CONTABO_USERNAME');
      const password = this.configService.get('CONTABO_PASSWORD');
      
      if (!host || !username || !password) {
        throw new HttpException(
          'Image storage service is not configured. Please contact administrator.',
          HttpStatus.SERVICE_UNAVAILABLE
        );
      }

      // Check cache first
      if (this.metadataCache.has(imageId)) {
        return this.metadataCache.get(imageId)!;
      }

      await this.ensureConnection();
      
      // List all files to find the one with matching ID using cached file list
      const files = await this.getCachedFileList();
      const imageFile = files.find(file => 
        file.type === '-' && 
        file.name.startsWith(imageId) &&
        file.name.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i)
      );
      
      if (!imageFile) {
        throw new HttpException('Image not found', HttpStatus.NOT_FOUND);
      }
      
      // Get file stats
      const stats = await this.sftp.stat(`${this.remoteBasePath}/${imageFile.name}`);
      const fileExtension = path.extname(imageFile.name);
      
      const metadata: ImageMetadata = {
        id: imageId,
        filename: imageFile.name,
        originalName: imageFile.name,
        size: stats.size || 0,
        mimeType: this.getMimeType(fileExtension),
        uploadDate: new Date(stats.modifyTime || Date.now()),
        path: `${this.remoteBasePath}/${imageFile.name}`,
        url: `${this.baseUrl}/${imageFile.name}`,
        description: undefined,
        category: undefined,
      };
      
      // Cache the metadata
      this.metadataCache.set(imageId, metadata);
      
      return metadata;
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
      // Check if Contabo VPS is configured
      const host = this.configService.get('CONTABO_HOST');
      const username = this.configService.get('CONTABO_USERNAME');
      const password = this.configService.get('CONTABO_PASSWORD');
      
      if (!host || !username || !password) {
        this.logger.warn('Contabo VPS not configured');
        throw new HttpException(
          'Image storage service is not configured. Please contact administrator.',
          HttpStatus.SERVICE_UNAVAILABLE
        );
      }
      
      await this.ensureConnection();
      
      // Use cached file list
      const files = await this.getCachedFileList();
      
      // Filter for image files
      const imageFiles = files.filter(file => 
        file.type === '-' && // Regular file
        file.name.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i) // Image extension
      );
      
      const images: ImageMetadata[] = [];
      
      // Process files in parallel for better performance
      const metadataPromises = imageFiles.map(async (file) => {
        try {
          // Extract ID from filename (remove extension)
          const fileExtension = path.extname(file.name);
          const id = file.name.replace(fileExtension, '');
          
          // Check if we already have this metadata cached
          if (this.metadataCache.has(id)) {
            return this.metadataCache.get(id)!;
          }
          
          // Get file stats for size
          const stats = await this.sftp.stat(`${this.remoteBasePath}/${file.name}`);
          
          // Create metadata object
          const metadata: ImageMetadata = {
            id,
            filename: file.name,
            originalName: file.name, // We'll use filename as original name for now
            size: stats.size || 0,
            mimeType: this.getMimeType(fileExtension),
            uploadDate: new Date(stats.modifyTime || Date.now()),
            path: `${this.remoteBasePath}/${file.name}`,
            url: `${this.baseUrl}/${file.name}`,
            description: undefined,
            category: undefined,
          };
          
          // Cache the metadata
          this.metadataCache.set(id, metadata);
          
          return metadata;
        } catch (error) {
          this.logger.warn(`Failed to process file ${file.name}:`, error);
          return null; // Return null for failed files
        }
      });
      
      // Wait for all metadata to be processed
      const results = await Promise.all(metadataPromises);
      
      // Filter out null results (failed files)
      const validImages = results.filter((metadata): metadata is ImageMetadata => metadata !== null);
      
      this.logger.log(`Found ${validImages.length} images on VPS`);
      return validImages;
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
    try {
      await this.ensureConnection();

      // Find the image file by ID using cached file list
      const files = await this.getCachedFileList();
      const imageFile = files.find(file => 
        file.type === '-' && 
        file.name.startsWith(imageId) &&
        file.name.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i)
      );
      
      if (!imageFile) {
        throw new HttpException('Image not found', HttpStatus.NOT_FOUND);
      }

      // Download file from VPS
      const filePath = `${this.remoteBasePath}/${imageFile.name}`;
      const fileBuffer = await this.sftp.get(filePath);
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
    // For now, just log it
    this.logger.log('Image metadata saved:', metadata);
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
    this.logger.log('Image metadata deleted:', imageId);
  }

  /**
   * Edit image metadata
   */
  async editImageMetadata(imageId: string, editData: { originalName?: string; description?: string; category?: string }): Promise<ImageMetadata> {
    try {
      // Check if VPS is configured
      const host = this.configService.get('CONTABO_HOST');
      const username = this.configService.get('CONTABO_USERNAME');
      const password = this.configService.get('CONTABO_PASSWORD');
      
      if (!host || !username || !password) {
        throw new HttpException(
          'Image storage service is not configured. Please contact administrator.',
          HttpStatus.SERVICE_UNAVAILABLE
        );
      }

      // Get current metadata
      const currentMetadata = await this.getImage(imageId);
      
      // Update metadata with new values
      const updatedMetadata: ImageMetadata = {
        ...currentMetadata,
        ...editData,
      };

      // Save updated metadata (in a real implementation, this would update a database)
      await this.saveImageMetadata(updatedMetadata);

      // Update cache
      this.metadataCache.set(imageId, updatedMetadata);

      this.logger.log(`Image metadata updated for ${imageId}:`, editData);
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
   * Start keep-alive mechanism to maintain SFTP connection
   */
  private startKeepAlive(): void {
    // Clear existing interval
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }

    // Ping every 30 seconds to keep connection alive
    this.keepAliveInterval = setInterval(async () => {
      try {
        if (this.sftp && this.sftp.isConnected && this.sftp.isConnected()) {
          await this.sftp.list(this.remoteBasePath);
        }
      } catch (error) {
        this.logger.warn('Keep-alive ping failed, connection may be lost:', error);
        // Connection is likely lost, clear the interval
        if (this.keepAliveInterval) {
          clearInterval(this.keepAliveInterval);
          this.keepAliveInterval = null;
        }
      }
    }, 30000); // 30 seconds
  }

  /**
   * Stop keep-alive mechanism
   */
  private stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  /**
   * Cleanup SFTP connection
   */
  async onModuleDestroy() {
    this.stopKeepAlive();
    
    if (this.sftp) {
      try {
        if (typeof this.sftp.end === 'function') {
          await this.sftp.end();
          this.logger.log('SFTP connection closed');
        }
      } catch (error) {
        this.logger.warn('Error during SFTP cleanup on module destroy:', error);
      } finally {
        this.sftp = null;
      }
    }
  }


}
