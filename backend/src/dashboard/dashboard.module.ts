import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [EventsModule], // reuse EventsService.findOne for existence + capacity
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}