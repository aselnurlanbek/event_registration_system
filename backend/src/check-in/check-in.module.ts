import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { CheckInController } from './check-in.controller';
import { CheckInService } from './check-in.service';

@Module({
  imports: [RealtimeModule], // realtime stats broadcasts
  controllers: [CheckInController],
  providers: [CheckInService],
  exports: [CheckInService],
})
export class CheckInModule {}