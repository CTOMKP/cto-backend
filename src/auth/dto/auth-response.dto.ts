import { ApiProperty } from '@nestjs/swagger';

export class UserResponseDto {
  @ApiProperty({
    description: 'User ID',
    example: 1,
    type: 'number'
  })
  id: number;

  @ApiProperty({
    description: 'User email address',
    example: 'admin@ctomemes.xyz',
    type: 'string',
    format: 'email'
  })
  email: string;

  @ApiProperty({
    description: 'User name',
    example: 'John Doe',
    type: 'string',
    nullable: true
  })
  name?: string | null;

  @ApiProperty({
    description: 'User avatar URL',
    example: 'https://example.com/avatar.jpg',
    type: 'string',
    nullable: true
  })
  avatarUrl?: string | null;

  @ApiProperty({
    description: 'User bio',
    example: 'Crypto enthusiast',
    type: 'string',
    nullable: true
  })
  bio?: string | null;

  @ApiProperty({
    description: 'Account registration date (ISO string)',
    example: '2025-01-01T12:00:00.000Z',
    type: 'string'
  })
  createdAt: string;

  @ApiProperty({
    description: 'Account age in days',
    example: 45,
    type: 'number'
  })
  accountAgeDays: number;

  @ApiProperty({
    description: 'Account age formatted string (e.g., "45 days", "2 months", "1 year")',
    example: '45 days',
    type: 'string'
  })
  accountAge: string;
}

export class LoginResponseDto {
  @ApiProperty({
    description: 'JWT access token for API authentication',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    type: 'string'
  })
  access_token: string;

  @ApiProperty({
    description: 'JWT refresh token for getting new access tokens',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    type: 'string'
  })
  refresh_token: string;

  @ApiProperty({
    description: 'Access token expiration time in seconds',
    example: 900,
    type: 'number'
  })
  expires_in: number;

  @ApiProperty({
    description: 'User information',
    type: UserResponseDto
  })
  user: UserResponseDto;
}

export class RefreshTokenDto {
  @ApiProperty({
    description: 'JWT refresh token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    type: 'string'
  })
  refresh_token: string;
}

export class RefreshTokenResponseDto {
  @ApiProperty({
    description: 'New JWT access token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    type: 'string'
  })
  access_token: string;

  @ApiProperty({
    description: 'Access token expiration time in seconds',
    example: 900,
    type: 'number'
  })
  expires_in: number;
}

export class LogoutResponseDto {
  @ApiProperty({
    description: 'Logout confirmation message',
    example: 'Logged out successfully',
    type: 'string'
  })
  message: string;
}

export class ErrorResponseDto {
  @ApiProperty({
    description: 'Error message',
    example: 'Invalid credentials',
    type: 'string'
  })
  message: string;

  @ApiProperty({
    description: 'HTTP status code',
    example: 401,
    type: 'number'
  })
  statusCode: number;

  @ApiProperty({
    description: 'Error type',
    example: 'Unauthorized',
    type: 'string'
  })
  error: string;
}

