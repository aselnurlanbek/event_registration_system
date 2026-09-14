/**
 * HTTP authorization tests for organizer event ownership. Real app + Postgres,
 * self-cleaning. Verifies owner-only update/delete/list/stats/check-in, that a
 * second organizer is blocked (403), /organizer/events scoping, public read for
 * participants, and that reschedule notifications still fire for the owner.
 */
import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

describe('Event ownership (integration, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: import('http').Server;

  const org1 = { email: 'own1@example.com', password: 'password123', role: 'ORGANIZER' };
  const org2 = { email: 'own2@example.com', password: 'password123', role: 'ORGANIZER' };
  const part = { email: 'own_p@example.com', password: 'password123' };
  const emails = [org1.email, org2.email, part.email];

  let org1Token: string;
  let org2Token: string;
  let partToken: string;
  let eventId: string;
  let ticketCode: string;

  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    http = app.getHttpServer();

    const reg = async (b: object) =>
      (await request(http).post('/api/auth/register').send(b)).body.accessToken as string;
    org1Token = await reg(org1);
    org2Token = await reg(org2);
    partToken = await reg(part);

    const ev = await request(http)
      .post('/api/events')
      .set(bearer(org1Token))
      .send({ title: 'Owned Event', startsAt: '2027-11-01T10:00:00.000Z', capacity: 5 });
    eventId = ev.body.id as string;

    // A participant registers so we have a registrant + ticket for later checks.
    await request(http)
      .post(`/api/events/${eventId}/registrations`)
      .set(bearer(partToken));
    const row = await prisma.registration.findFirst({
      where: { eventId, email: part.email },
      include: { ticket: true },
    });
    ticketCode = row!.ticket!.code;
  });

  afterAll(async () => {
    await prisma.event.deleteMany({ where: { id: eventId } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app.close();
  });

  it('sets the creating organizer as owner', async () => {
    const ev = await prisma.event.findUnique({ where: { id: eventId } });
    const owner = await prisma.user.findUnique({ where: { email: org1.email } });
    expect(ev?.organizerId).toBe(owner?.id);
  });

  it('GET /organizer/events returns only the caller’s events', async () => {
    const mine = await request(http)
      .get('/api/organizer/events')
      .set(bearer(org1Token))
      .expect(200);
    expect(mine.body.some((e: { id: string }) => e.id === eventId)).toBe(true);

    const others = await request(http)
      .get('/api/organizer/events')
      .set(bearer(org2Token))
      .expect(200);
    expect(others.body.some((e: { id: string }) => e.id === eventId)).toBe(false);
  });

  it('participant-facing reads remain public', async () => {
    await request(http).get('/api/events').expect(200);
    await request(http).get(`/api/events/${eventId}`).expect(200);
  });

  it('blocks non-owner update, allows owner, and preserves reschedule emails', async () => {
    const body = { startsAt: '2027-12-01T10:00:00.000Z' };
    await request(http).patch(`/api/events/${eventId}`).send(body).expect(401); // unauth
    await request(http)
      .patch(`/api/events/${eventId}`)
      .set(bearer(partToken))
      .send(body)
      .expect(403); // wrong role
    await request(http)
      .patch(`/api/events/${eventId}`)
      .set(bearer(org2Token))
      .send(body)
      .expect(403); // not owner

    await request(http)
      .patch(`/api/events/${eventId}`)
      .set(bearer(org1Token))
      .send(body)
      .expect(200); // owner

    // Reschedule notification preserved (req. 8): the registrant got an email.
    const emails = await prisma.emailLog.count({
      where: { eventId, type: 'EVENT_RESCHEDULED' },
    });
    expect(emails).toBeGreaterThanOrEqual(1);
  });

  it('restricts registrations list + stats to the owner', async () => {
    await request(http)
      .get(`/api/events/${eventId}/registrations`)
      .set(bearer(org2Token))
      .expect(403);
    await request(http)
      .get(`/api/events/${eventId}/registrations`)
      .set(bearer(org1Token))
      .expect(200);

    await request(http)
      .get(`/api/events/${eventId}/stats`)
      .set(bearer(org2Token))
      .expect(403);
    await request(http)
      .get(`/api/events/${eventId}/stats`)
      .set(bearer(org1Token))
      .expect(200);
  });

  it('restricts check-in to the owner', async () => {
    await request(http)
      .post(`/api/events/${eventId}/check-in`)
      .set(bearer(org2Token))
      .send({ ticketCode })
      .expect(403);

    await request(http)
      .post(`/api/events/${eventId}/check-in`)
      .set(bearer(org1Token))
      .send({ ticketCode })
      .expect(200);
  });

  it('blocks non-owner delete, allows owner', async () => {
    await request(http)
      .delete(`/api/events/${eventId}`)
      .set(bearer(org2Token))
      .expect(403);

    await request(http)
      .delete(`/api/events/${eventId}`)
      .set(bearer(org1Token))
      .expect(200);

    // Soft-cancel: the row is preserved as history, flagged CANCELLED.
    const row = await prisma.event.findUnique({ where: { id: eventId } });
    expect(row?.status).toBe('CANCELLED');
  });
});