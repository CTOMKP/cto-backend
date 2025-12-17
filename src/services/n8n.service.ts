import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosResponse } from 'axios';

export interface N8nWebhookPayload {
  contractAddress: string;
  chain: string;
  tokenInfo?: any;
  security?: any;
  holders?: any;
  developer?: any;
  trading?: any;
  tokenAge?: number;
  topTraders?: any[];
  tokenData?: any;
  monitoringData?: any;
  triggerType: 'vetting' | 'monitoring';
}

export interface N8nWebhookResponse {
  success: boolean;
  vettingId?: string;
  monitoringId?: string;
  contractAddress: string;
  tokenInfo?: {
    name: string;
    symbol: string;
    age: number;
  };
  vettingResults?: any;
  monitoringResults?: any;
  scannedAt?: string;
  error?: string;
}

@Injectable()
export class N8nService {
  private readonly logger = new Logger(N8nService.name);

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
  ) {}

  /**
   * Trigger Automation X (Initial Vetting) via N8N webhook
   * Sends complete pre-fetched data payload - N8N only calculates risk scores
   */
  async triggerInitialVetting(payload: {
    contractAddress: string;
    chain: string;
    tokenInfo?: any;
    security?: any;
    holders?: any;
    developer?: any;
    trading?: any;
    tokenAge?: number;
    topTraders?: any[];
  }): Promise<N8nWebhookResponse> {
    try {
      const webhookUrl = this.configService.get('N8N_AUTOMATION_X_URL');
      
      if (!webhookUrl) {
        throw new Error('N8N_AUTOMATION_X_URL is not configured');
      }

      this.logger.debug(`Triggering initial vetting for token: ${payload.contractAddress}`);
      this.logger.debug(`N8N Webhook URL: ${webhookUrl}`);

      // Send complete pre-fetched data payload - N8N only calculates risk scores
      const response: AxiosResponse = await firstValueFrom(
        this.httpService.post(webhookUrl, {
          contractAddress: payload.contractAddress,
          chain: payload.chain,
          tokenInfo: payload.tokenInfo,
          security: payload.security,
          holders: payload.holders,
          developer: payload.developer,
          trading: payload.trading,
          tokenAge: payload.tokenAge,
          topTraders: payload.topTraders || [],
        }, {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 300000, // 5 minutes timeout for vetting process
        })
      );

      this.logger.log(`✅ Initial vetting completed for ${payload.contractAddress}: ${response.status} ${response.statusText}`);
      this.logger.debug(`Response data: ${JSON.stringify(response.data).substring(0, 200)}...`);
      
      return {
        success: true,
        vettingId: response.data?.vettingId,
        contractAddress: payload.contractAddress,
        tokenInfo: response.data?.tokenInfo,
        vettingResults: response.data?.vettingResults,
        scannedAt: response.data?.scannedAt,
      };
    } catch (error: any) {
      const errorMessage = error.response 
        ? `HTTP ${error.response.status}: ${error.response.statusText} - ${JSON.stringify(error.response.data).substring(0, 200)}`
        : error.message;
      
      this.logger.error(`❌ Failed to trigger initial vetting for ${payload.contractAddress}: ${errorMessage}`);
      this.logger.debug(`Error details: ${error.code || 'N/A'}, URL: ${webhookUrl}`);
      
      return {
        success: false,
        contractAddress: payload.contractAddress,
        error: errorMessage,
      };
    }
  }

  /**
   * Trigger Automation Y (Continuous Monitoring) via N8N webhook
   * Sends only non-fixed monitoring data (price, volume, liquidity, holderCount, etc.)
   */
  async triggerContinuousMonitoring(payload: {
    contractAddress: string;
    chain: string;
    trading?: {
      price?: number;
      priceChange24h?: number;
      volume24h?: number;
      buys24h?: number;
      sells24h?: number;
      liquidity?: number;
      holderCount?: number;
    };
  }): Promise<N8nWebhookResponse> {
    try {
      const webhookUrl = this.configService.get('N8N_AUTOMATION_Y_URL');
      
      if (!webhookUrl) {
        throw new Error('N8N_AUTOMATION_Y_URL is not configured');
      }

      this.logger.debug(`Triggering continuous monitoring for token: ${payload.contractAddress}`);

      const response: AxiosResponse = await firstValueFrom(
        this.httpService.post(webhookUrl, {
          contractAddress: payload.contractAddress,
          chain: payload.chain,
          trading: payload.trading,
        }, {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 120000, // 2 minutes timeout for monitoring process
        })
      );

      this.logger.log(`Continuous monitoring completed for ${payload.contractAddress}: ${response.status}`);
      
      return {
        success: true,
        monitoringId: response.data?.monitoringId,
        contractAddress: payload.contractAddress,
        monitoringResults: response.data?.monitoringResults,
        scannedAt: response.data?.scannedAt,
      };
    } catch (error: any) {
      this.logger.error(`Failed to trigger continuous monitoring for ${payload.contractAddress}:`, error.message);
      
      return {
        success: false,
        contractAddress: payload.contractAddress,
        error: error.message,
      };
    }
  }

  /**
   * Test N8N webhook connectivity
   */
  async testWebhookConnectivity() {
    try {
      const webhookUrl = this.configService.get('N8N_AUTOMATION_X_URL');
      
      if (!webhookUrl) {
        return {
          success: false,
          error: 'N8N_AUTOMATION_X_URL is not configured',
          message: 'N8N webhook URL not configured',
        };
      }

      const response: AxiosResponse = await firstValueFrom(
        this.httpService.post(webhookUrl, {
          test: true,
          timestamp: new Date().toISOString(),
        }, {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 10000, // 10 seconds timeout for test
        })
      );

      return {
        success: true,
        status: response.status,
        message: 'N8N webhook is accessible',
      };
    } catch (error: any) {
      this.logger.error('N8N webhook connectivity test failed:', error.message);
      
      return {
        success: false,
        error: error.message,
        message: 'N8N webhook is not accessible',
      };
    }
  }
}
