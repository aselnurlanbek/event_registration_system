# Event Registration System

A client–server application where **organizers** create capacity-limited events
and **participants** register by account. It handles waitlisting, automatic
promotion, unique tickets, single-use check-in, a live organizer dashboard, and
mock email notifications (ticket / waitlist-promotion / 24h reminder / reschedule
/ cancellation).

- **Backend:** NestJS + TypeScript + Prisma + PostgreSQL, realtime via Socket.IO, JWT auth
- **Frontend:** React + TypeScript + Vite + TanStack Query + React Router + Socket.IO client

## Documentation

| Doc | Contents |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System design, data model, concurrency & idempotency strategy, accounts/roles extension |
| [`docs/AUTHORIZATION.md`](docs/AUTHORIZATION.md) | Role matrix, guard enforcement, security-review results |
| [`docs/MANUAL_TEST_PLAN.md`](docs/MANUAL_TEST_PLAN.md) | Checkbox manual demo plan for every flow |
| [`docs/DEVELOPMENT_LOG.md`](docs/DEVELOPMENT_LOG.md) | Chronological build log & decisions |

---

## Architecture (overview)

A **modular-monolith** NestJS backend + a React SPA + PostgreSQL. PostgreSQL is
the single source of truth and the single point of serialization — every
correctness guarantee is enforced by DB constraints/transactions, and Socket.IO
is a notification layer only.

```
React SPA (Vite)  ── REST (TanStack Query) ─▶  NestJS API ── Prisma ─▶ PostgreSQL
      ▲            ◀── WebSocket (Socket.IO) ─▶   │  (auth, events, registrations,
      └───────── live stats, rooms: event:{id} ───┘   check-in, dashboard, email, scheduler)
```

Highlights:
- **Concurrency-safe registration:** each register/cancel runs in a transaction that first takes a `SELECT … FOR UPDATE` row lock on the event, so the last-spot race resolves to exactly one REGISTERED + one WAITLISTED. A `unique(eventId, email)` constraint is the DB-level backstop.
- **Idempotent side effects:** single-use check-in via a conditional `UPDATE … WHERE checkedInAt IS NULL`; exactly-once emails via a unique `deduplicationKey` outbox.
- **Auth:** email + password (bcrypt) → JWT; role-based (`PARTICIPANT` / `ORGANIZER`) guards + per-event ownership guard. See [`docs/AUTHORIZATION.md`](docs/AUTHORIZATION.md).

---

## Prerequisites

- **Node.js** 20.19+ or 22.12+ recommended (works on 20.17 with Vite engine warnings)
- **PostgreSQL** 15/16 (local install or Docker)
- **npm**

---

## Setup

### 1. Database

Either use a local PostgreSQL, or the bundled Docker instance:

```bash
# Option A — Docker (from repo root)
docker compose up -d          # Postgres 16 on localhost:5432 (postgres/postgres)

# Option B — local Postgres: create the database
createdb event_registration
```

### 2. Backend

```bash
cd backend
cp .env.example .env           # then edit values (see Environment variables)
npm install
npx prisma migrate dev         # apply migrations (creates all tables)
npm run start:dev              # http://localhost:5050  (all routes under /api)
```

Run the test suite (needs a running Postgres):

```bash
npm test                       # 104 tests across 16 suites
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env           # defaults already point at the backend on :5050
npm install
npm run dev                    # http://localhost:5173
```

> Note: on Node < 20.19 the Vite build may need the platform binary installed once
> (`npm i --no-save @rolldown/binding-<platform>` / `@oxlint/binding-<platform>`);
> upgrading Node avoids this. See DEVELOPMENT_LOG Phase 0.

---

## Environment variables

### Backend (`backend/.env`)
| Variable | Purpose | Example |
|---|---|---|
| `PORT` | API port | `5050` |
| `CORS_ORIGIN` | Allowed frontend origin | `http://localhost:5173` |
| `DATABASE_URL` | Postgres connection string | `postgresql://user@localhost:5432/event_registration?schema=public` |
| `JWT_SECRET` | Secret for signing JWTs (**set a strong value in prod**) | `change-me` |
| `JWT_EXPIRES_IN` | Token lifetime | `1d` |
| `NODE_ENV` | Set to `production` in prod (disables `/dev/*` endpoints) | `development` |

### Frontend (`frontend/.env`)
| Variable | Purpose | Example |
|---|---|---|
| `VITE_API_URL` | Backend REST base URL | `http://localhost:5050/api` |
| `VITE_SOCKET_URL` | Socket.IO server URL | `http://localhost:5050` |

---

## Demo accounts

No accounts are seeded. Create them via **Sign up** (`/register`):
- an **Organizer** account (organizer self-registration is enabled in this demo build — it would be admin/invite-only in production), and
- one or more **Participant** accounts.

Then follow [`docs/MANUAL_TEST_PLAN.md`](docs/MANUAL_TEST_PLAN.md).

---

## Frontend routes

| Path | Role | Page |
|---|---|---|
| `/` | public | Event list |
| `/events/:eventId` | public | Read-only event view |
| `/login`, `/register` | public | Auth |
| `/participant` | participant | Events to browse |
| `/participant/registrations` | participant | My registrations + tickets |
| `/participant/profile` | participant | Profile |
| `/participant/events/:eventId` | participant | Event detail + register/cancel |
| `/organizer` | organizer | My events dashboard |
| `/organizer/events/new` | organizer | Create event |
| `/organizer/events/:eventId` | organizer | Live event dashboard (stats, participants, waitlist) |
| `/organizer/events/:eventId/edit` | organizer | Edit / cancel event |
| `/organizer/events/:eventId/check-in` | organizer | Check-in screen |

---

## REST API (base path `/api`)

Auth: `Authorization: Bearer <jwt>`. Roles enforced server-side (see AUTHORIZATION.md).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/auth/register` | public | Create account `{ email, password, role? }` → `{ user, accessToken }` |
| `POST` | `/auth/login` | public | `{ email, password }` → `{ user, accessToken }` |
| `GET` | `/auth/me` | any | Current user |
| `GET` | `/events` | public | List active events |
| `GET` | `/events/:id` | public | Event detail |
| `POST` | `/events` | organizer | Create event (owned by caller) |
| `PATCH` | `/events/:id` | owner | Update event (date/time change → reschedule emails) |
| `DELETE` | `/events/:id` | owner | Soft-cancel event (notifies participants) |
| `GET` | `/organizer/events` | organizer | Caller's own events |
| `POST` | `/events/:eventId/registrations` | participant | Register self (identity from JWT) |
| `POST` | `/events/:eventId/registrations/cancel` | participant | Cancel own registration (auto-promotes waitlist) |
| `GET` | `/events/:eventId/registrations` | owner | Registered + waitlisted lists |
| `GET` | `/me/registrations` | participant | Caller's registrations + tickets |
| `GET` | `/events/:eventId/stats` | owner | `{ capacity, registered, waitlisted, checkedIn }` |
| `POST` | `/events/:eventId/check-in` | owner | Check in a ticket (`ticketCode`) — 200 / 409 / 404 |
| `GET` | `/dev/emails` | dev-only | Inspect mock email outbox (404 in prod) |
| `GET` | `/dev/events/:eventId/tickets` | dev-only | List ticket codes for testing (404 in prod) |
| `POST` | `/dev/reminders/run` | dev-only | Trigger the reminder job (404 in prod) |

---

## Event reminders (background job)

A cron job runs **every minute** and sends each **currently REGISTERED** participant exactly **one** `EVENT_REMINDER`.

- **Window:** event `startsAt` within the next **24 hours**.
- **Exactly-once / restart-safe:** state is in PostgreSQL (`EmailLog`, unique `event-reminder:{eventId}:{registrationId}`). Re-runs, overlapping ticks, and restarts never double-send. Cancelled events are skipped.
- **Manual trigger (dev):** `POST /api/dev/reminders/run`.

---

## WebSocket API (Socket.IO)

Attached to the same origin/port as REST (default `http://localhost:5050`). Powers the live organizer dashboard/check-in.

- **Rooms:** clients `subscribe` per event (`event:{eventId}`); a broadcast reaches only that room.
- **Client → server:** `subscribe` / `unsubscribe` with `{ eventId }` (ack `{ status, eventId }`).
- **Server → client:** `event.stats.updated` after registration, waitlist registration, cancellation, promotion, and check-in.

**`event.stats.updated` payload** (aggregate only — no participant PII):
```json
{ "eventId": "…", "capacity": 100, "registered": 73, "waitlisted": 5, "checkedIn": 42 }
```

**Reconnect:** broadcasts are fire-and-forget; on (re)connect the client re-fetches
`GET /api/events/:eventId/stats` and applies subsequent events as deltas. The REST
snapshot is authoritative.

---

## Known limitations

- **Dev endpoints (`/dev/*`) are unauthenticated**, gated only by `NODE_ENV` (404 in production). Production **must** set `NODE_ENV=production`. See finding F1 in [`docs/AUTHORIZATION.md`](docs/AUTHORIZATION.md).
- **Mock email only** — emails are recorded to a DB outbox (inspect via `/dev/emails`); no real provider is wired.
- **Organizer self-registration** is enabled for the demo (would be admin/invite-only in production).
- **No email verification / password reset**, and minimal password policy (≥ 8 chars).
- **Participants don't see live availability counts** (event stats are organizer-owner-only); event cards show capacity only.
- **No QR scanning** — check-in is by manual ticket-code entry (per assignment scope).
- **Legacy/pre-ownership events** (`organizerId = null`, e.g. earlier demo data) can't be managed via owner-guarded routes; create events through the authenticated flow.
- Single-node deployment assumed (the reminder cron and Socket.IO run in-process).

## Next steps

- Harden `/dev/*` (opt-in gate or admin guard) — F1.
- Real email provider via an after-commit outbox dispatcher (the outbox pattern is already in place).
- Refresh-token rotation / logout-all; email verification & password reset.
- Show remaining availability to participants (a public/aggregate count endpoint).
- Pagination for large participant lists; search/filter on events.
- Authenticate the Socket.IO handshake and scope organizer rooms.
- E2E UI tests (Playwright) to complement the backend integration suite.