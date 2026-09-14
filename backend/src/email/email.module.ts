import { Module } from '@nestjs/common';
import { DevEmailsController } from './dev-emails.controller';
import { EmailService } from './email.service';

@Module({
  controllers: [DevEmailsController],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}