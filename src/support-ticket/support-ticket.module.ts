import { Module } from '@nestjs/common';
import { SupportTicketController } from './support-ticket.controller';
import { SupportTicketService } from './support-ticket.service';

@Module({
  controllers: [SupportTicketController],
  providers: [SupportTicketService],
})
export class SupportTicketModule {}

