import { Module } from '@nestjs/common';
import { DevTicketsController } from './dev-tickets.controller';

// Development/admin helpers. Every endpoint here guards on NODE_ENV and is
// hidden (404) in production.
@Module({
  controllers: [DevTicketsController],
})
export class DevModule {}