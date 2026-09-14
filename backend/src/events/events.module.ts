import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [EmailModule], // EVENT_RESCHEDULED emails
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}