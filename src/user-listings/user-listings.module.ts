import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UserListingsController } from './user-listings.controller';
import { UserListingsService } from './user-listings.service';
import { ScanModule } from '../scan/scan.module';
import { XpModule } from '../xp/xp.module';

@Module({
  imports: [PrismaModule, ScanModule, XpModule],
  controllers: [UserListingsController],
  providers: [UserListingsService],
  exports: [UserListingsService],
})
export class UserListingsModule {}
