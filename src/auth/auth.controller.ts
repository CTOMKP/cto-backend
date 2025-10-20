import { Controller, Post, Get, UseGuards, Request, Body, HttpCode, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { 
  LoginResponseDto, 
  RefreshTokenDto, 
  RefreshTokenResponseDto, 
  LogoutResponseDto, 
  UserResponseDto,
  ErrorResponseDto 
} from './dto/auth-response.dto';
import { RegisterResponseDto } from './dto/register-response.dto';
import { GoogleLoginDto } from './dto/google-login.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @ApiOperation({ summary: 'Register user', description: 'Create a new account with email and password' })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 201, description: 'User registered', type: RegisterResponseDto })
  @ApiResponse({ status: 400, description: 'Validation or duplicate email', type: ErrorResponseDto })
  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<RegisterResponseDto> {
    const user = await this.authService.register({
      email: dto.email,
      password: dto.password,
      name: dto.name,
    });
    return { id: user.id, name: user.name ?? null, email: user.email, createdAt: user.createdAt.toISOString() };
  }

  @ApiOperation({ summary: 'Login', description: 'Authenticate with email and password to receive JWTs' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: 'Login successful', type: LoginResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials', type: ErrorResponseDto })
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Request() req, @Body() loginDto: LoginDto) {
    return this.authService.login(req.user);
  }

  @ApiOperation({ summary: 'Google OAuth login', description: 'Exchange Google account for backend-issued JWT' })
  @ApiBody({ type: GoogleLoginDto })
  @ApiResponse({ status: 200, description: 'Login successful', type: LoginResponseDto })
  @Post('google-login')
  @HttpCode(HttpStatus.OK)
  async googleLogin(@Body() body: GoogleLoginDto) {
    return this.authService.loginOrCreateGoogle(body.email, body.providerId);
  }

  @ApiOperation({ summary: 'Get user profile', description: 'Get current authenticated user profile information' })
  @ApiBearerAuth('JWT-auth')
  @ApiResponse({ status: 200, description: 'Profile retrieved successfully', type: UserResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized - invalid or missing JWT token', type: ErrorResponseDto })
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@Request() req) {
    return { id: req.user.userId, email: req.user.email };
  }

  @ApiOperation({ summary: 'Logout user', description: 'Logout current authenticated user (token remains valid until expiration)' })
  @ApiBearerAuth('JWT-auth')
  @ApiResponse({ status: 200, description: 'Logout successful', type: LogoutResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized - invalid or missing JWT token', type: ErrorResponseDto })
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout() {
    return { message: 'Logged out successfully' };
  }

  @ApiOperation({ summary: 'Refresh access token', description: 'Get a new access token using current JWT' })
  @ApiBearerAuth('JWT-auth')
  @ApiResponse({ status: 200, description: 'Token refreshed successfully', type: RefreshTokenResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid or expired token', type: ErrorResponseDto })
  @UseGuards(JwtAuthGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshToken(@Request() req) {
    try {
      const user = await this.authService.getUserById(req.user.sub);
      if (!user) throw new UnauthorizedException('User not found');
      return this.authService.refreshToken(user);
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
