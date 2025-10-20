import { ApiProperty } from '@nestjs/swagger';

export class RegisterResponseDto {
  @ApiProperty({ description: 'Created user ID', example: 1 })
  id: number;

  @ApiProperty({ description: 'User name', example: 'Alice Doe', nullable: true })
  name?: string | null;

  @ApiProperty({ description: 'User email', example: 'user@example.com' })
  email: string;

  @ApiProperty({ description: 'Creation timestamp (ISO string)', example: '2025-01-01T12:00:00.000Z' })
  createdAt: string;
}