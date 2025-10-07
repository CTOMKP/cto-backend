export interface UploadedImageFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
  destination?: string;
  filename?: string;
  path?: string;
}

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
  // S3/Storage specific (optional)
  storageProvider?: string; // e.g., 's3'
  storageKey?: string;      // S3 object key
  userId?: string;          // owner user id (when applicable)
  projectId?: string;       // owner project id (when applicable)
}

export interface EditImageData {
  filename?: string;
  description?: string;
  category?: string;
}

export interface CacheRefreshResult {
  success: boolean;
  message: string;
  count: number;
}

export interface UrlUpdateResult {
  success: boolean;
  message: string;
  updatedCount: number;
}
