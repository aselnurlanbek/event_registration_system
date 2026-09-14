import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { EventsModule } from '../events/events.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { RegistrationsController } from './registrations.controller';
import { RegistrationsService } from './registrations.service';

@Module({
  // EventsService + realtime broadcasts + email outbox
  imports: [EventsModule, RealtimeModule, EmailModule],
  controllers: [RegistrationsController],
  providers: [RegistrationsService],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}