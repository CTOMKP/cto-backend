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

  // Use Socket.IO adapter for WebSockets
  app.useWebSocketAdapter(new IoAdapter(app));

  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Security middleware
  app.use(helmet());
  app.use(compression());

  // CORS configuration
  const corsOrigins = configService.get('CORS_ORIGIN', 'http://localhost:3000').split(',');
  app.enableCors({
    origin: corsOrigins,
    credentials: configService.get('CORS_CREDENTIALS', true),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

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
  app.getHttpAdapter().get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
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
    const apiBaseUrl = process.env.APP_URL || process.env.BACKEND_BASE_URL || 'https://api.ctomarketplace.com';
    
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
