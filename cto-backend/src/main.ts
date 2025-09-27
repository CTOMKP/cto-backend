import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Request, Response } from 'express';

export async function createApp() {
  const app = await NestFactory.create(AppModule);
  
  // Enable CORS
  app.enableCors({
    origin: process.env.NODE_ENV === 'production'
      ? (process.env.CORS_ORIGINS?.split(',') || ['https://ctomemes.xyz'])
      : (process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:8080']),
  });

  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  // Global prefix - MUST be set BEFORE Swagger configuration
  app.setGlobalPrefix('api');

  // Add root-level endpoints for Railway health checks and API info
  const expressApp = app.getHttpAdapter().getInstance();
  
  // Root health check for Railway - Simple check that doesn't depend on DB
  expressApp.get('/health', (req: Request, res: Response) => {
    try {
      res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        version: '1.0.0',
        message: 'CTO Vetting API is running'
      });
    } catch (error) {
      console.error('Health check error:', error);
      res.status(500).json({
        status: 'ERROR',
        timestamp: new Date().toISOString(),
        error: 'Health check failed'
      });
    }
  });

  // API info endpoint
  expressApp.get('/api', (req: Request, res: Response) => {
    res.json({
      message: 'CTO Vetting API',
      version: '1.0.0',
      endpoints: {
        health: '/health',
        auth: '/api/auth/*',
        scan: '/api/scan/*',
        images: '/api/images/*',
        listing: '/api/listing/*'
      },
      documentation: (process.env.ENABLE_SWAGGER === 'true' || process.env.NODE_ENV !== 'production')
        ? '/api/docs'
        : 'Disabled in production'
    });
  });

  // Swagger documentation
  // Allow enabling in production by setting ENABLE_SWAGGER=true
  const enableSwagger = process.env.ENABLE_SWAGGER === 'true' || process.env.NODE_ENV !== 'production';
  if (enableSwagger) {
    const config = new DocumentBuilder()
      .setTitle('CTO Vetting API')
      .setDescription('Backend API for CTO Listing & Scanning with Authentication')
      .setVersion('1.0')
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
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.init();
  return app;
}

// Only run the server if this file is executed directly (not imported)
if (require.main === module) {
  createApp().then(async (app) => {
    const PORT = process.env.PORT || 3001;
    await app.listen(PORT);
    
    console.log(`🚀 CTO Vetting API running on port ${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 Database URL: ${process.env.DATABASE_URL ? 'Connected' : 'Not configured'}`);
    console.log(`🏥 Health check: http://localhost:${PORT}/health`);
    console.log(`📚 API Documentation available at: http://localhost:${PORT}/api/docs`);
  }).catch(error => {
    console.error('❌ Failed to start CTO Vetting API:', error);
    process.exit(1);
  });
}

// Export for Vercel serverless function
let app: INestApplication;

export default async (req: Request, res: Response) => {
  try {
    if (!app) {
      console.log('Creating NestJS app for Vercel...');
      app = await createApp();
    }
    
    const handler = app.getHttpAdapter().getInstance();
    return handler(req, res);
  } catch (error) {
    console.error('Error in Vercel function:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

