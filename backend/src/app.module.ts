import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    // Loads .env and makes ConfigService available application-wide.
    ConfigModule.forRoot({ isGlobal: true }),
    HealthModule,
    // Domain modules (Events, Registrations, CheckIn, Dashboard, Realtime,
    // Email, Scheduler) are added in later phases — see docs/ARCHITECTURE.md §3.
  ],
})
export class AppModule {}