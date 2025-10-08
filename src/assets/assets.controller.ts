import { Controller, Get, Param, Res, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';

@Controller('assets')
export class AssetsController {
  constructor(private readonly config: ConfigService) {}

  @Get('*path')
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