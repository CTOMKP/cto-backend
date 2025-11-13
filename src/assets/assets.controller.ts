import { Controller, Get, Param, Res, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';

@ApiTags('assets')
@Controller('assets')
export class AssetsController {
  constructor(private readonly config: ConfigService) {}

  @Get('*path')
  @ApiOperation({ summary: 'Serve static assets from S3/CDN' })
  @ApiParam({ name: 'path', description: 'Asset path (e.g., logo.png, icons/icon.svg)' })
  @ApiResponse({ status: 302, description: 'Redirects to S3/CDN URL' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  async serveAsset(@Param('path') pathParam: string, @Res() res: Response) {
    try {
      const region = this.config.get<string>('AWS_REGION', 'eu-north-1');
      const bucket = this.config.get<string>('AWS_S3_BUCKET_NAME', '');
      const cdn = this.config.get<string>('ASSETS_CDN_BASE');
      const key = `assets/${pathParam}`;
      const base = cdn?.replace(/\/+$/, '') || `https://${bucket}.s3.${region}.amazonaws.com`;
      const url = `${base}/${encodeURI(key)}`;
      res.set({ 'Cache-Control': 'public, max-age=31536000, immutable' }).redirect(url);
    } catch {
      res.status(HttpStatus.NOT_FOUND).json({ message: 'Asset not found' });
    }
  }
}