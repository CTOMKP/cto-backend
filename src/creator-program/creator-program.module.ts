import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CreatorProgramService } from './creator-program.service';
import { CreatorProgramController } from './creator-program.controller';

@Module({
  imports: [PrismaModule, NotificationsModule],
  providers: [CreatorProgramService],
  controllers: [CreatorProgramController],
  exports: [CreatorProgramService],
})
export class CreatorProgramModule {}
