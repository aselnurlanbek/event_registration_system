/**
 * HTTP-level auth tests against the real app + Postgres. Covers account
 * creation, duplicate email, login, invalid password, authenticated /me, and
 * organizer-only route protection.
 */
import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

describe('Auth (integration, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: import('http').Server;

  const participant = { email: 'p_auth@example.com', password: 'password123' };
  const organizer = {
    email: 'o_auth@example.com',
    password: 'password123',
    role: 'ORGANIZER',
  };
  const createdEmails = [participant.email, organizer.email];
  const createdEventIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    http = app.getHttpServer();
  });

  afterAll(async () => {
    if (createdEventIds.length) {
      await prisma.event.deleteMany({ where: { id: { in: createdEventIds } } });
    }
    await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    await app.close();
  });

  it('creates a participant account and returns a token (no password hash)', async () => {
    const res = await request(http)
      .post('/api/auth/register')
      .send(participant)
      .expect(201);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.email).toBe(participant.email);
    expect(res.body.user.role).toBe('PARTICIPANT');
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('rejects duplicate email with 409', async () => {
    await request(http)
      .post('/api/auth/register')
      .send(participant)
      .expect(409);
  });

  it('registers an organizer (demo: self-registration allowed)', async () => {
    const res = await request(http)
      .post('/api/auth/register')
      .send(organizer)
      .expect(201);
    expect(res.body.user.role).toBe('ORGANIZER');
  });

  it('logs in with correct credentials and returns a token', async () => {
    const res = await request(http)
      .post('/api/auth/login')
      .send({ email: participant.email, password: participant.password })
      .expect(200);
    expect(res.body.accessToken).toBeDefined();
  });

  it('rejects login with an invalid password (401)', async () => {
    await request(http)
      .post('/api/auth/login')
      .send({ email: participant.email, password: 'wrong-password' })
      .expect(401);
  });

  it('returns the current user from /me with a valid token', async () => {
    const login = await request(http)
      .post('/api/auth/login')
      .send({ email: participant.email, password: participant.password });
    const token = login.body.accessToken as string;

    const res = await request(http)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.email).toBe(participant.email);
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('rejects /me without a token (401)', async () => {
    await request(http).get('/api/auth/me').expect(401);
  });

  describe('organizer-only route protection (POST /api/events)', () => {
    const eventBody = {
      title: 'Auth Guard Test Event',
      startsAt: '2027-09-01T10:00:00.000Z',
      capacity: 10,
    };

    async function tokenFor(creds: { email: string; password: string }) {
      const res = await request(http).post('/api/auth/login').send(creds);
      return res.body.accessToken as string;
    }

    it('rejects an unauthenticated request (401)', async () => {
      await request(http).post('/api/events').send(eventBody).expect(401);
    });

    it('rejects a PARTICIPANT (403)', async () => {
      const token = await tokenFor(participant);
      await request(http)
        .post('/api/events')
        .set('Authorization', `Bearer ${token}`)
        .send(eventBody)
        .expect(403);
    });

    it('allows an ORGANIZER (201)', async () => {
      const token = await tokenFor({
        email: organizer.email,
        password: organizer.password,
      });
      const res = await request(http)
        .post('/api/events')
        .set('Authorization', `Bearer ${token}`)
        .send(eventBody)
        .expect(201);
      expect(res.body.id).toBeDefined();
      createdEventIds.push(res.body.id);
    });
  });
});