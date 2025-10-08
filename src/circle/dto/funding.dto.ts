import { IsString, IsNumber, IsEnum, IsOptional, Min, Max } from 'class-validator';

export enum PaymentMethod {
  BANK_TRANSFER = 'bank_transfer',
  CARD = 'card'
}

export enum Currency {
  USD = 'USD',
  USDC = 'USDC'
}

export class CreateDepositDto {
  @IsString()
  userId: string;

  @IsNumber()
  @Min(5)
  @Max(5000)
  amount: number;

  @IsString()
  currency: string;

  @IsString()
  paymentMethod: string;
}

export class DepositStatusDto {
  @IsString()
  depositId: string;
}

export class GetBalanceDto {
  @IsString()
  userId: string;
}
