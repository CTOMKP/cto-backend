const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { ValidationPipe } = require('@nestjs/common');

let app;

async function bootstrap() {
  if (!app) {
    app = await NestFactory.create(AppModule);
    
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
  }
  return app;
}

module.exports = async (req, res) => {
  const app = await bootstrap();
  const handler = app.getHttpAdapter().getInstance();
  return handler(req, res);
};
