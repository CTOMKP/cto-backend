import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';
import * as compression from 'compression';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Use Socket.IO adapter for WebSockets
  try {
    app.useWebSocketAdapter(new IoAdapter(app));
    logger.log('✅ WebSocket adapter (Socket.IO) configured');
  } catch (error) {
    logger.warn('⚠️ Failed to configure WebSocket adapter:', error);
    // App can still run without WebSockets
  }

  // Security middleware
  app.use(helmet());
  app.use(compression());

  // CORS configuration
  // Support both CORS_ORIGIN and CORS_ORIGINS for compatibility
  const corsOrigin = configService.get('CORS_ORIGIN') || configService.get('CORS_ORIGINS') || 'http://localhost:3000,http://localhost:3001';
  const corsOrigins = corsOrigin.split(',').map(origin => origin.trim());
  
  // Ensure development ports are always included in development mode
  if (process.env.NODE_ENV !== 'production') {
    if (!corsOrigins.includes('http://localhost:3001')) corsOrigins.push('http://localhost:3001');
    if (!corsOrigins.includes('http://localhost:3000')) corsOrigins.push('http://localhost:3000');
  }
  app.enableCors({
    origin: corsOrigins,
    credentials: configService.get('CORS_CREDENTIALS', true),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });
  logger.log(`✅ CORS enabled for origins: ${corsOrigins.join(', ')}`);

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global filters and interceptors
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new TransformInterceptor(),
  );

  // Root-level health check endpoint (for Coolify/Railway health checks)
  // This must be simple and fast - no dependencies on Redis/DB
  app.getHttpAdapter().get('/health', (req, res) => {
    res.status(200).json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      version: '1.0.0', // Replace with actual app version if available
    });
  });
  
  // Also add health check at /api/v1/health for consistency
  app.getHttpAdapter().get('/api/v1/health', (req, res) => {
    res.status(200).json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      version: '1.0.0',
    });
  });

  // API prefix
  const apiPrefix = configService.get('API_PREFIX', 'api');
  const apiVersion = configService.get('API_VERSION', 'v1');
  app.setGlobalPrefix(`${apiPrefix}/${apiVersion}`);

  // Swagger documentation
  // Allow enabling in production by setting ENABLE_SWAGGER=true
  const enableSwagger = process.env.ENABLE_SWAGGER === 'true' || process.env.NODE_ENV !== 'production';
  if (enableSwagger) {
    // Get API base URL from environment or use default
    // Priorities: APP_URL -> BACKEND_BASE_URL -> Default
    const apiBaseUrl = configService.get('APP_URL') || configService.get('BACKEND_BASE_URL') || 'https://api.ctomarketplace.com';
    
    const config = new DocumentBuilder()
      .setTitle('CTO Marketplace API')
      .setDescription(`
        Complete CTO Marketplace Backend API with:
        • **Token Vetting System** - Comprehensive token data fetching and risk assessment
        • **n8n Integration** - Automated workflow for token vetting and monitoring
        • **Token Image Service** - 3-tier fallback for token images (Jupiter → TrustWallet → Identicon)
        • **Real-time Monitoring** - Token monitoring and alerts
        
        **Base URL**: ${apiBaseUrl}
        
        **Authentication**: Most endpoints require JWT Bearer token. Click "Authorize" button above to add your token.
      `)
      .setVersion('2.0')
      .addServer(apiBaseUrl, 'Production API')
      .addServer('http://localhost:3001', 'Local Development')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'JWT',
          description: 'Enter JWT token',
          in: 'header',
        },
        'JWT-auth',
      )
      .addTag('tokens', 'Token management and listing')
      .addTag('vetting', 'Token vetting and risk assessment')
      .addTag('monitoring', 'Token monitoring and alerts')
      .addTag('users', 'User management')
      .addTag('analytics', 'Analytics and reporting')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
      swaggerOptions: {
        persistAuthorization: true, // Keep auth token after page refresh
        tagsSorter: 'alpha', // Sort tags alphabetically
        operationsSorter: 'alpha', // Sort operations alphabetically
      },
    });
  }

  const port = configService.get('PORT', 3001);
  await app.listen(port);

  logger.log(`🚀 CTOMarketplace API is running on: http://localhost:${port}`);
  logger.log(`📚 API Documentation: http://localhost:${port}/${apiPrefix}/docs`);
  logger.log(`🌍 Environment: ${configService.get('NODE_ENV', 'development')}`);
}

bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
