import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { SupportTicketService } from './support-ticket.service';

@ApiTags('support')
@Controller('support')
export class SupportTicketController {
  constructor(private readonly supportTicketService: SupportTicketService) {}

  @Post('tickets')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Submit a support ticket' })
  async createTicket(@Req() req: any, @Body() dto: CreateSupportTicketDto) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    const ticket = await this.supportTicketService.create(userId, dto);
    return {
      success: true,
      message: 'Support ticket submitted successfully',
      data: ticket,
    };
  }

  @Get('tickets/mine')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get my submitted support tickets' })
  async getMyTickets(@Req() req: any, @Query('limit') limit?: number) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    const tickets = await this.supportTicketService.listMine(userId, Number(limit) || 20);
    return {
      success: true,
      data: tickets,
    };
  }

  @Get('tickets')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Admin: get all support tickets' })
  async getAllTickets(@Req() req: any, @Query('limit') limit?: number) {
    const role = String(req?.user?.role || '');
    const tickets = await this.supportTicketService.listAll(role, Number(limit) || 50);
    return {
      success: true,
      data: tickets,
    };
  }
}

