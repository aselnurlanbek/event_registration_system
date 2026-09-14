import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { EventsModule } from '../events/events.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { MeController } from './me.controller';
import { RegistrationsController } from './registrations.controller';
import { RegistrationsService } from './registrations.service';

@Module({
  // EventsService + realtime broadcasts + email outbox
  imports: [EventsModule, RealtimeModule, EmailModule],
  controllers: [RegistrationsController, MeController],
  providers: [RegistrationsService],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}