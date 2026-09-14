import { Injectable, Logger } from '@nestjs/common';
import { DashboardService } from '../dashboard/dashboard.service';
import { EventsGateway } from './events.gateway';

/**
 * Computes the current stats snapshot and broadcasts it to subscribers.
 * Call this AFTER the DB transaction commits, so clients are never notified
 * about state that could still roll back. Failures are swallowed (logged) so a
 * broadcast problem can never fail the originating REST request.
 */
@Injectable()
export class RealtimeStatsService {
  private readonly logger = new Logger(RealtimeStatsService.name);

  constructor(
    private readonly dashboard: DashboardService,
    private readonly gateway: EventsGateway,
  ) {}

  async broadcast(eventId: string): Promise<void> {
    try {
      const stats = await this.dashboard.getStats(eventId);
      this.gateway.emitStatsUpdated(eventId, stats);
    } catch (err) {
      this.logger.error(
        `Failed to broadcast stats for event ${eventId}`,
        err as Error,
      );
    }
  }
}