import axios, { AxiosInstance, AxiosError, AxiosRequestConfig } from 'axios';
import { HttpException, HttpStatus, Logger } from '@nestjs/common';

const logger = new Logger('SafeFetcher');

/**
 * Creates a resilient axios instance with retry logic and error interceptors
 */
export const createSafeFetcher = (baseURL: string, apiKey: string, headerName: string = 'x-api-key'): AxiosInstance => {
  // CLEAN THE KEY: Strip any quotes or spaces that might have been pasted into Coolify
  const cleanKey = apiKey?.replace(/['"]/g, '').trim();
  
  if (cleanKey && cleanKey !== apiKey) {
    logger.warn(`🧹 Cleaned API key for ${baseURL} (removed quotes or spaces)`);
  }

  const client = axios.create({
    baseURL,
    timeout: 15000,
    headers: {
      [headerName]: cleanKey,
      'Accept': 'application/json',
    },
  });

  // Custom Retry Logic (to avoid new dependencies like axios-retry)
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config as AxiosRequestConfig & { _retryCount?: number };
      const status = error.response?.status;

      // Retry logic for 429 (Rate Limit) or 5xx (Server Error)
      if ((status === 429 || (status && status >= 500)) && (!config._retryCount || config._retryCount < 3)) {
        config._retryCount = (config._retryCount || 0) + 1;
        const delay = Math.pow(2, config._retryCount) * 1000; // Exponential backoff
        
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

