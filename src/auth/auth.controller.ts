import { Controller, Post, Get, Put, UseGuards, Request, Body, HttpCode, HttpStatus, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateUserDto } from './dto/update-user.dto';
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

  @ApiOperation({ summary: 'Get user profile', description: 'Get current authenticated user profile information including registration date and account age' })
  @ApiBearerAuth('JWT-auth')
  @ApiResponse({ status: 200, description: 'Profile retrieved successfully', type: UserResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized - invalid or missing JWT token', type: ErrorResponseDto })
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@Request() req) {
    const userId = req.user.sub || req.user.userId;
    const user = await this.authService.getUserById(userId);
    
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Calculate account age
    const registrationDate = user.createdAt;
    const now = new Date();
    const ageInMs = now.getTime() - registrationDate.getTime();
    const ageInDays = Math.floor(ageInMs / (1000 * 60 * 60 * 24));
    
    // Format account age
    let accountAge: string;
    if (ageInDays < 1) {
      const ageInHours = Math.floor(ageInMs / (1000 * 60 * 60));
      accountAge = ageInHours < 1 
        ? 'Less than 1 hour' 
        : `${ageInHours} ${ageInHours === 1 ? 'hour' : 'hours'}`;
    } else if (ageInDays < 30) {
      accountAge = `${ageInDays} ${ageInDays === 1 ? 'day' : 'days'}`;
    } else if (ageInDays < 365) {
      const months = Math.floor(ageInDays / 30);
      accountAge = `${months} ${months === 1 ? 'month' : 'months'}`;
    } else {
      const years = Math.floor(ageInDays / 365);
      const remainingDays = ageInDays % 365;
      if (remainingDays === 0) {
        accountAge = `${years} ${years === 1 ? 'year' : 'years'}`;
      } else {
        accountAge = `${years} ${years === 1 ? 'year' : 'years'}, ${remainingDays} ${remainingDays === 1 ? 'day' : 'days'}`;
      }
    }

    return { 
      id: user.id, 
      email: user.email,
      avatarUrl: user.avatarUrl || null,
      name: user.name || null,
      bio: user.bio || null,
      createdAt: user.createdAt.toISOString(),
      accountAgeDays: ageInDays,
      accountAge,
    };
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

  @ApiOperation({ summary: 'Update user profile', description: 'Update authenticated user profile information (name, avatarUrl, bio)' })
  @ApiBearerAuth('JWT-auth')
  @ApiBody({ type: UpdateUserDto })
  @ApiResponse({ status: 200, description: 'Profile updated successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized - invalid or missing JWT token', type: ErrorResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input data', type: ErrorResponseDto })
  @UseGuards(JwtAuthGuard)
  @Put('users/me')
  @HttpCode(HttpStatus.OK)
  async updateProfile(@Request() req, @Body() dto: UpdateUserDto) {
    try {
      const userId = req.user.sub || req.user.userId;
      if (!userId) {
        throw new UnauthorizedException('User ID not found in token');
      }

      const updatedUser = await this.authService.updateUser(Number(userId), dto);
      const { passwordHash, ...safeUser } = updatedUser as any;

      return {
        success: true,
        message: 'Profile updated successfully',
        user: safeUser,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new BadRequestException(`Failed to update profile: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
