import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth.types';

/**
 * Ensures the authenticated user owns the event referenced by the route param
 * (`:eventId` or `:id`). Must run AFTER JwtAuthGuard + RolesGuard(ORGANIZER):
 * `req.user` is set and the role is already ORGANIZER. Returns 404 for a missing
 * event and 403 when the organizer is not the owner.
 */
@Injectable()
export class EventOwnerGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      user?: AuthUser;
      params: Record<string, string>;
    }>();

    const eventId = req.params.eventId ?? req.params.id;
    if (!eventId) {
      return true;
    }

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { organizerId: true },
    });
    if (!event) {
      throw new NotFoundException(`Event ${eventId} not found`);
    }
    if (!req.user || event.organizerId !== req.user.userId) {
      throw new ForbiddenException('You do not own this event');
    }
    return true;
  }
}