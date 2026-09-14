import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { OrganizerEventsController } from './organizer-events.controller';

@Module({
  imports: [EmailModule], // EVENT_RESCHEDULED emails
  controllers: [EventsController, OrganizerEventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}