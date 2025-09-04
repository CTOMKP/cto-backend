import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';

export interface User {
  id: number;
  email: string;
  password: string;
}

@Injectable()
export class AuthService {
  // In production, this should come from a database
  private readonly users: User[] = [
    {
      id: 1,
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD, //hashed version
    },
  ];

  constructor(private readonly jwtService: JwtService) {}

  async validateUser(email: string, password: string): Promise<any> {
    const user = this.users.find(u => u.email === email);
    if (user && await bcrypt.compare(password, user.password)) {
      const { password, ...result } = user;
      return result;
    }
    return null;
  }

  async login(user: any) {
    const payload = { email: user.email, sub: user.id };
    const accessToken = this.jwtService.sign(payload, { expiresIn: '15m' });
    const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });
    
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 900, // 15 minutes in seconds
      user: {
        id: user.id,
        email: user.email,
      },
    };
  }

  async refreshToken(user: any) {
    const payload = { email: user.email, sub: user.id };
    const accessToken = this.jwtService.sign(payload, { expiresIn: '15m' });
    
    return {
      access_token: accessToken,
      expires_in: 900,
    };
  }

  async getUserById(id: number) {
    return this.users.find(u => u.id === id);
  }

  async verifyToken(token: string) {
    try {
      return this.jwtService.verify(token);
    } catch (error) {
      return null;
    }
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  // Method to change admin password (for production use)
  async changeAdminPassword(newPassword: string): Promise<void> {
    const hashedPassword = await this.hashPassword(newPassword);
    this.users[0].password = hashedPassword;
  }
}
