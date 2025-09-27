# Image Management System for Contabo VPS

This module provides a complete image management system that allows you to upload, store, retrieve, and delete images on your Contabo VPS. It's completely separate from the token analysis functionality.

## 🚀 Features

- **Upload Images**: Upload images to Contabo VPS via SFTP
- **Download Images**: Retrieve images from VPS
- **Delete Images**: Remove images from VPS
- **List Images**: Get metadata for all stored images
- **Health Check**: Monitor service status

## 📋 Prerequisites

1. **Contabo VPS** with SSH/SFTP access
2. **Web server** (Apache/Nginx) configured on VPS
3. **Environment variables** configured in your `.env` file

## ⚙️ Configuration

### Environment Variables

Add these to your `.env` file:

```bash
# Contabo VPS Configuration
CONTABO_HOST=your_vps_ip_address
CONTABO_PORT=22
CONTABO_USERNAME=your_username
CONTABO_PASSWORD=your_password

# Alternative: Use private key authentication
# CONTABO_PRIVATE_KEY_PATH=/path/to/private/key

# Image storage paths
CONTABO_IMAGE_PATH=/var/www/html/images
CONTABO_BASE_URL=https://your-domain.com/images
```

### VPS Setup

1. **Create images directory**:
   ```bash
   ssh your_username@your_vps_ip
   sudo mkdir -p /var/www/html/images
   sudo chown your_username:your_username /var/www/html/images
   sudo chmod 755 /var/www/html/images
   ```

2. **Configure web server** to serve images from `/var/www/html/images`

## 🔌 API Endpoints

### Upload Image
```http
POST /images/upload
Content-Type: multipart/form-data

Body: form-data with 'image' field
```

**Response:**
```json
{
  "id": "uuid-here",
  "filename": "uuid-here.jpg",
  "originalName": "my-image.jpg",
  "size": 1024000,
  "mimeType": "image/jpeg",
  "uploadDate": "2025-02-09T10:00:00.000Z",
  "path": "/var/www/html/images/uuid-here.jpg",
  "url": "https://your-domain.com/images/uuid-here.jpg"
}
```

### Get Image Metadata
```http
GET /images/:id
```

### Download Image
```http
GET /images/:id/download
```

### List All Images
```http
GET /images
```

### Delete Image
```http
DELETE /images/:id
```

### Health Check
```http
GET /images/health/status
```

## 📁 File Structure

```
src/
├── image/
│   ├── image.module.ts      # Module configuration
│   ├── image.service.ts     # Business logic & SFTP operations
│   ├── image.controller.ts  # HTTP endpoints
│   └── dto/
│       └── upload-image.dto.ts  # Data transfer objects
```

## 🔧 Usage Examples

### Upload Image (JavaScript/Fetch)
```javascript
const formData = new FormData();
formData.append('image', fileInput.files[0]);

const response = await fetch('/images/upload', {
  method: 'POST',
  body: formData
});

const result = await response.json();
console.log('Image uploaded:', result.url);
```

### Upload Image (cURL)
```bash
curl -X POST http://localhost:3001/images/upload \
  -F "image=@/path/to/your/image.jpg"
```

### Download Image
```javascript
const response = await fetch(`/images/${imageId}/download`);
const blob = await response.blob();
const url = window.URL.createObjectURL(blob);
// Use the URL to display or download the image
```

## 🛡️ Security Features

- **File type validation**: Only image files allowed
- **File size limits**: 10MB maximum file size
- **Unique filenames**: UUID-based naming prevents conflicts
- **SFTP authentication**: Secure connection to VPS

## 🔄 File Flow

1. **Upload**: Client → NestJS → SFTP → Contabo VPS
2. **Download**: Contabo VPS → SFTP → NestJS → Client
3. **Delete**: NestJS → SFTP → Remove from VPS

## 📊 Monitoring

The service includes:
- **Logging**: All operations are logged
- **Error handling**: Comprehensive error responses
- **Health checks**: Service status monitoring
- **Connection management**: Automatic SFTP reconnection

## 🚨 Troubleshooting

### Common Issues

1. **Connection Failed**
   - Check VPS IP, username, and password
   - Verify SSH/SFTP is enabled on VPS
   - Check firewall settings

2. **Permission Denied**
   - Ensure VPS user has write access to images directory
   - Check directory permissions

3. **File Not Found**
   - Verify image ID exists
   - Check if file was deleted from VPS

### Debug Mode

Enable detailed logging by setting:
```bash
NODE_ENV=development
```

## 🔮 Future Enhancements

- **Image resizing** and optimization
- **Thumbnail generation**
- **Image metadata database** storage
- **CDN integration**
- **Image compression**
- **Batch upload/download**

## 📝 Notes

- Images are stored with UUID filenames for security
- Original filenames are preserved in metadata
- SFTP connections are managed automatically
- Service gracefully handles connection failures
- All operations are asynchronous and non-blocking

## 🤝 Support

For issues or questions:
1. Check the logs for detailed error messages
2. Verify your VPS configuration
3. Ensure all environment variables are set correctly
4. Test SFTP connection manually first
