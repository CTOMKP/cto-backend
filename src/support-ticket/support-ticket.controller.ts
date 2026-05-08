import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { FaucetRequestDto } from './dto/faucet-request.dto';
import { SupportTicketService } from './support-ticket.service';

@ApiTags('support')
@Controller('support')
export class SupportTicketController {
  constructor(private readonly supportTicketService: SupportTicketService) {}

  @Post('tickets')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Submit a support ticket' })
  @ApiResponse({
    status: 201,
    description: 'Support ticket submitted successfully',
    schema: {
      example: {
        success: true,
        message: 'Support ticket submitted successfully',
        data: {
          id: 'cmo4ts3hy008w7o8q705033nc',
          subject: 'My payment cancelled',
          description: 'My payment cancelled.',
          status: 'OPEN',
          category: 'PAYMENT',
          priority: 'NORMAL',
          createdAt: '2026-04-18T21:04:30.647Z',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createTicket(@Req() req: any, @Body() dto: CreateSupportTicketDto) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    const ticket = await this.supportTicketService.create(userId, dto);
    return {
      success: true,
      message: 'Support ticket submitted successfully',
      data: ticket,
    };
  }

  @Post('faucet/solana-usdc')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Apply for custom Solana USDC faucet' })
  @ApiResponse({
    status: 201,
    description: 'Faucet disbursed',
  })
  @ApiResponse({
    status: 200,
    description: 'Duplicate open request blocked',
  })
  async applyFaucet(@Req() req: any, @Body() dto: FaucetRequestDto) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    const result = await this.supportTicketService.createFaucetRequest(userId, dto);

    if (result.blocked) {
      return {
        success: false,
        message: 'You already have an open faucet request in the last 24 hours.',
        data: result.ticket,
      };
    }

    return {
      success: true,
      message: 'Faucet disbursed successfully.',
      data: {
        ticket: result.ticket,
        disbursement: result.disbursement,
      },
    };
  }

  @Get('tickets/mine')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get my submitted support tickets' })
  @ApiResponse({
    status: 200,
    description: 'User support tickets retrieved',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'cmo4ts3hy008w7o8q705033nc',
            subject: 'My payment cancelled',
            status: 'OPEN',
            category: 'PAYMENT',
            priority: 'NORMAL',
            createdAt: '2026-04-18T21:04:30.647Z',
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
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
  @ApiResponse({
    status: 200,
    description: 'All support tickets retrieved (admin)',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'cmo4ts3hy008w7o8q705033nc',
            subject: 'My payment cancelled',
            status: 'OPEN',
            category: 'PAYMENT',
            priority: 'NORMAL',
            userId: 42,
            createdAt: '2026-04-18T21:04:30.647Z',
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  async getAllTickets(@Req() req: any, @Query('limit') limit?: number) {
    const role = String(req?.user?.role || '');
    const tickets = await this.supportTicketService.listAll(role, Number(limit) || 50);
    return {
      success: true,
      data: tickets,
    };
  }
}
