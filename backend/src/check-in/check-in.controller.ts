import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { CheckInDto } from './dto/check-in.dto';
import { CheckInService } from './check-in.service';

@Controller('events/:eventId/check-in')
export class CheckInController {
  constructor(private readonly checkInService: CheckInService) {}

  @Post()
  @HttpCode(200) // 200 on first successful check-in (req. 5)
  checkIn(@Param('eventId') eventId: string, @Body() dto: CheckInDto) {
    return this.checkInService.checkIn(eventId, dto.ticketCode);
  }
}