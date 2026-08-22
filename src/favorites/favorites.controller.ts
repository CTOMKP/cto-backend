import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FavoriteTargetType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateFavoriteDto } from './dto/create-favorite.dto';
import { FavoritesService } from './favorites.service';

@ApiTags('favorites')
@Controller('favorites')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  @ApiOperation({ summary: 'List favorites owned by the current user' })
  async list(@Req() req: any, @Query('type') type?: FavoriteTargetType) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    if (type && !Object.values(FavoriteTargetType).includes(type)) {
      throw new BadRequestException('Invalid favorite target type');
    }
    return this.favoritesService.list(userId, type);
  }

  @Post()
  @ApiOperation({ summary: 'Add an account-persistent favorite' })
  async add(@Req() req: any, @Body() dto: CreateFavoriteDto) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    return this.favoritesService.add(userId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a favorite owned by the current user' })
  async remove(@Req() req: any, @Param('id') id: string) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    return this.favoritesService.remove(userId, id);
  }
}
