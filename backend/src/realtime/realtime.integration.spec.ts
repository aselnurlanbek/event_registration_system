/**
 * End-to-end realtime test: boots the full Nest app (HTTP + Socket.IO) on an
 * ephemeral port, connects TWO socket.io clients (simulating two browser tabs),
 * subscribes both to the same event room, then performs a real registration and
 * asserts both clients receive `event.stats.updated` with correct aggregate
 * data and no participant PII. Uses the real database (self-cleaning).
 */
import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { RegistrationsService } from '../registrations/registrations.service';

function connect(url: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: 4000,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (e) =>
      reject(new Error(`connect_error: ${e.message}`)),
    );
  });
}

function subscribe(socket: Socket, eventId: string): Promise<unknown> {
  return new Promise((resolve) =>
    socket.emit('subscribe', { eventId }, resolve),
  );
}

function once<T = any>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

describe('Realtime stats (e2e)', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let registrations: RegistrationsService;
  let eventId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);

    const address = app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;

    prisma = app.get(PrismaService);
    registrations = app.get(RegistrationsService);

    const event = await prisma.event.create({
      data: {
        title: 'RealtimeTest Event',
        startsAt: new Date('2027-04-01T10:00:00.000Z'),
        capacity: 10,
      },
    });
    eventId = event.id;
  }, 30000);

  afterAll(async () => {
    await prisma.event.delete({ where: { id: eventId } });
    await app.close();
  });

  it(
    'delivers event.stats.updated to multiple subscribed clients after a registration',
    async () => {
      const [tabA, tabB] = await Promise.all([connect(url), connect(url)]);

      try {
        await Promise.all([
          subscribe(tabA, eventId),
          subscribe(tabB, eventId),
        ]);

        const receivedA = once(tabA, 'event.stats.updated');
        const receivedB = once(tabB, 'event.stats.updated');

        // Real state change that should trigger a broadcast.
        await registrations.register(eventId, 'realtime@example.com');

        const [a, b] = await Promise.all([receivedA, receivedB]);

        const expected = {
          eventId,
          capacity: 10,
          registered: 1,
          waitlisted: 0,
          checkedIn: 0,
        };
        expect(a).toEqual(expected);
        expect(b).toEqual(expected); // both tabs get the same update (req. 4)

        // No participant PII leaked in the payload (req. 5).
        expect(a).not.toHaveProperty('email');
        expect(Object.keys(a as object).sort()).toEqual([
          'capacity',
          'checkedIn',
          'eventId',
          'registered',
          'waitlisted',
        ]);
      } finally {
        tabA.disconnect();
        tabB.disconnect();
      }
    },
    30000,
  );
});