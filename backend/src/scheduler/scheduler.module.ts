import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { DevReminderController } from './dev-reminder.controller';
import { ReminderService } from './reminder.service';

@Module({
  imports: [EmailModule], // reuse the idempotent email outbox
  controllers: [DevReminderController],
  providers: [ReminderService],
  exports: [ReminderService],
})
export class SchedulerModule {}