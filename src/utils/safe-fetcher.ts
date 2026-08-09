import axios, { AxiosInstance, AxiosError, AxiosRequestConfig } from 'axios';
import { HttpException, HttpStatus, Logger } from '@nestjs/common';

const logger = new Logger('SafeFetcher');

/**
 * Creates a resilient axios instance with retry logic and error interceptors
 */
export const createSafeFetcher = (baseURL: string, apiKey?: string, headerName: string = 'x-api-key'): AxiosInstance => {
  // CLEAN THE KEY: Strip any quotes or spaces that might have been pasted into Coolify
  const cleanKey = apiKey?.replace(/['"]/g, '').trim();
  
  if (cleanKey && cleanKey !== apiKey) {
    logger.warn(`🧹 Cleaned API key for ${baseURL} (removed quotes or spaces)`);
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (cleanKey) headers[headerName] = cleanKey;

  const client = axios.create({
    baseURL,
    timeout: 15000,
    headers,
  });

  // Request Interceptor for logging
  client.interceptors.request.use((config) => {
    const fullUrl = `${config.baseURL}${config.url}`;
    // logger.debug(`📡 [SafeFetcher] Sending request to: ${fullUrl}`);
    return config;
  });

  // Custom Retry Logic (to avoid new dependencies like axios-retry)
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config as AxiosRequestConfig & { _retryCount?: number };
      const status = error.response?.status;

      const isTransientNetworkError = !status && [
        'ECONNABORTED',
        'ECONNRESET',
        'ETIMEDOUT',
        'ENOTFOUND',
        'EAI_AGAIN',
      ].includes(String(error.code || ''));

      // Retry rate limits, transient network failures and server errors.
      if ((status === 429 || (status && status >= 500) || isTransientNetworkError) && (!config._retryCount || config._retryCount < 3)) {
        config._retryCount = (config._retryCount || 0) + 1;
        const retryAfterHeader = error.response?.headers?.['retry-after'];
        const retryAfterMs = Number(retryAfterHeader) > 0 ? Number(retryAfterHeader) * 1000 : 0;
        const exponentialDelay = Math.pow(2, config._retryCount) * 1000;
        const jitter = Math.floor(Math.random() * 500);
        const delay = Math.max(retryAfterMs, exponentialDelay) + jitter;
        
        logger.warn(`⚠️ Retry attempt #${config._retryCount} for ${baseURL} after ${delay}ms (Status: ${status})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return client(config);
      }

      // Explicit error mapping to prevent 0-scoring hallucinations
      if (status === 403 || status === 401) {
        logger.error(`🚫 API Key Blocked or Invalid for ${baseURL} (Status: ${status})`);
        throw new HttpException('EXTERNAL_API_BLOCK', HttpStatus.FAILED_DEPENDENCY);
      }
      
      if (status === 429) {
        logger.error(`⏳ API Rate Limit Exhausted for ${baseURL}`);
        throw new HttpException('EXTERNAL_API_BUSY', HttpStatus.TOO_MANY_REQUESTS);
      }

      if (!status || status >= 500) {
        logger.error(`💥 External Server Error or Timeout for ${baseURL}: ${error.message}`);
        throw new HttpException('EXTERNAL_API_DOWN', HttpStatus.SERVICE_UNAVAILABLE);
      }

      throw error;
    }
  );

  return client;
};

