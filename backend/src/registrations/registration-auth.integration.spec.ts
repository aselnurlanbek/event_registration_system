/**
 * HTTP tests for authenticated, account-linked registration: identity comes from
 * the JWT (not the body), participants see only their own registrations, and can
 * cancel only their own. Real app + Postgres, self-cleaning.
 */
import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

describe('Authenticated registrations (integration, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: import('http').Server;

  const p1 = { email: 'p1_reg@example.com', password: 'password123' };
  const p2 = { email: 'p2_reg@example.com', password: 'password123' };
  const org = { email: 'org_reg@example.com', password: 'password123', role: 'ORGANIZER' };
  const emails = [p1.email, p2.email, org.email];
  let eventId: string;
  let p1Token: string;
  let p2Token: string;
  let orgToken: string;

  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
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
    p1Token = await reg(p1);
    p2Token = await reg(p2);
    orgToken = await reg(org);

    const ev = await request(http)
      .post('/api/events')
      .set(bearer(orgToken))
      .send({ title: 'Auth Reg Event', startsAt: '2027-10-01T10:00:00.000Z', capacity: 5 });
    eventId = ev.body.id as string;
  });

  afterAll(async () => {
    if (eventId) await prisma.event.deleteMany({ where: { id: eventId } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app.close();
  });

  it('requires authentication to register (401)', async () => {
    await request(http).post(`/api/events/${eventId}/registrations`).expect(401);
  });

  it('rejects an ORGANIZER from registering as a participant (403)', async () => {
    await request(http)
      .post(`/api/events/${eventId}/registrations`)
      .set(bearer(orgToken))
      .expect(403);
  });

  it('registers using the JWT identity and ignores any body email (reqs. 2, 3)', async () => {
    const res = await request(http)
      .post(`/api/events/${eventId}/registrations`)
      .set(bearer(p1Token))
      .send({ email: 'attacker@evil.com' }) // must NOT be trusted
      .expect(201);

    expect(res.body.status).toBe('REGISTERED');
    expect(res.body.email).toBe(p1.email); // identity from token, not body
    expect(res.body.ticket?.code).toBeDefined();

    // Persisted with the account link.
    const row = await prisma.registration.findFirst({
      where: { eventId, email: p1.email },
    });
    expect(row?.userId).toBeTruthy();
    // No registration was ever created for the body email.
    const attacker = await prisma.registration.findFirst({
      where: { eventId, email: 'attacker@evil.com' },
    });
    expect(attacker).toBeNull();
  });

  it('is idempotent — repeat registration keeps one active row', async () => {
    await request(http)
      .post(`/api/events/${eventId}/registrations`)
      .set(bearer(p1Token))
      .expect(201);
    const count = await prisma.registration.count({
      where: { eventId, email: p1.email },
    });
    expect(count).toBe(1);
  });

  it('GET /me/registrations returns only the caller’s registrations with event + ticket info', async () => {
    const mine = await request(http)
      .get('/api/me/registrations')
      .set(bearer(p1Token))
      .expect(200);
    expect(mine.body).toHaveLength(1);
    const r = mine.body[0];
    expect(r.event.id).toBe(eventId);
    expect(r.event.title).toBe('Auth Reg Event');
    expect(r.event.startsAt).toBeDefined();
    expect(r.status).toBe('REGISTERED');
    expect(r.ticketCode).toBeDefined();
    expect(r).toHaveProperty('checkedInAt');

    // p2 has not registered → sees nothing (scoping).
    const other = await request(http)
      .get('/api/me/registrations')
      .set(bearer(p2Token))
      .expect(200);
    expect(other.body).toHaveLength(0);
  });

  it('/me/registrations requires auth (401)', async () => {
    await request(http).get('/api/me/registrations').expect(401);
  });

  it('a participant can cancel only their own registration', async () => {
    // p2 has no registration → cancelling theirs is a 404, and does NOT touch p1.
    await request(http)
      .post(`/api/events/${eventId}/registrations/cancel`)
      .set(bearer(p2Token))
      .expect(404);

    const p1StillRegistered = await prisma.registration.findFirst({
      where: { eventId, email: p1.email },
    });
    expect(p1StillRegistered?.status).toBe('REGISTERED');

    // p1 cancels their own → success.
    const res = await request(http)
      .post(`/api/events/${eventId}/registrations/cancel`)
      .set(bearer(p1Token))
      .expect(200);
    expect(res.body.registration.status).toBe('CANCELLED');
  });

  it('cancel requires auth (401)', async () => {
    await request(http)
      .post(`/api/events/${eventId}/registrations/cancel`)
      .expect(401);
  });
});