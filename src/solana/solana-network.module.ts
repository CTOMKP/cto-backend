import { Global, Module } from '@nestjs/common';
import { SolanaNetworkService } from './solana-network.service';

@Global()
@Module({
  providers: [SolanaNetworkService],
  exports: [SolanaNetworkService],
})
export class SolanaNetworkModule {}
