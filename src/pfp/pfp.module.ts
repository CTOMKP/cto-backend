import { Module } from '@nestjs/common';
import { PfpController } from './pfp.controller';
import { PfpService } from './pfp.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ImageModule } from '../image/image.module';

@Module({
  imports: [AuthModule, PrismaModule, ImageModule],
  controllers: [PfpController],
  providers: [PfpService],
  exports: [PfpService],
})
export class PfpModule {}

