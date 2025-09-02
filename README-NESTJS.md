# CTO Vetting Backend - NestJS Version

This is the **NestJS** version of the CTO Vetting Backend, converted from the original Express.js implementation. This version provides a more structured, enterprise-ready architecture with better TypeScript support, dependency injection, and built-in features.

## 🚀 Features

- **NestJS Framework**: Modern, scalable Node.js framework
- **TypeScript First**: Full TypeScript support with type safety
- **Dependency Injection**: Clean, testable architecture
- **Swagger Documentation**: Automatic API documentation at `/api/docs`
- **Validation**: Request/response validation using class-validator
- **Structured Services**: Organized business logic in dedicated services
- **Comprehensive Error Handling**: Proper HTTP status codes and error messages
- **Health Checks**: Built-in health monitoring endpoints

## 📁 Project Structure

```
src/
├── main.ts                 # Application entry point
├── app.module.ts          # Root application module
├── health/                # Health check endpoints
│   └── health.controller.ts
├── scan/                  # Token scanning functionality
│   ├── scan.module.ts     # Scan module configuration
│   ├── scan.controller.ts # HTTP endpoints for scanning
│   ├── scan.service.ts    # Main scanning orchestration
│   ├── dto/              # Data Transfer Objects
│   │   ├── scan-request.dto.ts
│   │   └── scan-response.dto.ts
│   └── services/         # Individual service components
│       ├── ai-summary.service.ts
│       ├── risk-scoring.service.ts
│       ├── solana-api.service.ts
│       └── tier-classifier.service.ts
```

## 🛠️ Installation & Setup

### Prerequisites
- Node.js 18+ 
- npm or yarn

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Configuration
Copy `.env.example` to `.env` and configure:
```bash
cp env.example .env
```

Required environment variables:
```env
HELIUS_API_KEY=your_helius_api_key_here
NODE_ENV=development
PORT=3001
```

### 3. Development
```bash
# Start development server with hot reload
npm run dev

# Build the application
npm run build

# Start production server
npm start
```

## 📚 API Endpoints

### Health Check
- `GET /api/health` - Application health status
- `GET /health` - Root health check

### Token Scanning
- `POST /api/scan/single` - Scan a single token
- `POST /api/scan/batch` - Scan multiple tokens in batch
- `GET /api/scan/health` - Scan service health
- `GET /api/scan/status` - Scan service status

### API Documentation
- `GET /api/docs` - Swagger UI documentation

## 🔍 Usage Examples

### Single Token Scan
```bash
curl -X POST http://localhost:3001/api/scan/single \
  -H "Content-Type: application/json" \
  -d '{
    "walletAddress": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
  }'
```

### Batch Token Scan
```bash
curl -X POST http://localhost:3001/api/scan/batch \
  -H "Content-Type: application/json" \
  -d '{
    "walletAddresses": [
      "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      "GUy9Tu8YtvvHoL3DcXLJxXvEN8PqEus6mWQUEchcbonk"
    ]
  }'
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:cov

# Run end-to-end tests
npm run test:e2e
```

## 🔧 Configuration

### NestJS Configuration
- **Port**: Default 3001, configurable via `PORT` environment variable
- **CORS**: Configured for development and production origins
- **Rate Limiting**: 100 requests per 15 minutes per IP
- **Validation**: Global validation pipe with whitelist and transformation

### Service Configuration
- **Solana API**: Configurable via environment variables
- **Tier Classification**: Uses `config/tiers.json` for tier criteria
- **Risk Scoring**: Configurable weighting and criteria

## 🚀 Deployment

### Production Build
```bash
npm run build
```

### Environment Variables for Production
```env
NODE_ENV=production
PORT=3001
HELIUS_API_KEY=your_production_helius_key
```

### Docker (Optional)
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
EXPOSE 3001
CMD ["npm", "start"]
```

## 🔄 Migration from Express.js

### What Changed
1. **Architecture**: Express.js → NestJS with modules and dependency injection
2. **File Structure**: Organized into feature modules
3. **Type Safety**: Full TypeScript support with interfaces and DTOs
4. **Validation**: Built-in request/response validation
5. **Documentation**: Automatic Swagger/OpenAPI generation
6. **Testing**: Built-in testing utilities and structure

### What Stayed the Same
1. **Business Logic**: Core scanning algorithms and services
2. **External APIs**: Solana API integrations
3. **Configuration**: Tier classification and risk scoring
4. **Data Models**: Token data structures and analysis

## 📊 Monitoring & Health

### Health Endpoints
- Application health: `/api/health`
- Scan service health: `/api/scan/health`
- Detailed status: `/api/scan/status?detailed=true`

### Logging
- Structured logging using NestJS Logger
- Request/response logging
- Error tracking and monitoring

## 🆘 Troubleshooting

### Common Issues

1. **Port Already in Use**
   ```bash
   # Change port in .env
   PORT=3002
   ```

2. **Missing Environment Variables**
   ```bash
   # Ensure .env file exists and contains required variables
   cp env.example .env
   ```

3. **Build Errors**
   ```bash
   # Clean and rebuild
   rm -rf dist/
   npm run build
   ```

4. **API Key Issues**
   - Verify `HELIUS_API_KEY` is set correctly
   - Check API key permissions and rate limits

### Debug Mode
```bash
# Enable debug logging
DEBUG=* npm run dev
```

## 🤝 Contributing

1. Follow NestJS best practices
2. Use TypeScript for all new code
3. Add proper DTOs for new endpoints
4. Include Swagger documentation
5. Write tests for new functionality

## 📝 License

This project is licensed under the MIT License.

## 🔗 Related Links

- [NestJS Documentation](https://docs.nestjs.com/)
- [TypeScript Documentation](https://www.typescriptlang.org/)
- [Swagger/OpenAPI](https://swagger.io/)
- [Original Express.js Version](./README.md)

