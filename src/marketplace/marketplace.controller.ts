import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MarketplaceService } from './marketplace.service';
import { CreateMarketplaceAdDto } from './dto/create-marketplace-ad.dto';
import { UpdateMarketplaceAdDto } from './dto/update-marketplace-ad.dto';
import { VerifyMarketplacePaymentDto } from './dto/marketplace-payment.dto';

@ApiTags('marketplace')
@Controller('marketplace')
export class MarketplaceController {
  constructor(
    private readonly marketplaceService: MarketplaceService,
  ) {}

  @Get('pricing')
  @ApiOperation({ summary: 'Get marketplace pricing table' })
  @ApiResponse({
    status: 200,
    description: 'Pricing table retrieved',
    schema: {
      example: {
        success: true,
        listingFeeUsd: 5,
        extensionFeeUsd: 2,
      },
    },
  })
  async getPricing() {
    return this.marketplaceService.getPricing();
  }

  @Get('ads')
  @ApiOperation({ summary: 'List published marketplace ads' })
  @ApiResponse({
    status: 200,
    description: 'Published ads retrieved',
    schema: {
      example: {
        success: true,
        data: {
          items: [
            {
              id: 'cmo50d96i00d6hjmc7o4mwq6b',
              title: 'Graphic support',
              status: 'PUBLISHED',
              category: 'SERVICES',
            },
          ],
          page: 1,
          limit: 20,
          total: 1,
        },
      },
    },
  })
  async listPublic(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('category') category?: string,
    @Query('subCategory') subCategory?: string,
    @Query('sort') sort?: string,
  ) {
    const baseParams = {
      page: Number(page) || 1,
      limit: Number(limit) || 20,
      category,
      subCategory,
    };
    if (sort === 'trending') {
      return this.marketplaceService.listTrending(baseParams);
    }
    return this.marketplaceService.listPublic(baseParams);
  }

  @Get('ads/trending')
  @ApiOperation({ summary: 'List trending marketplace ads' })
  @ApiResponse({ status: 200, description: 'Trending ads retrieved' })
  async listTrending(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.marketplaceService.listTrending({
      page: Number(page) || 1,
      limit: Number(limit) || 20,
    });
  }

  @Get('ads/for-you')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'List personalized marketplace ads' })
  @ApiResponse({ status: 200, description: 'Personalized ads retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async listForYou(@Req() req: any, @Query('page') page = 1, @Query('limit') limit = 20) {
    const userId = req?.user?.userId || req?.user?.sub;
    return this.marketplaceService.listForYou(Number(userId), {
      page: Number(page) || 1,
      limit: Number(limit) || 20,
    });
  }

  @Post('ads')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create a marketplace ad draft' })
  @ApiResponse({
    status: 201,
    description: 'Marketplace ad draft created',
    schema: {
      example: {
        success: true,
        data: {
          id: 'cmo50d96i00d6hjmc7o4mwq6b',
          status: 'DRAFT',
          title: 'Graphic support',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createDraft(@Body() dto: CreateMarketplaceAdDto, @Req() req: any) {
    const userId = req?.user?.userId || req?.user?.sub;
    const email = req?.user?.email;
    return this.marketplaceService.createDraft(userId, dto, email);
  }

  @Put('ads/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update a marketplace ad draft' })
  @ApiResponse({ status: 200, description: 'Marketplace ad draft updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Draft not found' })
  async updateDraft(@Param('id') id: string, @Body() dto: UpdateMarketplaceAdDto, @Req() req: any) {
    const userId = req?.user?.userId || req?.user?.sub;
    const email = req?.user?.email;
    return this.marketplaceService.updateDraft(userId, id, dto, email);
  }

  @Get('ads/mine')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'List current user marketplace ads' })
  @ApiResponse({ status: 200, description: 'Current user marketplace ads retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async listMine(@Req() req: any) {
    const userId = req?.user?.userId || req?.user?.sub;
    const email = req?.user?.email;
    return this.marketplaceService.listMine(userId, email);
  }

  @Get('ads/:id')
  @ApiOperation({ summary: 'Get a published marketplace ad' })
  @ApiResponse({ status: 200, description: 'Published marketplace ad retrieved' })
  @ApiResponse({ status: 404, description: 'Marketplace ad not found' })
  async getPublicAd(@Param('id') id: string) {
    const ad = await this.marketplaceService.getPublicAd(id);
    try {
      await this.marketplaceService.recordInteraction(id, 'VIEW');
    } catch {
      // ignore tracking errors
    }
    return ad;
  }

  @Post('ads/:id/pay')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create payment for a marketplace ad' })
  @ApiResponse({
    status: 201,
    description: 'Marketplace payment created',
    schema: {
      example: {
        success: true,
        data: {
          paymentId: 'cmo50pay0001',
          amount: '5.00',
          currency: 'USDC',
          paymentChain: 'SOLANA',
          status: 'PENDING',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 400, description: 'Invalid request or ad state' })
  async createPayment(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body?: { paymentChain?: 'MOVEMENT' | 'SOLANA' },
  ) {
    const userId = req?.user?.userId || req?.user?.sub;
    const email = req?.user?.email;
    return this.marketplaceService.createPayment(userId, id, email, body?.paymentChain);
  }

  @Post('ads/payments/:paymentId/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Verify marketplace ad payment (Movement/Solana USDC)' })
  @ApiResponse({
    status: 200,
    description: 'Marketplace payment verified',
    schema: {
      example: {
        success: true,
        data: {
          paymentId: 'cmo50pay0001',
          txHash: '5v8t...9ab',
          status: 'COMPLETED',
          adStatus: 'PUBLISHED',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid transaction hash or payment state' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async verifyPayment(
    @Param('paymentId') paymentId: string,
    @Body() dto: VerifyMarketplacePaymentDto,
  ) {
    return this.marketplaceService.verifyPayment(paymentId, dto.txHash);
  }

  @Post('ads/:id/extend')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Extend a marketplace ad (free or paid)' })
  @ApiResponse({ status: 200, description: 'Marketplace ad extended' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async extendAd(@Param('id') id: string, @Req() req: any) {
    const userId = req?.user?.userId || req?.user?.sub;
    const email = req?.user?.email;
    return this.marketplaceService.extendAd(userId, id, email);
  }

  @Post('ads/:id/sold')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Mark a marketplace ad as sold' })
  @ApiResponse({ status: 200, description: 'Marketplace ad marked as sold' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async markSold(@Param('id') id: string, @Req() req: any) {
    const userId = req?.user?.userId || req?.user?.sub;
    const email = req?.user?.email;
    return this.marketplaceService.markSold(userId, id, email);
  }

  @Post('ads/:id/share')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Record share event for XP' })
  @ApiResponse({
    status: 200,
    description: 'Share interaction recorded',
    schema: { example: { success: true } },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async shareAd(@Param('id') id: string, @Req() req: any) {
    const userId = req?.user?.userId || req?.user?.sub;
    await this.marketplaceService.recordInteraction(id, 'SHARE', Number(userId));
    return { success: true };
  }
}
