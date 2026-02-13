import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyMarketplacePaymentDto {
  @IsString()
  @IsNotEmpty()
  txHash: string;
}
