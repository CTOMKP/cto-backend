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
  async getPricing() {
    return this.marketplaceService.getPricing();
  }

  @Get('ads')
  @ApiOperation({ summary: 'List published marketplace ads' })
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
  async createDraft(@Body() dto: CreateMarketplaceAdDto, @Req() req: any) {
    const userId = req?.user?.userId || req?.user?.sub;
    const email = req?.user?.email;
    return this.marketplaceService.createDraft(userId, dto, email);
  }

  @Put('ads/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update a marketplace ad draft' })
  async updateDraft(@Param('id') id: string, @Body() dto: UpdateMarketplaceAdDto, @Req() req: any) {
    const userId = req?.user?.userId || req?.user?.sub;
    const email = req?.user?.email;
    return this.marketplaceService.updateDraft(userId, id, dto, email);
  }

  @Get('ads/mine')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'List current user marketplace ads' })
  async listMine(@Req() req: any) {
    const userId = req?.user?.userId || req?.user?.sub;
    const email = req?.user?.email;
    return this.marketplaceService.listMine(userId, email);
  }

  @Get('ads/:id')
  @ApiOperation({ summary: 'Get a published marketplace ad' })
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
  async createPayment(@Param('id') id: string, @Req() req: any) {
    const userId = req?.user?.userId || req?.user?.sub;
    const email = req?.user?.email;
    return this.marketplaceService.createPayment(userId, id, email);
  }

  @Post('ads/payments/:paymentId/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Verify marketplace ad payment (Movement/Solana USDC)' })
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
  async extendAd(@Param('id') id: string, @Req() req: any) {
    const userId = req?.user?.userId || req?.user?.sub;
    const email = req?.user?.email;
    return this.marketplaceService.extendAd(userId, id, email);
  }

  @Post('ads/:id/sold')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Mark a marketplace ad as sold' })
  async markSold(@Param('id') id: string, @Req() req: any) {
    const userId = req?.user?.userId || req?.user?.sub;
    const email = req?.user?.email;
    return this.marketplaceService.markSold(userId, id, email);
  }

  @Post('ads/:id/share')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Record share event for XP' })
  async shareAd(@Param('id') id: string, @Req() req: any) {
    const userId = req?.user?.userId || req?.user?.sub;
    await this.marketplaceService.recordInteraction(id, 'SHARE', Number(userId));
    return { success: true };
  }
}
