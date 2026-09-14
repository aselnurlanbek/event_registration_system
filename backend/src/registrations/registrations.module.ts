import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { RegistrationsController } from './registrations.controller';
import { RegistrationsService } from './registrations.service';

@Module({
  imports: [EventsModule], // reuse EventsService.findOne for existence checks
  controllers: [RegistrationsController],
  providers: [RegistrationsService],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}