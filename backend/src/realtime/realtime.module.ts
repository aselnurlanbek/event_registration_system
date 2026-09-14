import { Module } from '@nestjs/common';
import { DashboardModule } from '../dashboard/dashboard.module';
import { EventsGateway } from './events.gateway';
import { RealtimeStatsService } from './realtime-stats.service';

@Module({
  imports: [DashboardModule], // for computing the stats snapshot
  providers: [EventsGateway, RealtimeStatsService],
  exports: [RealtimeStatsService],
})
export class RealtimeModule {}