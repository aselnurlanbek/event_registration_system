import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Event } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateEventDto): Promise<Event> {
    return this.prisma.event.create({
      data: {
        title: dto.title,
        description: dto.description,
        // Parse the ISO string to a Date; Prisma persists it in UTC.
        startsAt: new Date(dto.startsAt),
        capacity: dto.capacity,
      },
    });
  }

  async findAll(): Promise<Event[]> {
    return this.prisma.event.findMany({ orderBy: { startsAt: 'asc' } });
  }

  async findOne(id: string): Promise<Event> {
    const event = await this.prisma.event.findUnique({ where: { id } });
    if (!event) {
      throw new NotFoundException(`Event ${id} not found`);
    }
    return event;
  }

  async update(id: string, dto: UpdateEventDto): Promise<Event> {
    // Ensures the event exists (throws 404 otherwise) and gives us the previous
    // startsAt so we can detect a reschedule.
    const existing = await this.findOne(id);

    const newStartsAt =
      dto.startsAt !== undefined ? new Date(dto.startsAt) : undefined;
    const isRescheduled =
      newStartsAt !== undefined &&
      newStartsAt.getTime() !== existing.startsAt.getTime();

    const updated = await this.prisma.event.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        startsAt: newStartsAt,
        capacity: dto.capacity,
      },
    });

    if (isRescheduled) {
      this.handleReschedule(existing, updated);
    }

    return updated;
  }

  /**
   * Reschedule hook. Phase 2 only records that the date/time changed.
   * Phase 9 will emit an EVENT_RESCHEDULED domain action that notifies
   * registered participants by email (see docs/ARCHITECTURE.md §4, req. 9).
   * Intentionally does NOT send email yet.
   */
  private handleReschedule(previous: Event, updated: Event): void {
    this.logger.log(
      `Event ${updated.id} rescheduled from ${previous.startsAt.toISOString()} to ${updated.startsAt.toISOString()} (notification deferred to Phase 9)`,
    );
    // TODO(Phase 9): emit EVENT_RESCHEDULED -> EmailModule (RESCHEDULE emails).
  }
}