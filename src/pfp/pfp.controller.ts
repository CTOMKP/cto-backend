import { Controller, Post, Body, UseGuards, Request, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { PfpService } from './pfp.service';
import { SavePfpDto } from './dto/save-pfp.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('PFP')
@Controller('pfp')
export class PfpController {
  constructor(private readonly pfpService: PfpService) {}

  @ApiOperation({
    summary: "Get or assign a mascot",
    description:
      "Returns the authenticated user mascot. New assignments use the least-used active design.",
  })
  @ApiBearerAuth("JWT-auth")
  @ApiResponse({
    status: 200,
    description: "Mascot returned successfully",
    schema: {
      type: "object",
      properties: {
        success: { type: "boolean", example: true },
        mascotKey: { type: "string", example: "CTO2" },
        assignedAt: { type: "string", format: "date-time" },
        catalogSize: { type: "number", example: 24 },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: "Unauthorized - invalid or missing JWT token",
  })
  @UseGuards(JwtAuthGuard)
  @Post("assignment")
  @HttpCode(HttpStatus.OK)
  async getOrAssignMascot(@Request() req) {
    const userId = req.user.sub || req.user.userId;
    if (!userId) throw new Error("User ID not found in token");
    return this.pfpService.getOrAssignMascot(Number(userId));
  }


  @ApiOperation({ 
    summary: 'Save profile picture', 
    description: 'Save a profile picture URL to the authenticated user\'s avatarUrl field. This will be used as the user\'s profile picture throughout the platform.' 
  })
  @ApiBearerAuth('JWT-auth')
  @ApiBody({ type: SavePfpDto })
  @ApiResponse({ 
    status: 200, 
    description: 'Profile picture saved successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Profile picture saved successfully' },
        avatarUrl: { type: 'string', example: 'https://example.com/avatar.png' }
      }
    }
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - invalid or missing JWT token' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @UseGuards(JwtAuthGuard)
  @Post('save')
  @HttpCode(HttpStatus.OK)
  async savePfp(@Request() req, @Body() dto: SavePfpDto) {
    const userId = req.user.sub || req.user.userId;
    if (!userId) {
      throw new Error('User ID not found in token');
    }

    return this.pfpService.savePfp(Number(userId), dto.imageUrl);
  }
}

