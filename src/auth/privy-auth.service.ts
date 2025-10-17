import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrivyApi } from '@privy-io/node-auth';

@Injectable()
export class PrivyAuthService {
  private privy: PrivyApi;

  constructor(private configService: ConfigService) {
    this.privy = new PrivyApi({
      appId: this.configService.get<string>('PRIVY_APP_ID'),
      appSecret: this.configService.get<string>('PRIVY_APP_SECRET'),
    });
  }

  async verifyToken(token: string) {
    try {
      const user = await this.privy.verifyAuthToken(token);
      return user;
    } catch (error) {
      throw new Error('Invalid Privy token');
    }
  }

  async getUser(userId: string) {
    try {
      const user = await this.privy.getUser(userId);
      return user;
    } catch (error) {
      throw new Error('User not found');
    }
  }
}
