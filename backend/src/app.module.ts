import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { CheckInModule } from './check-in/check-in.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DevModule } from './dev/dev.module';
import { EmailModule } from './email/email.module';
import { EventsModule } from './events/events.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RegistrationsModule } from './registrations/registrations.module';
import { SchedulerModule } from './scheduler/scheduler.module';

@Module({
  imports: [
    // Loads .env and makes ConfigService available application-wide.
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(), // enables @Cron jobs
    PrismaModule,
    AuthModule,
    HealthModule,
    EventsModule,
    RegistrationsModule,
    CheckInModule,
    DashboardModule,
    RealtimeModule,
    EmailModule,
    SchedulerModule,
    DevModule,
  ],
})
export class AppModule {}