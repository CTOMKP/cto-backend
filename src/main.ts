import 'reflect-metadata';
import * as crypto from 'crypto';

// Ensure crypto is available globally for NestJS Schedule
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = crypto.webcrypto as any;
}

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Request, Response } from 'express';

export async function createApp() {
  const app = await NestFactory.create(AppModule);
  
  // Enable CORS - Allow all origins for memes (public content)
  app.enableCors({
    origin: true, // Allow all origins since memes are public
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });

  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  // Add root-level endpoints BEFORE setting global prefix
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

  // API info endpoint - BEFORE global prefix
  expressApp.get('/api', (req: Request, res: Response) => {
    res.json({
      message: 'CTO Marketplace API',
      version: '2.0.0',
      features: [
        'Circle Programmable Wallets',
        'Cross-Chain USDC Transfers (CCTP/Wormhole)',
        'Token Swaps (Panora)',
        'Wallet Funding',
        'Token Scanning & Vetting',
        'Project Listings'
      ],
      endpoints: {
        health: '/health',
        auth: '/api/auth/*',
        circle: '/api/circle/*',
        transfers: '/api/transfers/*',
        funding: '/api/funding/*',
        scan: '/api/scan/*',
        images: '/api/images/*',
        listing: '/api/listing/*'
      },
      documentation: (process.env.ENABLE_SWAGGER === 'true' || process.env.NODE_ENV !== 'production')
        ? '/api/docs'
        : 'Disabled in production'
    });
  });

  // Global prefix - MUST be set AFTER custom routes but BEFORE Swagger
  app.setGlobalPrefix('api');

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
        • **Circle Programmable Wallets** - User authentication, wallet management, and custody
        • **Cross-Chain Transfers** - CCTP/Wormhole integration for USDC transfers
        • **Token Swaps** - Panora integration for buying/selling memecoins
        • **Wallet Funding** - Real blockchain funding instructions
        • **Privy Authentication** - Wallet-based authentication with Movement Network support
        • **Traditional Features** - Token scanning, listing, vetting, memes, and waitlist
        
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
          description: 'Enter JWT token obtained from /api/auth/login or /api/auth/privy/sync',
          in: 'header',
        },
        'JWT-auth',
      )
      .addTag('Authentication', 'Traditional email/password authentication')
      .addTag('PrivyAuth', 'Privy wallet-based authentication (MetaMask, WalletConnect, etc.)')
      .addTag('circle', 'Circle Programmable Wallets - User management, wallet creation, balances')
      .addTag('transfers', 'Cross-Chain Transfers - CCTP/Wormhole for USDC movement')
      .addTag('funding', 'Wallet Funding - Deposit instructions and balance management')
      .addTag('Token Scanning', 'Token Scanning & Vetting - Analyze Solana tokens for safety')
      .addTag('Listing', 'Project Listings & Management - Public project listings')
      .addTag('UserListings', 'User-specific listings management')
      .addTag('waitlist', 'Waitlist Management - Join and manage waitlist')
      .addTag('stats', 'Statistics - Memecoin stats from Dune Analytics')
      .addTag('Memes', 'Meme Management - Upload, download, and manage memes')
      .addTag('payment', 'Payment Processing - Payment management')
      .addTag('admin', 'Admin Operations - Administrative endpoints')
      .addTag('Health', 'Health Check - API health and status')
      .addTag('images', 'Image Management - Upload, view, and manage images')
      .addTag('assets', 'Static Assets - Serve static assets from S3/CDN')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true, // Keep auth token after page refresh
        tagsSorter: 'alpha', // Sort tags alphabetically
        operationsSorter: 'alpha', // Sort operations alphabetically
      },
    });
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

