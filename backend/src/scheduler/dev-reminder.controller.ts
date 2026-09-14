import {
  Controller,
  HttpCode,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReminderService } from './reminder.service';

/**
 * DEVELOPMENT-ONLY endpoint to manually trigger reminder processing for
 * demos/tests instead of waiting for the cron tick. Disabled (404) in production.
 */
@Controller('dev/reminders/run')
export class DevReminderController {
  constructor(
    private readonly reminders: ReminderService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @HttpCode(200)
  async run() {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new NotFoundException();
    }
    const result = await this.reminders.processReminders();
    return {
      _warning: 'DEVELOPMENT-ONLY endpoint — manually runs the reminder job.',
      ...result,
    };
  }
}