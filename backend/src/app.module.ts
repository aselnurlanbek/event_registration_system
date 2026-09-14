import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CheckInModule } from './check-in/check-in.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { EmailModule } from './email/email.module';
import { EventsModule } from './events/events.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RegistrationsModule } from './registrations/registrations.module';

@Module({
  imports: [
    // Loads .env and makes ConfigService available application-wide.
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    EventsModule,
    RegistrationsModule,
    CheckInModule,
    DashboardModule,
    RealtimeModule,
    EmailModule,
    // Domain modules (Events, Registrations, CheckIn, Dashboard, Realtime,
    // Email, Scheduler) are added in later phases — see docs/ARCHITECTURE.md §3.
  ],
})
export class AppModule {}