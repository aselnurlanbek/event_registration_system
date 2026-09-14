import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from '../auth.types';

// Injects the authenticated user (req.user) into a handler param.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
    return request.user;
  },
);