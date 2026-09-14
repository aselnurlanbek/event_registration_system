import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Event } from '@prisma/client';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from './events.service';

// Minimal in-memory mock of the Prisma methods EventsService uses.
const mockEvent = (overrides: Partial<Event> = {}): Event => ({
  id: 'evt_1',
  title: 'Test Event',
  description: 'A test event',
  startsAt: new Date('2026-10-01T18:00:00.000Z'),
  capacity: 100,
  reminderSentAt: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  ...overrides,
});

describe('EventsService', () => {
  let service: EventsService;
  let prisma: {
    event: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    registration: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let email: { recordInTx: jest.Mock };

  beforeEach(async () => {
    prisma = {
      event: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      registration: { findMany: jest.fn().mockResolvedValue([]) },
      // Run the interactive-transaction callback with prisma itself as `tx`.
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    email = { recordInTx: jest.fn().mockResolvedValue(0) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: email },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
  });

  describe('create', () => {
    it('creates an event and stores startsAt as a UTC Date', async () => {
      const created = mockEvent();
      prisma.event.create.mockResolvedValue(created);

      const result = await service.create({
        title: 'Test Event',
        description: 'A test event',
        startsAt: '2026-10-01T18:00:00.000Z',
        capacity: 100,
      });

      expect(result).toBe(created);
      expect(prisma.event.create).toHaveBeenCalledWith({
        data: {
          title: 'Test Event',
          description: 'A test event',
          startsAt: new Date('2026-10-01T18:00:00.000Z'),
          capacity: 100,
        },
      });
    });
  });

  describe('findAll', () => {
    it('returns events ordered by startsAt', async () => {
      const events = [mockEvent(), mockEvent({ id: 'evt_2' })];
      prisma.event.findMany.mockResolvedValue(events);

      const result = await service.findAll();

      expect(result).toBe(events);
      expect(prisma.event.findMany).toHaveBeenCalledWith({
        orderBy: { startsAt: 'asc' },
      });
    });
  });

  describe('findOne', () => {
    it('returns the event when it exists', async () => {
      const event = mockEvent();
      prisma.event.findUnique.mockResolvedValue(event);

      await expect(service.findOne('evt_1')).resolves.toBe(event);
      expect(prisma.event.findUnique).toHaveBeenCalledWith({
        where: { id: 'evt_1' },
      });
    });

    it('throws NotFoundException when the event is missing', async () => {
      prisma.event.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates fields of an existing event', async () => {
      const existing = mockEvent();
      const updated = mockEvent({ title: 'New Title' });
      prisma.event.findUnique.mockResolvedValue(existing);
      prisma.event.update.mockResolvedValue(updated);

      const result = await service.update('evt_1', { title: 'New Title' });

      expect(result).toBe(updated);
      expect(prisma.event.update).toHaveBeenCalledWith({
        where: { id: 'evt_1' },
        data: {
          title: 'New Title',
          description: undefined,
          startsAt: undefined,
          capacity: undefined,
        },
      });
    });

    it('records EVENT_RESCHEDULED emails to registered participants when startsAt changes', async () => {
      const existing = mockEvent();
      const updated = mockEvent({
        startsAt: new Date('2026-11-01T18:00:00.000Z'),
      });
      prisma.event.findUnique.mockResolvedValue(existing);
      prisma.event.update.mockResolvedValue(updated);
      prisma.registration.findMany.mockResolvedValue([
        { id: 'reg_1', email: 'a@example.com' },
      ]);

      await service.update('evt_1', { startsAt: '2026-11-01T18:00:00.000Z' });

      expect(email.recordInTx).toHaveBeenCalledWith(
        prisma,
        [
          expect.objectContaining({
            type: 'EVENT_RESCHEDULED',
            recipient: 'a@example.com',
            registrationId: 'reg_1',
            deduplicationKey:
              'event-rescheduled:evt_1:reg_1:2026-11-01T18:00:00.000Z',
          }),
        ],
      );
    });

    it('does not record reschedule emails when startsAt is unchanged', async () => {
      const existing = mockEvent();
      prisma.event.findUnique.mockResolvedValue(existing);
      prisma.event.update.mockResolvedValue(existing);

      await service.update('evt_1', { title: 'Renamed' });

      expect(email.recordInTx).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when updating a missing event', async () => {
      prisma.event.findUnique.mockResolvedValue(null);

      await expect(
        service.update('missing', { title: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.event.update).not.toHaveBeenCalled();
    });
  });
});