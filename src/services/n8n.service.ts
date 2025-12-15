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
      
<<<<<<< HEAD
=======
      if (!webhookUrl) {
        throw new Error('N8N_AUTOMATION_X_URL is not configured');
      }

>>>>>>> 3778442 (feat: implement n8n token vetting system with cron workers)
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

      this.logger.log(`Initial vetting completed for ${payload.contractAddress}: ${response.status}`);
      
      return {
        success: true,
<<<<<<< HEAD
        vettingId: response.data.vettingId,
        contractAddress: payload.contractAddress,
        tokenInfo: response.data.tokenInfo,
        vettingResults: response.data.vettingResults,
        scannedAt: response.data.scannedAt,
      };
    } catch (error) {
=======
        vettingId: response.data?.vettingId,
        contractAddress: payload.contractAddress,
        tokenInfo: response.data?.tokenInfo,
        vettingResults: response.data?.vettingResults,
        scannedAt: response.data?.scannedAt,
      };
    } catch (error: any) {
>>>>>>> 3778442 (feat: implement n8n token vetting system with cron workers)
      this.logger.error(`Failed to trigger initial vetting for ${payload.contractAddress}:`, error.message);
      
      return {
        success: false,
        contractAddress: payload.contractAddress,
        error: error.message,
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
      
<<<<<<< HEAD
=======
      if (!webhookUrl) {
        throw new Error('N8N_AUTOMATION_Y_URL is not configured');
      }

>>>>>>> 3778442 (feat: implement n8n token vetting system with cron workers)
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
<<<<<<< HEAD
        monitoringId: response.data.monitoringId,
        contractAddress: payload.contractAddress,
        monitoringResults: response.data.monitoringResults,
        scannedAt: response.data.scannedAt,
      };
    } catch (error) {
=======
        monitoringId: response.data?.monitoringId,
        contractAddress: payload.contractAddress,
        monitoringResults: response.data?.monitoringResults,
        scannedAt: response.data?.scannedAt,
      };
    } catch (error: any) {
>>>>>>> 3778442 (feat: implement n8n token vetting system with cron workers)
      this.logger.error(`Failed to trigger continuous monitoring for ${payload.contractAddress}:`, error.message);
      
      return {
        success: false,
        contractAddress: payload.contractAddress,
        error: error.message,
      };
    }
  }

  /**
<<<<<<< HEAD
   * Batch trigger vetting for multiple tokens
   */
  async batchTriggerVetting(tokens: Array<{ contractAddress: string; chain: string }>) {
    this.logger.log(`Batch triggering vetting for ${tokens.length} tokens`);

    const results = await Promise.allSettled(
      tokens.map(token => 
        this.triggerInitialVetting({
          contractAddress: token.contractAddress,
          chain: token.chain,
        })
      )
    );

    const successful = results.filter(result => result.status === 'fulfilled' && result.value.success).length;
    const failed = results.length - successful;

    this.logger.log(`Batch vetting completed: ${successful} successful, ${failed} failed`);

    return {
      total: tokens.length,
      successful,
      failed,
      results: results.map((result, index) => ({
        token: tokens[index],
        result: result.status === 'fulfilled' ? result.value : { success: false, error: result.reason },
      })),
    };
  }

  /**
   * Batch trigger monitoring for multiple tokens
   */
  async batchTriggerMonitoring(tokens: Array<{ contractAddress: string; chain: string }>) {
    this.logger.log(`Batch triggering monitoring for ${tokens.length} tokens`);

    const results = await Promise.allSettled(
      tokens.map(token => 
        this.triggerContinuousMonitoring({
          contractAddress: token.contractAddress,
          chain: token.chain,
        })
      )
    );

    const successful = results.filter(result => result.status === 'fulfilled' && result.value.success).length;
    const failed = results.length - successful;

    this.logger.log(`Batch monitoring completed: ${successful} successful, ${failed} failed`);

    return {
      total: tokens.length,
      successful,
      failed,
      results: results.map((result, index) => ({
        token: tokens[index],
        result: result.status === 'fulfilled' ? result.value : { success: false, error: result.reason },
      })),
    };
  }

  /**
   * Check N8N workflow status
   */
  async checkWorkflowStatus(workflowId: string) {
    try {
      const n8nBaseUrl = this.configService.get('N8N_BASE_URL');
      const apiKey = this.configService.get('N8N_API_KEY');
      
      const response: AxiosResponse = await firstValueFrom(
        this.httpService.get(`${n8nBaseUrl}/api/v1/workflows/${workflowId}`, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
        })
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to check workflow status for ${workflowId}:`, error.message);
      return null;
    }
  }

  /**
   * Get N8N execution history
   */
  async getExecutionHistory(workflowId: string, limit: number = 10) {
    try {
      const n8nBaseUrl = this.configService.get('N8N_BASE_URL');
      const apiKey = this.configService.get('N8N_API_KEY');
      
      const response: AxiosResponse = await firstValueFrom(
        this.httpService.get(`${n8nBaseUrl}/api/v1/executions`, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
          params: {
            workflowId,
            limit,
          },
        })
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to get execution history for ${workflowId}:`, error.message);
      return null;
    }
  }

  /**
=======
>>>>>>> 3778442 (feat: implement n8n token vetting system with cron workers)
   * Test N8N webhook connectivity
   */
  async testWebhookConnectivity() {
    try {
      const webhookUrl = this.configService.get('N8N_AUTOMATION_X_URL');
      
<<<<<<< HEAD
=======
      if (!webhookUrl) {
        return {
          success: false,
          error: 'N8N_AUTOMATION_X_URL is not configured',
          message: 'N8N webhook URL not configured',
        };
      }

>>>>>>> 3778442 (feat: implement n8n token vetting system with cron workers)
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
<<<<<<< HEAD
    } catch (error) {
=======
    } catch (error: any) {
>>>>>>> 3778442 (feat: implement n8n token vetting system with cron workers)
      this.logger.error('N8N webhook connectivity test failed:', error.message);
      
      return {
        success: false,
        error: error.message,
        message: 'N8N webhook is not accessible',
      };
    }
  }
<<<<<<< HEAD

  /**
   * Get N8N system health
   */
  async getN8nHealth() {
    try {
      const n8nBaseUrl = this.configService.get('N8N_BASE_URL');
      
      const response: AxiosResponse = await firstValueFrom(
        this.httpService.get(`${n8nBaseUrl}/healthz`, {
          timeout: 5000,
        })
      );

      return {
        status: 'healthy',
        response: response.data,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('N8N health check failed:', error.message);
      
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
=======
}

>>>>>>> 3778442 (feat: implement n8n token vetting system with cron workers)
