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
  id: string;               // typically S3 key or derived id
  filename: string;         // client-provided filename
  originalName: string;     // original stored name (may equal key)
  size: number;             // bytes (0 when unknown pre-upload)
  mimeType: string;         // e.g., image/png
  uploadDate: Date;         // when record created
  path: string;             // storage path or key
  url: string;              // last known view URL (presigned or public)
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
