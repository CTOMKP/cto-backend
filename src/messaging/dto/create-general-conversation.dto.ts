import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateGeneralConversationDto {
  @IsInt()
  @Min(1)
  recipientUserId: number;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  initialMessage?: string;
}
