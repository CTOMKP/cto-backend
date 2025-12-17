import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosResponse } from 'axios';
import * as https from 'https';

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
  ) {
    // Log n8n configuration at startup
    const webhookUrl = this.configService.get('N8N_AUTOMATION_X_URL');
    if (webhookUrl) {
      this.logger.log(`✅ N8N webhook URL configured: ${webhookUrl}`);
    } else {
      this.logger.warn(`⚠️ N8N_AUTOMATION_X_URL is not configured - n8n vetting will be disabled`);
    }
  }

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
    const webhookUrl = this.configService.get('N8N_AUTOMATION_X_URL');
    
    if (!webhookUrl) {
      return {
        success: false,
        contractAddress: payload.contractAddress,
        error: 'N8N_AUTOMATION_X_URL is not configured',
      };
    }

    try {
      this.logger.log(`🚀 Starting n8n vetting for token: ${payload.contractAddress}`);
      this.logger.log(`📍 N8N Webhook URL: ${webhookUrl}`);
      this.logger.debug(`📦 Payload size: ${JSON.stringify(payload).length} bytes`);

      const startTime = Date.now();
      
      // Send complete pre-fetched data payload - N8N only calculates risk scores
      this.logger.debug(`📡 Sending HTTP POST request to n8n...`);
      this.logger.debug(`🔗 Full webhook URL: ${webhookUrl}`);
      this.logger.debug(`📋 Payload keys: ${Object.keys({
        contractAddress: payload.contractAddress,
        chain: payload.chain,
        tokenInfo: payload.tokenInfo,
        security: payload.security,
        holders: payload.holders,
        developer: payload.developer,
      }).join(', ')}`);
      
      try {
        // For internal Coolify communication, create an HTTPS agent that doesn't verify certificates
        // This is safe for internal service-to-service communication
        const httpsAgent = new https.Agent({
          rejectUnauthorized: false, // Allow self-signed or internal certificates
        });
        
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
            timeout: 30000, // 30 seconds timeout
            validateStatus: (status) => status < 500, // Accept any status < 500
            httpsAgent: httpsAgent, // Use custom HTTPS agent for internal communication
          })
        );

        const duration = Date.now() - startTime;
        this.logger.log(`✅ Initial vetting completed for ${payload.contractAddress}: ${response.status} ${response.statusText} (took ${duration}ms)`);
        this.logger.debug(`Response data: ${JSON.stringify(response.data).substring(0, 200)}...`);
        
        return {
          success: true,
          vettingId: response.data?.vettingId,
          contractAddress: payload.contractAddress,
          tokenInfo: response.data?.tokenInfo,
          vettingResults: response.data?.vettingResults,
          scannedAt: response.data?.scannedAt,
        };
      } catch (httpError: any) {
        // Re-throw to be caught by outer catch block
        throw httpError;
      }
    } catch (error: any) {
      let errorMessage: string;
      
      if (error.isAxiosError) {
        if (error.code === 'ECONNREFUSED') {
          errorMessage = `Connection refused - n8n server may be down or unreachable at ${webhookUrl}`;
        } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
          errorMessage = `Request timeout - n8n server did not respond within 5 minutes`;
        } else if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
          errorMessage = `DNS resolution failed - cannot resolve hostname for ${webhookUrl}`;
        } else if (error.response) {
          errorMessage = `HTTP ${error.response.status}: ${error.response.statusText} - ${JSON.stringify(error.response.data).substring(0, 200)}`;
        } else {
          errorMessage = `Network error: ${error.code || 'UNKNOWN'} - ${error.message}`;
        }
      } else {
        errorMessage = error.message || String(error);
      }
      
      this.logger.error(`❌ Failed to trigger initial vetting for ${payload.contractAddress}: ${errorMessage}`);
      this.logger.error(`🔍 Error code: ${error.code || 'N/A'}, Error type: ${error.constructor?.name || 'Unknown'}`);
      this.logger.error(`📍 Target URL: ${webhookUrl}`);
      
      if (error.stack) {
        this.logger.debug(`Stack trace: ${error.stack.substring(0, 500)}`);
      }
      
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
