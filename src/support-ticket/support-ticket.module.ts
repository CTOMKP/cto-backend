import { Module } from '@nestjs/common';
import { SupportTicketController } from './support-ticket.controller';
import { PublicFaucetController } from './public-faucet.controller';
import { SupportTicketService } from './support-ticket.service';

@Module({
  controllers: [SupportTicketController, PublicFaucetController],
  providers: [SupportTicketService],
})
export class SupportTicketModule {}
