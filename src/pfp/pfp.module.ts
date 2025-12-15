import { Module } from '@nestjs/common';
import { PfpController } from './pfp.controller';
import { PfpService } from './pfp.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [PfpController],
  providers: [PfpService],
  exports: [PfpService],
})
export class PfpModule {}

