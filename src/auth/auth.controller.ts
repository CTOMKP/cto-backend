import { Controller, Post, Get, UseGuards, Request, Body, HttpCode, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { 
  LoginResponseDto, 
  RefreshTokenDto, 
  RefreshTokenResponseDto, 
  LogoutResponseDto, 
  UserResponseDto,
  ErrorResponseDto 
} from './dto/auth-response.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @ApiOperation({
    summary: 'Admin login',
    description: 'Authenticate admin user with email and password to receive JWT tokens'
  })
  @ApiBody({
    type: LoginDto,
    description: 'Admin credentials',
    examples: {
      admin: {
        summary: 'Admin login example',
        value: {
          email: 'admin@ctomemes.xyz',
          password: 'admin123'
        }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    type: LoginResponseDto,
    example: {
      access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      refresh_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      expires_in: 900,
      user: {
        id: 1,
        email: 'admin@ctomemes.xyz'
      }
    }
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid credentials',
    type: ErrorResponseDto,
    example: {
      message: 'Unauthorized',
      statusCode: 401,
      error: 'Unauthorized'
    }
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - validation error',
    type: ErrorResponseDto,
    example: {
      message: ['email must be an email', 'password must be longer than or equal to 6 characters'],
      error: 'Bad Request',
      statusCode: 400
    }
  })
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Request() req, @Body() loginDto: LoginDto) {
    return this.authService.login(req.user);
  }

  @ApiOperation({
    summary: 'Get user profile',
    description: 'Get current authenticated user profile information'
  })
  @ApiBearerAuth('JWT-auth')
  @ApiResponse({
    status: 200,
    description: 'Profile retrieved successfully',
    type: UserResponseDto,
    example: {
      id: 1,
      email: 'admin@ctomemes.xyz'
    }
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT token',
    type: ErrorResponseDto,
    example: {
      message: 'Unauthorized',
      statusCode: 401,
      error: 'Unauthorized'
    }
  })
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@Request() req) {
    return {
      id: req.user.userId,
      email: req.user.email,
    };
  }

  @ApiOperation({
    summary: 'Logout user',
    description: 'Logout current authenticated user (token remains valid until expiration)'
  })
  @ApiBearerAuth('JWT-auth')
  @ApiResponse({
    status: 200,
    description: 'Logout successful',
    type: LogoutResponseDto,
    example: {
      message: 'Logged out successfully'
    }
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT token',
    type: ErrorResponseDto,
    example: {
      message: 'Unauthorized',
      statusCode: 401,
      error: 'Unauthorized'
    }
  })
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout() {
    // In a real app, you might want to blacklist the token
    return { message: 'Logged out successfully' };
  }

  @ApiOperation({
    summary: 'Refresh access token',
    description: 'Get a new access token using a valid refresh token'
  })
  @ApiBody({
    type: RefreshTokenDto,
    description: 'Refresh token request',
    examples: {
      refresh: {
        summary: 'Refresh token example',
        value: {
          refresh_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
        }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Token refreshed successfully',
    type: RefreshTokenResponseDto,
    example: {
      access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      expires_in: 900
    }
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or expired refresh token',
    type: ErrorResponseDto,
    example: {
      message: 'Invalid refresh token',
      statusCode: 401,
      error: 'Unauthorized'
    }
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - missing refresh token',
    type: ErrorResponseDto,
    example: {
      message: ['refresh_token should not be empty'],
      error: 'Bad Request',
      statusCode: 400
    }
  })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshToken(@Body() body: { refresh_token: string }) {
    try {
      const payload = await this.authService.verifyToken(body.refresh_token);
      if (!payload) {
        throw new UnauthorizedException('Invalid refresh token');
      }
      const user = await this.authService.getUserById(payload.sub);
      if (!user) {
        throw new UnauthorizedException('User not found');
      }
      return this.authService.refreshToken(user);
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }
}
