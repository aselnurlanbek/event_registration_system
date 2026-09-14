import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const SALT_ROUNDS = 10;

// User shape returned to clients — never includes the password hash.
export type PublicUser = Omit<User, 'passwordHash'>;

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const email = dto.email.trim().toLowerCase();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    // DEMO: ORGANIZER self-registration is allowed so the app is easy to try.
    // In production this would be restricted — participants self-register, but
    // organizer accounts would be created by an admin / invite only.
    const role = dto.role ?? Role.PARTICIPANT;

    let user: User;
    try {
      user = await this.prisma.user.create({
        data: { email, passwordHash, role },
      });
    } catch {
      // Unique-constraint backstop against a race between the check and create.
      throw new ConflictException('Email already registered');
    }

    return this.buildResult(user);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.buildResult(user);
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException();
    }
    return this.toPublic(user);
  }

  private buildResult(user: User): AuthResult {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    return {
      user: this.toPublic(user),
      accessToken: this.jwt.sign(payload),
    };
  }

  private toPublic(user: User): PublicUser {
    const { passwordHash: _omit, ...rest } = user;
    void _omit;
    return rest;
  }
}