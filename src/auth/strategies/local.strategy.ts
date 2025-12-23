import { Strategy } from 'passport-local';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { AuthService } from '../auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(LocalStrategy.name);

  constructor(private authService: AuthService) {
    super({
      usernameField: 'email',
    });
  }

  async validate(email: string, password: string): Promise<any> {
    this.logger.log(`🔍 [LocalStrategy] validate called - email: ${email}, password length: ${password.length}`);
    this.logger.debug(`🔍 [LocalStrategy] Password preview: ${password.substring(0, 5)}...${password.substring(password.length - 3)}`);
    
    const user = await this.authService.validateUser(email, password);
    if (!user) {
      this.logger.warn(`❌ [LocalStrategy] validateUser returned null for ${email}`);
      throw new UnauthorizedException('Invalid credentials');
    }
    
    this.logger.log(`✅ [LocalStrategy] User validated successfully: ${email}`);
    return user;
  }
}

