import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Global module to expose PrismaService across the app without repeated imports
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}