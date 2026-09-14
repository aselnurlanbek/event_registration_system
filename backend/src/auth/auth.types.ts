import { Role } from '@prisma/client';

// Shape attached to the request by JwtStrategy.validate (req.user).
export interface AuthUser {
  userId: string;
  email: string;
  role: Role;
}

// JWT payload.
export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
}