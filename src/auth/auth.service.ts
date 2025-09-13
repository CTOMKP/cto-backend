import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  // David here we validate user by email and password against DB
  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return null;
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return null;
    const { passwordHash, ...result } = user;
    return result;
  }

  //  David here we register a new user with hashed password
  async register(name: string | undefined, email: string, password: string) {
    const passwordHash = await bcrypt.hash(password, 10);
    const created = await this.prisma.user.create({
      data: { name: name ?? null, email, passwordHash },
    });
    const { passwordHash: _, ...safe } = created as any;
    return safe;
  }

  // Get user by id
  async getUserById(id: number) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  // Issue access and refresh tokens
  async login(user: any) {
    const payload = { email: user.email, sub: user.id };
    const accessToken = this.jwtService.sign(payload, { expiresIn: '15m' });
    const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 900,
      user: { id: user.id, email: user.email },
    };
  }

  // Refresh access token
  async refreshToken(user: any) {
    const payload = { email: user.email, sub: user.id };
    const accessToken = this.jwtService.sign(payload, { expiresIn: '15m' });
    return { access_token: accessToken, expires_in: 900 };
  }

  // Verify jwt
  async verifyToken(token: string) {
    try {
      return this.jwtService.verify(token);
    } catch {
      return null;
    }
  }
}
