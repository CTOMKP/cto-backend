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
      ? process.env.CORS_ORIGINS?.split(',') || ['https://ctomemes.xyz']
      : process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173', 'http://localhost:3000']
  });

  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  // Global prefix - MUST be set BEFORE Swagger configuration
  app.setGlobalPrefix('api');

  // Add a simple API info endpoint for production
  if (process.env.NODE_ENV === 'production') {
    app.getHttpAdapter().getInstance().get('/api', (req: Request, res: Response) => {
      res.json({
        message: 'CTO Vetting API',
        version: '1.0.0',
        endpoints: {
          health: '/api/health',
          auth: '/api/auth/*',
          scan: '/api/scan/*',
          images: '/api/images/*'
        },
        documentation: 'Available in development mode only'
      });
    });
  }

  // Swagger documentation (only in development)
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('CTO Vetting API')
      .setDescription('Backend API for CTO Marketplace Solana Vetting System with Authentication')
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
    console.log(`📚 API Documentation available at: http://localhost:${PORT}/api/docs`);
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

