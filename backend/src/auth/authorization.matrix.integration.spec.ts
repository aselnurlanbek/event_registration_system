/**
 * End-to-end authorization matrix. Exercises EVERY protected route over HTTP
 * (no frontend involved) to prove the role + ownership rules, including the
 * specific attack scenarios: manual ID changes in the URL, one participant
 * targeting another, and one organizer targeting another organizer's event.
 *
 * Real app + Postgres, self-cleaning.
 */
import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

describe('Authorization matrix (integration, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: import('http').Server;

  const org1 = { email: 'authz_o1@example.com', password: 'password123', role: 'ORGANIZER' };
  const org2 = { email: 'authz_o2@example.com', password: 'password123', role: 'ORGANIZER' };
  const p1 = { email: 'authz_p1@example.com', password: 'password123' };
  const p2 = { email: 'authz_p2@example.com', password: 'password123' };
  const emails = [org1.email, org2.email, p1.email, p2.email];

  let org1T: string;
  let org2T: string;
  let p1T: string;
  let p2T: string;
  let eventA: string; // owned by org1
  let ticketA: string; // p1's ticket on eventA

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

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
    org1T = await reg(org1);
    org2T = await reg(org2);
    p1T = await reg(p1);
    p2T = await reg(p2);

    const ev = await request(http)
      .post('/api/events')
      .set(auth(org1T))
      .send({ title: 'AuthZ Event A', startsAt: '2027-12-01T10:00:00.000Z', capacity: 5 });
    eventA = ev.body.id;

    await request(http).post(`/api/events/${eventA}/registrations`).set(auth(p1T));
    const row = await prisma.registration.findFirst({
      where: { eventId: eventA, email: p1.email },
      include: { ticket: true },
    });
    ticketA = row!.ticket!.code;
  });

  afterAll(async () => {
    // Remove every event created by the test organizers (cascades registrations,
    // tickets, emails), then the users.
    const orgUsers = await prisma.user.findMany({
      where: { email: { in: [org1.email, org2.email] } },
      select: { id: true },
    });
    await prisma.event.deleteMany({
      where: { organizerId: { in: orgUsers.map((u) => u.id) } },
    });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app.close();
  });

  // ---- PARTICIPANT can ----------------------------------------------------
  describe('PARTICIPANT can', () => {
    it('view available events (public)', async () => {
      await request(http).get('/api/events').expect(200);
      await request(http).get(`/api/events/${eventA}`).expect(200);
    });

    it('register themselves', async () => {
      const res = await request(http)
        .post(`/api/events/${eventA}/registrations`)
        .set(auth(p2T))
        .expect(201);
      expect(res.body.email).toBe(p2.email);
    });

    it('view their own registrations + ticket', async () => {
      const res = await request(http)
        .get('/api/me/registrations')
        .set(auth(p1T))
        .expect(200);
      const entry = res.body.find((r: { event: { id: string } }) => r.event.id === eventA);
      expect(entry).toBeDefined();
      expect(entry.ticketCode).toBeTruthy();
      // Scoping: p1 only sees their own registrations.
      expect(
        res.body.every((r: { event: { id: string } }) => r.event.id === eventA),
      ).toBe(true);
    });

    it('cancel their own registration', async () => {
      const res = await request(http)
        .post(`/api/events/${eventA}/registrations/cancel`)
        .set(auth(p2T))
        .expect(200);
      expect(res.body.registration.status).toBe('CANCELLED');
      // re-register p2 for later isolation checks
      await request(http).post(`/api/events/${eventA}/registrations`).set(auth(p2T));
    });
  });

  // ---- PARTICIPANT cannot -------------------------------------------------
  describe('PARTICIPANT cannot', () => {
    const body = { title: 'x', startsAt: '2028-01-01T10:00:00.000Z', capacity: 3 };

    it('create events (403)', async () => {
      await request(http).post('/api/events').set(auth(p1T)).send(body).expect(403);
    });
    it('edit events (403)', async () => {
      await request(http)
        .patch(`/api/events/${eventA}`)
        .set(auth(p1T))
        .send({ title: 'hacked' })
        .expect(403);
    });
    it('delete/cancel events (403)', async () => {
      await request(http).delete(`/api/events/${eventA}`).set(auth(p1T)).expect(403);
    });
    it("view an event's private participant list (403)", async () => {
      await request(http)
        .get(`/api/events/${eventA}/registrations`)
        .set(auth(p1T))
        .expect(403);
    });
    it('view organizer stats (403)', async () => {
      await request(http)
        .get(`/api/events/${eventA}/stats`)
        .set(auth(p1T))
        .expect(403);
    });
    it('check in tickets (403)', async () => {
      await request(http)
        .post(`/api/events/${eventA}/check-in`)
        .set(auth(p1T))
        .send({ ticketCode: ticketA })
        .expect(403);
    });
    it("cannot modify another participant's registration (identity is from JWT)", async () => {
      // p2 tries to cancel — body email is ignored; only p2's own reg is touched.
      // (Here p2 IS registered, so it cancels p2, never p1.) Verify p1 untouched.
      const before = await prisma.registration.findFirst({
        where: { eventId: eventA, email: p1.email },
      });
      await request(http)
        .post(`/api/events/${eventA}/registrations/cancel`)
        .set(auth(p2T))
        .send({ email: p1.email }) // attempt to target p1 — must be ignored
        .expect(200);
      const after = await prisma.registration.findFirst({
        where: { eventId: eventA, email: p1.email },
      });
      expect(after?.status).toBe(before?.status); // p1 unchanged
      const p2row = await prisma.registration.findFirst({
        where: { eventId: eventA, email: p2.email },
      });
      expect(p2row?.status).toBe('CANCELLED'); // only p2 affected
    });
  });

  // ---- ORGANIZER can ------------------------------------------------------
  describe('ORGANIZER can (owner)', () => {
    it('create events', async () => {
      await request(http)
        .post('/api/events')
        .set(auth(org1T))
        .send({ title: 'Owned B', startsAt: '2028-02-01T10:00:00.000Z', capacity: 2 })
        .expect(201);
    });
    it('view registrations + stats for own events', async () => {
      await request(http)
        .get(`/api/events/${eventA}/registrations`)
        .set(auth(org1T))
        .expect(200);
      await request(http).get(`/api/events/${eventA}/stats`).set(auth(org1T)).expect(200);
    });
    it('edit own event', async () => {
      await request(http)
        .patch(`/api/events/${eventA}`)
        .set(auth(org1T))
        .send({ capacity: 6 })
        .expect(200);
    });
    it('check in for own event', async () => {
      // p1 is registered on eventA with ticketA.
      await request(http)
        .post(`/api/events/${eventA}/check-in`)
        .set(auth(org1T))
        .send({ ticketCode: ticketA })
        .expect(200);
    });
    it('lists only their own events', async () => {
      const mine = await request(http)
        .get('/api/organizer/events')
        .set(auth(org1T))
        .expect(200);
      expect(mine.body.some((e: { id: string }) => e.id === eventA)).toBe(true);
      const other = await request(http)
        .get('/api/organizer/events')
        .set(auth(org2T))
        .expect(200);
      expect(other.body.some((e: { id: string }) => e.id === eventA)).toBe(false);
    });
  });

  // ---- ORGANIZER cannot (cross-owner, manual ID change) -------------------
  describe("ORGANIZER cannot touch another organizer's event", () => {
    it('edit (403)', async () => {
      await request(http)
        .patch(`/api/events/${eventA}`)
        .set(auth(org2T))
        .send({ title: 'stolen' })
        .expect(403);
    });
    it('cancel/delete (403)', async () => {
      await request(http).delete(`/api/events/${eventA}`).set(auth(org2T)).expect(403);
    });
    it('view registrations (403)', async () => {
      await request(http)
        .get(`/api/events/${eventA}/registrations`)
        .set(auth(org2T))
        .expect(403);
    });
    it('view stats (403)', async () => {
      await request(http).get(`/api/events/${eventA}/stats`).set(auth(org2T)).expect(403);
    });
    it('check in (403)', async () => {
      await request(http)
        .post(`/api/events/${eventA}/check-in`)
        .set(auth(org2T))
        .send({ ticketCode: ticketA })
        .expect(403);
    });
  });

  // ---- Unauthenticated ----------------------------------------------------
  describe('unauthenticated requests are rejected (401)', () => {
    it('protected routes require a token', async () => {
      await request(http).post('/api/events').send({}).expect(401);
      await request(http).post(`/api/events/${eventA}/registrations`).expect(401);
      await request(http).get('/api/me/registrations').expect(401);
      await request(http).get(`/api/events/${eventA}/registrations`).expect(401);
      await request(http).get(`/api/events/${eventA}/stats`).expect(401);
      await request(http).post(`/api/events/${eventA}/check-in`).send({ ticketCode: 'x' }).expect(401);
      await request(http).patch(`/api/events/${eventA}`).send({}).expect(401);
      await request(http).delete(`/api/events/${eventA}`).expect(401);
      await request(http).get('/api/organizer/events').expect(401);
    });
  });

  // ---- Manual ID change to a non-existent event ---------------------------
  describe('manual URL ID tampering', () => {
    it('owner-guarded routes 404/403 for unknown or foreign event ids', async () => {
      // Unknown id, valid organizer → 404 (event not found, checked before ownership).
      await request(http)
        .get('/api/events/nonexistent-id/stats')
        .set(auth(org1T))
        .expect(404);
      // Foreign id, valid organizer → 403 handled in the cross-owner suite above.
    });
  });
});