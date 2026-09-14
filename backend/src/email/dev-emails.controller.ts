import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';

/**
 * DEVELOPMENT-ONLY endpoint. Exposes the mock email outbox so we can demonstrate
 * which emails would have been sent. Disabled (404) when NODE_ENV=production.
 */
@Controller('dev/emails')
export class DevEmailsController {
  constructor(
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async list() {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      // Hidden entirely in production.
      throw new NotFoundException();
    }

    const emails = await this.email.listAll();
    return {
      _warning: 'DEVELOPMENT-ONLY endpoint — mock email outbox, not real emails.',
      count: emails.length,
      emails,
    };
  }
}