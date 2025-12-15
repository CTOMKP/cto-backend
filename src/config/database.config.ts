import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions, TypeOrmOptionsFactory } from '@nestjs/typeorm';

@Injectable()
export class DatabaseConfig implements TypeOrmOptionsFactory {
  constructor(private configService: ConfigService) {}

  createTypeOrmOptions(): TypeOrmModuleOptions {
    const databaseUrl = this.configService.get('DATABASE_URL');
    
    // If DATABASE_URL is provided, use it directly (for Coolify, Railway, etc.)
    if (databaseUrl) {
      return {
        type: 'postgres',
        url: databaseUrl,
        schema: this.configService.get('DB_SCHEMA', 'public'),
        entities: [__dirname + '/../entities/*.entity{.ts,.js}'],
        synchronize: false,
        logging: this.configService.get('NODE_ENV') === 'development',
        migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
        migrationsRun: false,
        ssl: databaseUrl.includes('sslmode=require') || databaseUrl.includes('ssl=true') 
          ? { rejectUnauthorized: false } 
          : false,
      };
    }
    
    // Fallback to individual connection parameters
    return {
      type: 'postgres',
      host: this.configService.get('DB_HOST'),
      port: parseInt(this.configService.get('DB_PORT') || '5432'),
      username: this.configService.get('DB_USERNAME'),
      password: this.configService.get('DB_PASSWORD'),
      database: this.configService.get('DB_NAME'),
      schema: this.configService.get('DB_SCHEMA', 'public'),
      ssl: this.configService.get('DB_SSL') === 'true' ? { rejectUnauthorized: false } : false,
      entities: [__dirname + '/../entities/*.entity{.ts,.js}'],
      synchronize: false,
      logging: this.configService.get('NODE_ENV') === 'development',
      migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
      migrationsRun: false,
    };
  }
}
