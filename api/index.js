// Create NestJS app directly for Vercel
const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { DocumentBuilder, SwaggerModule } = require('@nestjs/swagger');

let app;

async function createApp() {
  if (!app) {
    console.log('Creating NestJS app for Vercel...');
    console.log('Environment:', process.env.NODE_ENV);
    console.log('Available env vars:', Object.keys(process.env).filter(key => key.includes('JWT') || key.includes('ADMIN')));
    
    try {
      // Import AppModule with error handling
      const { AppModule } = require('../dist/app.module');
      console.log('AppModule imported successfully');
      
      app = await NestFactory.create(AppModule);
      console.log('NestJS app created successfully');
    } catch (importError) {
      console.error('Failed to import AppModule:', importError);
      throw importError;
    }
    
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

    // Global prefix
    app.setGlobalPrefix('api');

    // Swagger documentation
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

    await app.init();
    console.log('NestJS app created successfully for Vercel');
  }
  
  return app;
}

module.exports = async (req, res) => {
  try {
    console.log('Vercel function called:', req.method, req.url);
    console.log('Request headers:', req.headers);
    
    const app = await createApp();
    
    // Get the Express app instance
    const handler = app.getHttpAdapter().getInstance();
    return handler(req, res);
  } catch (error) {
    console.error('Error in Vercel function:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    // Ensure response is sent
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Internal server error',
        message: error.message,
        timestamp: new Date().toISOString(),
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }
};
